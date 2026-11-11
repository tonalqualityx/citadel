import { describe, it, expect } from 'vitest';
import { homeActSchema } from '../act';
import { checkOnDay, dayChoices, dayWords, isDayArrived, isDayParked, isSnoozeBack, isSnoozeParked, onDayCheckText, onDayMessage, snoozeChoices, snoozeCheckText, snoozeCountToday, snoozeInstant, snoozeMessage } from '../on-day';
import { sessionAskHash, sessionAskIsCleared } from '../session-clear';
import { planLines, type WatchItem, type WatchState } from '../emergency/watch';

const TZ = 'America/New_York';
const T = 'task:7aa4a01a-1111-4222-8333-944445555666';
/** Wall clock in Eastern standard time, November 2026. Tuesday is the 10th. */
const at = (d: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, d, h + 5, mi));
const NOW = at(10, 10);

describe('on_day: the request', () => {
  it('is strict: a date is required and no extra field is accepted', () => {
    expect(homeActSchema.safeParse({ action: 'on_day', item_key: T, date: '2026-11-19' }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'on_day', item_key: T }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'on_day', item_key: T, date: 'Thursday' }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'on_day', item_key: T, date: '2026-11-19', user_id: 'x' }).success).toBe(false);
  });
  it('checks the day against today in his zone: tomorrow or later, 60 days at most', () => {
    expect(checkOnDay('2026-11-11', '2026-11-10')).toEqual({ y: 2026, m: 11, d: 11 });
    expect(checkOnDay('2027-01-09', '2026-11-10')).toEqual({ y: 2027, m: 1, d: 9 });
    for (const bad of ['2026-11-10', '2026-11-09', '2026-02-30']) expect(() => checkOnDay(bad, '2026-11-10')).toThrow('Pick a day after today.');
    expect(() => checkOnDay('2027-01-10', '2026-11-10')).toThrow('Pick a day within 60 days.');
  });
});

describe('on_day: words', () => {
  const c = (y: number, m: number, d: number) => ({ y, m, d });
  it('says a weekday within the coming week and the full date after that', () => {
    expect(dayWords(c(2026, 11, 12), '2026-11-10')).toBe('Thursday');
    expect(dayWords(c(2026, 11, 19), '2026-11-10')).toBe('Thursday, November 19');
  });
  it('adds the plain date sentence only when the item date is before the chosen day', () => {
    expect(onDayMessage(c(2026, 11, 12), '2026-11-10', null)).toBe('Set for Thursday.');
    expect(onDayMessage(c(2026, 11, 12), '2026-11-10', new Date('2026-11-11T00:00:00Z'))).toBe('Set for Thursday. Its date is Wednesday, the day before.');
    expect(onDayMessage(c(2026, 11, 12), '2026-11-10', new Date('2026-11-12T00:00:00Z'))).toBe('Set for Thursday.');
    expect(onDayMessage(c(2026, 11, 12), '2026-11-10', new Date('2026-11-20T00:00:00Z'))).toBe('Set for Thursday.');
  });
  it('never says priority or overdue', () => {
    expect(onDayMessage(c(2026, 11, 12), '2026-11-10', new Date('2026-11-02T00:00:00Z'))).not.toMatch(/priorit|overdue/i);
  });
  it('the drawer check text names the day and who picked it', () => {
    expect(onDayCheckText(new Date('2026-11-12T00:00:00Z'))).toBe('Back Thursday, November 12. You picked the day.');
  });
  it('the quick choices: Tomorrow, four business days by weekday, Next week', () => {
    expect(dayChoices(NOW, TZ)).toEqual([
      { label: 'Tomorrow', date: '2026-11-11' },
      { label: 'Thursday', date: '2026-11-12' },
      { label: 'Friday', date: '2026-11-13' },
      { label: 'Tuesday', date: '2026-11-17' },
      { label: 'Next week', date: '2026-11-16' },
    ]);
    // Friday: tomorrow is Saturday; the business days are Monday to Thursday and Monday stands as Next week.
    const fri = dayChoices(at(13, 10), TZ);
    expect(fri[0]).toEqual({ label: 'Tomorrow', date: '2026-11-14' });
    expect(fri.at(-1)).toEqual({ label: 'Next week', date: '2026-11-16' });
    expect(fri.map((x) => x.label)).toEqual(['Tomorrow', 'Tuesday', 'Wednesday', 'Thursday', 'Next week']);
  });
});

