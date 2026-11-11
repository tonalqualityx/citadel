import { describe, it, expect } from 'vitest';
import {
  CLAIM_RETRY_MS,
  DASHBOARD_URL,
  MAX_LINES_PER_RUN,
  againDue,
  againLineText,
  cleanSlackText,
  daysLeft,
  firstLineText,
  inLifelineWindow,
  inSendWindow,
  lifelineLineText,
  lineId,
  parseLineId,
  planLines,
  workingMsBetween,
  type WatchItem,
  type WatchState,
} from '../watch';

const TZ = 'America/New_York';
const H = 3_600_000;
/** Tuesday 2026-11-10 at hh:mm Eastern (EST, UTC-5). */
const tue = (h: number, mi = 0) => new Date(Date.UTC(2026, 10, 10, h + 5, mi));
const day = (d: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, d, h + 5, mi)); // November 2026, Eastern
const ROW = '11111111-1111-4111-8111-111111111111';

const item = (over: Partial<WatchItem> = {}): WatchItem => ({
  key: 'task:a',
  title: 'Call Gene',
  why: 'A client is waiting',
  lifeline: false,
  hard_date: null,
  watchdog_escalated: false,
  ...over,
});
const state = (over: Partial<WatchState> = {}): WatchState => ({
  id: ROW,
  item_key: 'task:a',
  first_seen_at: tue(10),
  cleared_at: null,
  acted_at: null,
  slack_first_claimed_at: null,
  slack_first_claims: 0,
  slack_first_at: null,
  slack_again_claimed_at: null,
  slack_again_claims: 0,
  slack_again_at: null,
  lifeline_line_on: null,
  lifeline_claim_on: null,
  lifeline_claimed_at: null,
  lifeline_claims: 0,
  ...over,
});
const plan = (items: WatchItem[], rows: WatchState[], now: Date) =>
  planLines({ items, states: new Map(rows.map((r) => [r.item_key, r])), now, timeZone: TZ });

describe('send window', () => {
  it('07:00 in, 22:00 out, 06:59 out', () => {
    expect(inSendWindow(tue(6, 59), TZ)).toBe(false);
    expect(inSendWindow(tue(7), TZ)).toBe(true);
    expect(inSendWindow(tue(21, 59), TZ)).toBe(true);
    expect(inSendWindow(tue(22), TZ)).toBe(false);
  });
  it('lifeline window starts at 09:00', () => {
    expect(inLifelineWindow(tue(8, 59), TZ)).toBe(false);
    expect(inLifelineWindow(tue(9), TZ)).toBe(true);
    expect(inLifelineWindow(tue(22), TZ)).toBe(false);
  });
  it('follows his zone through daylight saving (Eastern in July is UTC-4)', () => {
    expect(inSendWindow(new Date('2026-07-14T11:00:00Z'), TZ)).toBe(true); // 07:00 EDT
    expect(inSendWindow(new Date('2026-07-14T10:59:00Z'), TZ)).toBe(false);
  });
});

describe('working hours', () => {
  it('counts only Monday to Friday 09:00 to 17:00', () => {
    expect(workingMsBetween(tue(10), tue(14), TZ)).toBe(4 * H);
    expect(workingMsBetween(tue(7), tue(9), TZ)).toBe(0);
    expect(workingMsBetween(tue(16), day(11, 10), TZ)).toBe(2 * H); // Tue 16-17, Wed 9-10
  });
  it('skips a weekend', () => {
    // Friday 2026-11-13 16:00 to Monday 2026-11-16 10:00
    expect(workingMsBetween(day(13, 16), day(16, 10), TZ)).toBe(2 * H);
  });
  it('is 0 when to is not after from', () => {
    expect(workingMsBetween(tue(12), tue(10), TZ)).toBe(0);
  });
  it('4 working hours: due at exactly 4h, not at 3h59', () => {
    expect(againDue(tue(10), tue(13, 59), TZ)).toBe(false);
    expect(againDue(tue(10), tue(14), TZ)).toBe(true);
  });
  it('an item that landed at 16:00 is due at 12:00 next day', () => {
    expect(againDue(tue(16), day(11, 11, 59), TZ)).toBe(false);
    expect(againDue(tue(16), day(11, 12), TZ)).toBe(true);
  });
  it('a Saturday landing waits for Monday', () => {
    expect(againDue(day(14, 10), day(15, 15), TZ)).toBe(false);
    expect(againDue(day(14, 10), day(16, 13), TZ)).toBe(true);
  });
});

