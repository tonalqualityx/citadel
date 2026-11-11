import { describe, it, expect } from 'vitest';
import { guard, measuresWeek, median } from '../measures';
import type { GuardRow, WeekInput } from '../measures';

const TZ = 'America/New_York';
const base: WeekInput = {
  week_start: '2026-11-16',
  week_end: '2026-11-22',
  tz: TZ,
  now: new Date('2026-11-23T14:00:00Z'),
  emergencies: [],
  snapshots: [],
  prev_snapshot: null,
  task_changes: [],
  first_action_day: '2026-11-01',
  hard_dates: [],
  today_days: [],
};
const snap = (date: string, open = 10, owed: { key: string; label: string; age_bd: number }[] = []) => ({ date, open_items: open, past_day: 1, owed });
const days = (n: number) => ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].slice(0, n);

describe('data thresholds', () => {
  it('4 business days omit the snapshot measures, 5 include them', () => {
    expect(measuresWeek({ ...base, snapshots: days(4).map((d) => snap(d)) }).plate.ok).toBe(false);
    expect(measuresWeek({ ...base, snapshots: days(5).map((d) => snap(d)) }).plate.ok).toBe(true);
    expect(measuresWeek({ ...base, snapshots: days(4).map((d) => snap(d)) }).owed.ok).toBe(false);
  });
  it('weekend snapshots do not count as business days', () => {
    const s = [...days(4), '2026-11-21'].map((d) => snap(d));
    expect(measuresWeek({ ...base, snapshots: s }).owed.business_days).toBe(4);
  });
  it('log measures count from his first home action', () => {
    expect(measuresWeek({ ...base, first_action_day: '2026-11-17' }).emergencies.ok).toBe(false); // Tue to Fri = 4
    expect(measuresWeek({ ...base, first_action_day: '2026-11-16' }).emergencies.ok).toBe(true);
    expect(measuresWeek({ ...base, first_action_day: null }).emergencies.ok).toBe(false);
  });
});

describe('emergencies', () => {
  const ev = (over: Partial<WeekInput['emergencies'][number]>) => ({
    key: 'k', kind: 'site' as const, label: 'x.com down', started_at: new Date('2026-11-16T14:00:00Z'), first_action_at: new Date('2026-11-16T15:00:00Z'), cleared_on_own: false, ...over,
  });
  it('counts seen in time, late and never', () => {
    const m = measuresWeek({
      ...base,
      emergencies: [ev({ key: '1' }), ev({ key: '2', first_action_at: new Date('2026-11-17T20:00:00Z') }), ev({ key: '3', first_action_at: null })],
    });
    expect(m.emergencies.value).toEqual({ total: 3, seen_in_time: 1, not_seen_in_time: 2, cleared_on_own: 0 });
    expect(m.emergencies.details.some((d) => d.includes('not seen yet'))).toBe(true);
  });
  it('an incident that cleared on its own is listed but not counted', () => {
    const m = measuresWeek({ ...base, emergencies: [ev({ key: '1' }), ev({ key: '2', first_action_at: null, cleared_on_own: true })] });
    expect(m.emergencies.value.total).toBe(1);
    expect(m.emergencies.value.cleared_on_own).toBe(1);
    expect(m.emergencies.details.join(' ')).toContain('cleared on its own');
  });
  it('time is working time across a weekend', () => {
    const m = measuresWeek({
      ...base,
      emergencies: [ev({ started_at: new Date('2026-11-13T21:00:00Z'), first_action_at: new Date('2026-11-16T15:00:00Z') })], // Fri 16:00 to Mon 10:00 ET
    });
    expect(m.emergencies.value.seen_in_time).toBe(1);
    expect(m.emergencies.details[0]).toContain('2 working hours');
  });
});

describe('owed, where, plate', () => {
  it('owed counts distinct threads older than 3 business days on any night', () => {
    const m = measuresWeek({
      ...base,
      snapshots: [
        snap('2026-11-16', 10, [{ key: 'a', label: 'A', age_bd: 4 }, { key: 'b', label: 'B', age_bd: 3 }]),
        snap('2026-11-17', 10, [{ key: 'a', label: 'A', age_bd: 5 }]),
        ...days(5).slice(2).map((d) => snap(d)),
      ],
    });
    expect(m.owed.value.count).toBe(1);
    expect(m.owed.details[0]).toBe('A: waited 5 business days');
  });
  it('where counts distinct task ids', () => {
    const m = measuresWeek({ ...base, task_changes: [{ task_id: '1', here: true }, { task_id: '1', here: true }, { task_id: '2', here: false }] });
    expect(m.where.value).toEqual({ total: 2, here: 1 });
    expect(m.where.ok).toBe(true);
    expect(measuresWeek({ ...base, task_changes: [] }).where.ok).toBe(false);
  });
  it('plate uses the last snapshot and the change against the week before', () => {
    const m = measuresWeek({ ...base, snapshots: days(5).map((d, i) => snap(d, 100 + i)), prev_snapshot: snap('2026-11-13', 90) });
    expect(m.plate.value.open).toBe(104);
    expect(m.plate.value.change).toBe(14);
    expect(m.plate.details[0]).toContain('14 items more');
  });
  it('hard dates are met or missed', () => {
    const m = measuresWeek({ ...base, hard_dates: [{ label: 'Renewal', met: true }, { label: 'Filing', met: false }] });
    expect(m.plate.value.hard_met).toBe(1);
    expect(m.plate.value.hard_missed).toBe(1);
  });
  it('today measures give details only when days exist', () => {
    const m = measuresWeek({ ...base, today_days: days(5).map((d, i) => ({ date: d, kept: i < 3, proposed: 4, done: 2 })) });
    expect(m.today.ok).toBe(true);
    expect(m.today.value).toEqual({ days: 5, days_kept: 3, share_done: 50 });
  });
});

describe('guard', () => {
  const rows = (n: number, approvals: number, gap: number | null): GuardRow[] =>
    Array.from({ length: n }, (_, i) => ({ item_key: `review:${i}`, did: i < approvals ? 'approve_all' : 'let_it_go', gap_ms: gap }));
  it('fires at 20 rows, 96 percent approvals and a 3 second median', () => {
    expect(guard(rows(25, 24, 3000))).toEqual({ rows: 25, approvals: 24, median_gap_ms: 3000 });
  });
  it('does not fire at 19 rows', () => expect(guard(rows(19, 19, 3000))).toBeNull());
  it('does not fire at exactly 95 percent', () => expect(guard(rows(20, 19, 3000))).toBeNull());
  it('does not fire at a 6 second median', () => expect(guard(rows(25, 25, 6000))).toBeNull());
  it('does not fire with no gaps at all', () => expect(guard(rows(25, 25, null))).toBeNull());
  it('median handles even counts', () => expect(median([1, 3, 5, 7])).toBe(4));
});