describe('on_day: when it holds and when it returns', () => {
  const st = (over: Record<string, unknown> = {}) => ({ on_day: new Date('2026-11-19T00:00:00Z'), view_at: at(19, 0, 5), view_set_by: 'user', ...over }) as never;
  it('holds before view_at, returns on the day (boosted that day only), then is ordinary', () => {
    expect(isDayParked(st(), at(18, 12))).toBe(true);
    expect(isDayArrived(st(), at(18, 12), TZ)).toBe(false);
    expect(isDayParked(st(), at(19, 0, 6))).toBe(false);
    expect(isDayArrived(st(), at(19, 0, 6), TZ)).toBe(true);
    expect(isDayArrived(st(), at(19, 18), TZ)).toBe(true);
    expect(isDayArrived(st(), at(20, 9), TZ)).toBe(false);
  });
  it('a keeper park or a missing day is never an on_day park', () => {
    expect(isDayParked(st({ view_set_by: 'keeper' }), at(18, 12))).toBe(false);
    expect(isDayParked(st({ on_day: null }), at(18, 12))).toBe(false);
  });
});

describe('snooze: the request and the instant', () => {
  it('takes exactly one of until and hours, hours 1 to 4', () => {
    const ok = (b: Record<string, unknown>) => homeActSchema.safeParse({ action: 'snooze', item_key: T, ...b }).success;
    expect(ok({ hours: 3 })).toBe(true);
    expect(ok({ until: '2026-11-10T20:00:00Z' })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ hours: 3, until: '2026-11-10T20:00:00Z' })).toBe(false);
    expect(ok({ hours: 5 })).toBe(false);
    expect(ok({ until: 'soon' })).toBe(false);
    expect(ok({ hours: 3, extra: 1 })).toBe(false);
  });
  it('is 15 minutes to 24 hours from now; longer is a day', () => {
    expect(snoozeInstant({ hours: 3 }, NOW).toISOString()).toBe(at(10, 13).toISOString());
    expect(() => snoozeInstant({ until: at(10, 10, 14).toISOString() }, NOW)).toThrow('Pick a time at least 15 minutes ahead.');
    expect(snoozeInstant({ until: at(10, 10, 15).toISOString() }, NOW)).toEqual(at(10, 10, 15));
    expect(snoozeInstant({ until: at(11, 10).toISOString() }, NOW)).toEqual(at(11, 10));
    expect(() => snoozeInstant({ until: at(11, 10, 1).toISOString() }, NOW)).toThrow('Pick a day instead.');
  });
});

describe('snooze: words', () => {
  const none = { snooze_count: 0, snooze_day: null };
  it('counts per item per day', () => {
    expect(snoozeCountToday(none, NOW, TZ)).toBe(1);
    expect(snoozeCountToday({ snooze_count: 2, snooze_day: new Date('2026-11-10T00:00:00Z') }, NOW, TZ)).toBe(3);
    expect(snoozeCountToday({ snooze_count: 2, snooze_day: new Date('2026-11-09T00:00:00Z') }, NOW, TZ)).toBe(1);
  });
  it('says the clock, the date and the third time', () => {
    expect(snoozeMessage(at(10, 14), NOW, TZ, null, 1)).toBe('Snoozed until 2:00.');
    expect(snoozeMessage(at(10, 14), NOW, TZ, new Date('2026-11-10T00:00:00Z'), 2)).toBe('Snoozed until 2:00. Its date is today.');
    expect(snoozeMessage(at(10, 14), NOW, TZ, null, 3)).toBe('Snoozed until 2:00. That is the third time today.');
    expect(snoozeMessage(at(11, 9), NOW, TZ, null, 1)).toBe('Snoozed until Wednesday 9:00.');
    expect(snoozeMessage(at(10, 14), NOW, TZ, null, 3)).not.toMatch(/priorit|overdue/i);
  });
  it('the drawer text', () => {
    expect(snoozeCheckText(at(10, 14), NOW, TZ)).toBe('Back at 2:00 today. Snoozed.');
  });
  it('the choices: 1 hour, 3 hours, After lunch and End of day when still ahead by 15 minutes', () => {
    expect(snoozeChoices(NOW, TZ).map((c) => c.label)).toEqual(['1 hour', '3 hours', 'After lunch', 'End of day']);
    expect(snoozeChoices(at(10, 12, 50), TZ).map((c) => c.label)).toEqual(['1 hour', '3 hours', 'End of day']);
    expect(snoozeChoices(at(10, 15, 50), TZ).map((c) => c.label)).toEqual(['1 hour', '3 hours']);
    expect(snoozeChoices(NOW, TZ)[2]).toEqual({ label: 'After lunch', until: at(10, 13).toISOString() });
    expect(snoozeChoices(NOW, TZ)[3]).toEqual({ label: 'End of day', until: at(10, 16).toISOString() });
  });
  it('holds until the instant, then says "back" for the rest of that day only', () => {
    const st = { snoozed_until: at(10, 14), view_at: at(10, 14), view_set_by: 'user' } as never;
    expect(isSnoozeParked(st, at(10, 13))).toBe(true);
    expect(isSnoozeParked(st, at(10, 14, 1))).toBe(false);
    expect(isSnoozeBack(st, at(10, 14, 1), TZ)).toBe(true);
    expect(isSnoozeBack(st, at(10, 13), TZ)).toBe(false);
    expect(isSnoozeBack(st, at(11, 9), TZ)).toBe(false);
  });
});

