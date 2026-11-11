import { describe, it, expect } from 'vitest';
import { autoDraftDue, isLeadNow, leadClock, leadResurfacedPastPark, owedClock, parkedAtOf, weekdayIn, wokeByNewMessage } from '../clock';
import { d } from '../../__tests__/fixtures/tonight';

// Monday 2026-11-02 10:00 Eastern.
const MON = d('2026-11-02T15:00:00Z');
const at = (iso: string) => d(iso);

describe('owed clock (client replies)', () => {
  it('day 3 is waiting, day 5 is thought-due, by business days from their newest message', () => {
    expect(owedClock(MON, false, null, at('2026-11-04T20:00:00Z'))).toMatchObject({ days: 1, waiting: false, thoughtDue: false });
    expect(owedClock(MON, false, null, at('2026-11-05T22:30:00Z'))).toMatchObject({ days: 3, waiting: true, thoughtDue: false });
    expect(owedClock(MON, false, null, at('2026-11-06T22:30:00Z'))).toMatchObject({ days: 4, waiting: true, thoughtDue: false });
    expect(owedClock(MON, false, null, at('2026-11-09T22:30:00Z'))).toMatchObject({ days: 5, waiting: true, thoughtDue: true });
  });
  it('a lead is never waiting or thought-due', () => {
    const c = owedClock(MON, true, null, at('2026-11-20T22:30:00Z'));
    expect(c.waiting).toBe(false);
    expect(c.thoughtDue).toBe(false);
    expect(c.lead).not.toBeNull();
  });
});

describe('lead clock', () => {
  it('is due 2 business days on, comes back every 2 after, and asks at 10', () => {
    const before = leadClock(MON, null, at('2026-11-03T20:00:00Z'));
    expect(before.past).toBe(false);
    expect(weekdayIn(before.due, 'America/New_York')).toBe('Wednesday');
    const due = leadClock(MON, null, at('2026-11-04T22:30:00Z'));
    expect(due.past).toBe(true);
    expect(due.resurfaceAt).toBeNull();
    const again = leadClock(MON, null, at('2026-11-06T22:30:00Z'));
    expect(again.resurfaceAt?.toISOString()).toBe(at('2026-11-06T22:00:00Z').toISOString());
    expect(leadClock(MON, null, at('2026-11-13T22:30:00Z')).ask).toBe(false);
    expect(leadClock(MON, null, at('2026-11-16T22:30:00Z')).ask).toBe(true);
  });
  it('Keep it restarts the clock from lead_clock_from', () => {
    const kept = leadClock(MON, { lead_clock_from: at('2026-11-16T15:00:00Z') }, at('2026-11-17T20:00:00Z'));
    expect(kept.ask).toBe(false);
    expect(kept.past).toBe(false);
    expect(kept.start.toISOString()).toBe('2026-11-16T15:00:00.000Z');
  });
  it('Not a lead ends it until a newer message arrives', () => {
    expect(isLeadNow('sales', MON, { not_lead_at: at('2026-11-03T15:00:00Z') })).toBe(false);
    expect(isLeadNow('sales', at('2026-11-04T15:00:00Z'), { not_lead_at: at('2026-11-03T15:00:00Z') })).toBe(true);
    expect(isLeadNow('general', MON, null)).toBe(false);
  });
});

describe('auto draft clock', () => {
  it('is due after 3 business days with no tap', () => {
    expect(autoDraftDue(MON, at('2026-11-04T20:00:00Z'))).toBe(false);
    expect(autoDraftDue(MON, at('2026-11-05T22:30:00Z'))).toBe(true);
    expect(autoDraftDue(null, at('2026-11-05T22:30:00Z'))).toBe(false);
  });
});

describe('wake', () => {
  const NOW = at('2026-11-10T15:00:00Z');
  const parked = { view_at: at('2026-11-11T14:00:00Z'), view_set_by: 'user', parked_at: at('2026-11-09T15:00:00Z') };
  it('a message after the park ends it; one before does not', () => {
    expect(wokeByNewMessage(parked, at('2026-11-10T12:00:00Z'), NOW)).toBe(true);
    expect(wokeByNewMessage(parked, at('2026-11-08T12:00:00Z'), NOW)).toBe(false);
  });
  it('a keeper park or an ended park never wakes', () => {
    expect(wokeByNewMessage({ ...parked, view_set_by: 'keeper' }, at('2026-11-10T12:00:00Z'), NOW)).toBe(false);
    expect(wokeByNewMessage({ ...parked, view_at: at('2026-11-10T14:00:00Z') }, at('2026-11-10T12:00:00Z'), NOW)).toBe(false);
    expect(wokeByNewMessage(null, at('2026-11-10T12:00:00Z'), NOW)).toBe(false);
  });
  it('an older park with no parked_at reads as view_at minus 7 days', () => {
    const old = { view_at: at('2026-11-11T14:00:00Z'), view_set_by: null, parked_at: null };
    expect(parkedAtOf(old)?.toISOString()).toBe('2026-11-04T14:00:00.000Z');
    expect(wokeByNewMessage(old, at('2026-11-05T12:00:00Z'), NOW)).toBe(true);
    expect(wokeByNewMessage(old, at('2026-11-03T12:00:00Z'), NOW)).toBe(false);
  });
  it('a lead that came back after he parked it comes back even though parked', () => {
    const clock = leadClock(MON, null, at('2026-11-06T22:30:00Z'));
    const st = { view_at: at('2026-11-09T14:00:00Z'), view_set_by: 'user', parked_at: at('2026-11-05T15:00:00Z') };
    expect(leadResurfacedPastPark(clock, st, at('2026-11-06T22:30:00Z'))).toBe(true);
    expect(leadResurfacedPastPark(clock, { ...st, parked_at: at('2026-11-06T22:10:00Z') }, at('2026-11-06T22:30:00Z'))).toBe(false);
  });
});