describe('days left', () => {
  it('counts calendar days on his wall clock', () => {
    expect(daysLeft(day(13, 12), tue(10), TZ)).toBe(3);
    expect(daysLeft(day(10, 12), tue(23, 30), TZ)).toBe(0);
    expect(daysLeft(day(9, 12), tue(10), TZ)).toBe(-1);
  });
});

describe('cleanSlackText', () => {
  it('makes one plain line and caps the length', () => {
    expect(cleanSlackText('a\n\nb\t c', 50)).toBe('a b c');
    expect(cleanSlackText('x'.repeat(300), 120)).toHaveLength(120);
  });
  it('removes em and en dashes', () => {
    const out = cleanSlackText('one — two – three', 50);
    expect(out).toBe('one - two - three');
    expect(out).not.toMatch(/[—–]/);
  });
  it('neutralises mentions, links and markup', () => {
    const out = cleanSlackText('<!channel> <@U123> <https://evil.example|click> *bold* _it_ ~s~ `code` a&b @here', 200);
    expect(out).not.toMatch(/[<>@&*_~`]/);
    expect(out).toContain('and');
    expect(out).not.toContain('<');
  });
  it('swaps the banned words in any case', () => {
    const out = cleanSlackText('Priority and PRIORITIES and Overdue invoice', 200);
    expect(out).not.toMatch(/priorit|overdue/i);
  });
  it('handles non-strings and control characters', () => {
    expect(cleanSlackText(null, 10)).toBe('');
    expect(cleanSlackText('a\u0000b​c', 10)).toBe('a bc');
  });
});

describe('line text', () => {
  it('first line has the title, the reason and the dashboard link', () => {
    expect(firstLineText('Call Gene.', 'A client is waiting.')).toBe(`Needs you now: Call Gene. A client is waiting. ${DASHBOARD_URL}`);
  });
  it('cuts the title at 120 characters', () => {
    const t = firstLineText('T'.repeat(500), 'why');
    expect(t).toContain('T'.repeat(120));
    expect(t).not.toContain('T'.repeat(121));
  });
  it('a hostile title cannot carry a mention, a link or a banned word', () => {
    const t = firstLineText('<!channel> <@U1> overdue priority — *x*', 'a <https://x.example|y>');
    expect(t).not.toMatch(/[<>@*—–]/);
    expect(t).not.toMatch(/priorit|overdue/i);
    expect(t.includes('\n')).toBe(false);
  });
  it('again line names the time he first saw it', () => {
    expect(againLineText('Call Gene', tue(9, 5), TZ)).toBe('Still waiting on you since Tuesday 9:05 am: Call Gene.');
    expect(againLineText('Call Gene', tue(15, 30), TZ)).toBe('Still waiting on you since Tuesday 3:30 pm: Call Gene.');
    expect(againLineText('Call Gene', tue(0, 15), TZ)).toContain('12:15 am');
  });
  it('lifeline wording', () => {
    expect(lifelineLineText('Renew the cert', 3)).toBe('Renew the cert. 3 days left, and only you can do this one.');
    expect(lifelineLineText('Renew the cert', 1)).toBe('Renew the cert. 1 day left, and only you can do this one.');
    expect(lifelineLineText('Renew the cert', 0)).toBe('Today is the last day: Renew the cert.');
    expect(lifelineLineText('Renew the cert', null)).toBe('Renew the cert. Only you can do this one.');
    expect(lifelineLineText('Renew the cert', -2)).not.toMatch(/overdue/i);
  });
});

describe('line ids', () => {
  it('round trip, and reject anything else', () => {
    expect(parseLineId(lineId(ROW, 'again'))).toEqual({ row_id: ROW, kind: 'again' });
    for (const bad of ['', 'x', `${ROW}`, `${ROW}:other`, `new:task:a`, `${ROW}:first:extra`]) expect(parseLineId(bad)).toBeNull();
  });
});

describe('planLines: first sight', () => {
  it('sends once between 07:00 and 22:00, with the row id', () => {
    const out = plan([item()], [state()], tue(10, 1));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'first', id: lineId(ROW, 'first'), item_key: 'task:a' });
    expect(out[0].text).toContain('Needs you now: Call Gene.');
  });
  it('an untracked item (dry run) gets a new: id', () => {
    const out = plan([item()], [], tue(10));
    expect(out[0].id).toBe('new:task:a');
  });
  it('quiet hours hold it until 07:00', () => {
    expect(plan([item()], [state()], tue(23))).toEqual([]);
    expect(plan([item()], [state()], tue(6, 59))).toEqual([]);
    expect(plan([item()], [state()], tue(7))).toHaveLength(1);
  });
  it('is skipped for a Kuma incident the watchdog already escalated', () => {
    expect(plan([item({ key: 'site:x', watchdog_escalated: true })], [state({ item_key: 'site:x' })], tue(10))).toEqual([]);
  });
  it('is not repeated once acknowledged', () => {
    expect(plan([item()], [state({ slack_first_claims: 1, slack_first_claimed_at: tue(10), slack_first_at: tue(10, 1) })], tue(10, 30))).toEqual([]);
  });
});

describe('planLines: unacknowledged retry', () => {
  const claimed = (n: number, at: Date) => state({ slack_first_claims: n, slack_first_claimed_at: at });
  it('not offered again inside 15 minutes', () => {
    expect(plan([item()], [claimed(1, tue(10))], new Date(tue(10).getTime() + CLAIM_RETRY_MS - 1))).toEqual([]);
  });
  it('offered once more at 15 minutes', () => {
    expect(plan([item()], [claimed(1, tue(10))], new Date(tue(10).getTime() + CLAIM_RETRY_MS))).toHaveLength(1);
  });
  it('then never again', () => {
    expect(plan([item()], [claimed(2, tue(10))], tue(10, 40))).toEqual([]);
  });
});

describe('planLines: still waiting', () => {
  const sent = (over: Partial<WatchState> = {}) => state({ slack_first_claims: 1, slack_first_claimed_at: tue(10), slack_first_at: tue(10, 1), ...over });
  it('not before 4 working hours, once at 4', () => {
    expect(plan([item()], [sent()], tue(13, 59))).toEqual([]);
    const out = plan([item()], [sent()], tue(14));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'again', id: lineId(ROW, 'again') });
    expect(out[0].text).toBe('Still waiting on you since Tuesday 10:00 am: Call Gene.');
  });
  it('a home action on the item stops it', () => {
    expect(plan([item()], [sent({ acted_at: tue(11) })], tue(15))).toEqual([]);
  });
  it('once only: not after it was acknowledged, nor after two offers', () => {
    expect(plan([item()], [sent({ slack_again_claims: 1, slack_again_claimed_at: tue(14), slack_again_at: tue(14, 1) })], tue(16))).toEqual([]);
    expect(plan([item()], [sent({ slack_again_claims: 2, slack_again_claimed_at: tue(14) })], tue(16))).toEqual([]);
  });
  it('an unacknowledged one is offered exactly once more', () => {
    expect(plan([item()], [sent({ slack_again_claims: 1, slack_again_claimed_at: tue(14) })], tue(14, 20))).toHaveLength(1);
  });
  it('an item that left Needs you now gets nothing (it is not in the items)', () => {
    expect(plan([], [sent()], tue(15))).toEqual([]);
  });
  it('nothing until the first line was handed out', () => {
    expect(plan([item()], [state()], tue(15)).map((l) => l.kind)).toEqual(['first']);
  });
  it('not on a weekend alone: Friday landing, Saturday run has no working hours to add', () => {
    const fri = state({ first_seen_at: day(13, 16), slack_first_claims: 1, slack_first_claimed_at: day(13, 16), slack_first_at: day(13, 16, 1) });
    expect(plan([item()], [fri], day(14, 12))).toEqual([]);
  });
  it('is held in quiet hours', () => {
    expect(plan([item()], [sent()], day(11, 23))).toEqual([]);
  });
});

describe('planLines: lifeline', () => {
  const life = (over: Partial<WatchItem> = {}) => item({ key: 'task:l', title: 'Renew the cert', lifeline: true, hard_date: day(13, 12), ...over });
  const row = (over: Partial<WatchState> = {}) => state({ item_key: 'task:l', slack_first_claims: 1, slack_first_claimed_at: tue(9), slack_first_at: tue(9, 1), ...over });
  it('once a day after 09:00, with the days left', () => {
    expect(plan([life()], [row()], tue(8, 30)).filter((l) => l.kind === 'lifeline')).toEqual([]);
    const out = plan([life()], [row()], tue(9, 5)).filter((l) => l.kind === 'lifeline');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Renew the cert. 3 days left, and only you can do this one.');
  });
  it('not twice in a day once acknowledged; again the next day, weekends included', () => {
    const done = row({ lifeline_line_on: '2026-11-10', lifeline_claim_on: '2026-11-10', lifeline_claims: 1, lifeline_claimed_at: tue(9, 5) });
    expect(plan([life()], [done], tue(15)).filter((l) => l.kind === 'lifeline')).toEqual([]);
    expect(plan([life()], [done], day(11, 9, 1)).filter((l) => l.kind === 'lifeline')).toHaveLength(1);
    const sat = plan([life({ hard_date: day(16, 12) })], [done], day(14, 10)).filter((l) => l.kind === 'lifeline');
    expect(sat).toHaveLength(1);
    expect(sat[0].text).toContain('2 days left');
  });
  it('the last day reads "Today is the last day"', () => {
    const out = plan([life({ hard_date: day(10, 12) })], [row()], tue(10)).filter((l) => l.kind === 'lifeline');
    expect(out[0].text).toBe('Today is the last day: Renew the cert.');
  });
  it('an unacknowledged lifeline claim is offered once more the same day, then not', () => {
    const c1 = row({ lifeline_claim_on: '2026-11-10', lifeline_claims: 1, lifeline_claimed_at: tue(9, 5) });
    expect(plan([life()], [c1], tue(9, 10)).filter((l) => l.kind === 'lifeline')).toEqual([]);
    expect(plan([life()], [c1], tue(9, 20)).filter((l) => l.kind === 'lifeline')).toHaveLength(1);
    const c2 = row({ lifeline_claim_on: '2026-11-10', lifeline_claims: 2, lifeline_claimed_at: tue(9, 20) });
    expect(plan([life()], [c2], tue(12)).filter((l) => l.kind === 'lifeline')).toEqual([]);
  });
  it('a claim from yesterday does not count today', () => {
    const y = row({ lifeline_claim_on: '2026-11-09', lifeline_claims: 2, lifeline_claimed_at: day(9, 9), lifeline_line_on: null });
    expect(plan([life()], [y], tue(10)).filter((l) => l.kind === 'lifeline')).toHaveLength(1);
  });
  it('a lifeline item also gets the one "still waiting" line, next to its daily line', () => {
    expect(plan([life()], [row()], day(11, 15)).map((l) => l.kind)).toEqual(['again', 'lifeline']);
  });
  it('no lifeline line in quiet hours', () => {
    expect(plan([life()], [row()], tue(22, 30))).toEqual([]);
  });
});

describe('planLines: cap', () => {
  it('hands out at most 6 per run', () => {
    const items = Array.from({ length: 10 }, (_, i) => item({ key: `task:${i}` }));
    const rows = items.map((it, i) => state({ id: `11111111-1111-4111-8111-1111111111${String(i).padStart(2, '0')}`, item_key: it.key }));
    expect(plan(items, rows, tue(10))).toHaveLength(MAX_LINES_PER_RUN);
  });
});