describe('Slack lines for held items', () => {
  const item = (over: Partial<WatchItem> = {}): WatchItem => ({ key: T, title: 'Renew it', why: 'w', lifeline: false, hard_date: null, watchdog_escalated: false, ...over });
  const state = (over: Partial<WatchState> = {}): WatchState => ({
    id: '11111111-1111-4111-8111-111111111111',
    item_key: T,
    first_seen_at: at(10, 8),
    cleared_at: null,
    acted_at: null,
    slack_first_claimed_at: at(10, 8),
    slack_first_claims: 1,
    slack_first_at: at(10, 8),
    slack_again_claimed_at: null,
    slack_again_claims: 0,
    slack_again_at: null,
    lifeline_line_on: null,
    lifeline_claim_on: null,
    lifeline_claimed_at: null,
    lifeline_claims: 0,
    ...over,
  });
  const plan = (items: WatchItem[], now: Date, st = state()) => planLines({ items, states: new Map([[T, st]]), now, timeZone: TZ }).map((l) => l.kind);
  it('a held item gets no first or still waiting line', () => {
    expect(plan([item()], at(10, 15))).toEqual(['again']);
    expect(plan([item({ day_held: true })], at(10, 15))).toEqual([]);
    expect(plan([item({ day_held: true })], at(10, 15), state({ slack_first_at: null, slack_first_claimed_at: null, slack_first_claims: 0 }))).toEqual([]);
  });
  it('the lifeline daily line keeps going while held', () => {
    expect(plan([item({ day_held: true, lifeline: true, hard_date: at(12, 0) })], at(10, 15))).toEqual(['lifeline']);
  });
  it('after a snooze the still waiting line waits 4 working hours past its end', () => {
    const it2 = item({ resume_at: at(10, 14) });
    expect(plan([it2], at(10, 16, 30))).toEqual([]);
    expect(plan([it2], at(11, 10, 30))).toEqual(['again']);
  });
});

describe('session card clear: the hash rule', () => {
  const cleared = (text: string) => ({ session_cleared_at: new Date(), session_cleared_hash: sessionAskHash(text) });
  it('hides the same text (whitespace aside) and shows a different one', () => {
    expect(sessionAskIsCleared('Pick the tone.', cleared('Pick the tone.'))).toBe(true);
    expect(sessionAskIsCleared('  Pick   the tone. ', cleared('Pick the tone.'))).toBe(true);
    expect(sessionAskIsCleared('Pick the tone and the name.', cleared('Pick the tone.'))).toBe(false);
    expect(sessionAskIsCleared('Pick the tone.', null)).toBe(false);
    expect(sessionAskIsCleared('Pick the tone.', { session_cleared_at: null, session_cleared_hash: null })).toBe(false);
  });
  it('the request is strict', () => {
    expect(homeActSchema.safeParse({ action: 'clear_session', item_key: 'session:abc-1' }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'clear_session', item_key: 'session:abc-1', hash: 'x' }).success).toBe(false);
  });
});
