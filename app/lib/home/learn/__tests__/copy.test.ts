import { describe, it, expect } from 'vitest';
import { LEARN, cleanLabel, guardLine, lineIsClean, weekLine } from '../copy';
import { measuresWeek } from '../measures';
import type { WeekInput } from '../measures';

const base: WeekInput = {
  week_start: '2026-11-16',
  week_end: '2026-11-22',
  tz: 'America/New_York',
  now: new Date('2026-11-23T14:00:00Z'),
  emergencies: [],
  snapshots: [],
  prev_snapshot: null,
  task_changes: [],
  first_action_day: '2026-11-10',
  hard_dates: [],
  today_days: [],
};
const snaps = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-11-${16 + i}`, open_items: 188, past_day: 6, owed: i === 0 ? [{ key: 'thread:a:b', label: 'Re: quote', age_bd: 5 }, { key: 'thread:a:c', label: 'Hello', age_bd: 4 }] : [] }));

describe('weekLine', () => {
  it('is null when nothing qualifies', () => {
    expect(weekLine(measuresWeek({ ...base, first_action_day: '2026-11-20' }))).toBeNull();
  });
  it('writes the example sentences when every measure has data', () => {
    const w = measuresWeek({
      ...base,
      snapshots: snaps(5),
      emergencies: [
        { key: 'a', kind: 'site', label: 'a.com down', started_at: new Date('2026-11-16T14:00:00Z'), first_action_at: new Date('2026-11-16T15:00:00Z'), cleared_on_own: false },
      ],
      task_changes: [{ task_id: '1', here: true }, { task_id: '2', here: false }],
    });
    const line = weekLine(w)!;
    expect(line.text).toBe('Last week: 1 emergency, seen within 4 working hours. 2 replies waited over 3 business days. 1 of 2 task changes were made here. 188 open items, 6 past their day.');
    expect(line.details.length).toBeGreaterThan(0);
    expect(lineIsClean(line.text)).toBe(true);
    for (const d of line.details) expect(lineIsClean(d)).toBe(true);
  });
  it('leaves out the sentences whose measure lacks data', () => {
    const w = measuresWeek({ ...base, snapshots: snaps(4), first_action_day: '2026-11-19', task_changes: [{ task_id: '1', here: true }] });
    expect(w.owed.ok).toBe(false);
    expect(w.emergencies.ok).toBe(false);
    expect(weekLine(w)).toBeNull();
  });
});

describe('text safety', () => {
  it('cleanLabel removes dashes and the banned words', () => {
    const t = cleanLabel('Invoice — overdue priority notice');
    expect(lineIsClean(t)).toBe(true);
    expect(t.toLowerCase()).not.toMatch(/overdue|priorit/);
  });
  it('guardLine is clean and names the threshold', () => {
    const t = guardLine({ rows: 24, approvals: 23, median_gap_ms: 3000 });
    expect(t).toContain('23 of 24');
    expect(t).toContain(`${LEARN.guardGapMs / 1000} seconds`);
    expect(lineIsClean(t)).toBe(true);
  });
});
