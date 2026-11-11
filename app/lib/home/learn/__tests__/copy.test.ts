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

describe('Slice 7b sentences', async () => {
  const c = await import('../copy');
  const all = (): string[] => [
    c.learnedLine('client:x', 'Nerd Herd', 'up'),
    c.learnedLine('client:x', 'Nerd Herd', 'down'),
    c.learnedLine('type:session', 'session questions', 'down'),
    c.learnedLine('project:p', 'the Alpha project', 'up'),
    c.learnedLine('sop:s', 'tasks that follow Plugin updates', 'up'),
    c.learnedLine('sender:a@b.co', 'mail from a@b.co', 'up'),
    ...c.learnedDetails(3, 0),
    ...c.learnedDetails(1, 2),
    c.learnedFooter('client:x', 'Nerd Herd', 'up'),
    c.learnedFooter('type:wait', 'waits', 'down'),
    c.learnedSettingsSentence('client:x', 'Nerd Herd', 105, 'November 30'),
    c.learnedSettingsSentence('type:review', 'sign-offs', 95, null),
    c.LEARNED_EMPTY,
    c.LEARNED_SWITCH_HINT,
    c.LEARNED_ORDER_ONLY,
  ];
  it('reads as the plan words', () => {
    expect(c.learnedLine('client:x', 'Nerd Herd', 'up')).toBe('Learned: Nerd Herd work now comes up a little sooner.');
    expect(c.learnedLine('type:session', 'session questions', 'down')).toBe('Learned: Session questions now come up a little later.');
    expect(c.learnedDetails(3, 0)[0]).toBe('You moved 3 items up and set none aside in the last 4 weeks.');
    expect(c.learnedDetails(3, 0)[1]).toBe('This changes order only. It never changes what counts as an emergency or a real date.');
    expect(c.learnedFooter('client:x', 'Nerd Herd', 'up')).toBe('Comes up a little sooner because you moved Nerd Herd work up before.');
    expect(c.learnedSettingsSentence('client:x', 'Nerd Herd', 105, 'November 30')).toBe('Nerd Herd work comes up a little sooner, since November 30');
  });
  it('has no dash and none of the banned words, even when a name carries them', () => {
    for (const t of all()) expect(c.lineIsClean(t), t).toBe(true);
    expect(c.lineIsClean(c.learnedLine('client:x', 'Priority overdue Co', 'up'))).toBe(true);
  });
  it('carries no number from a weight', () => {
    for (const t of [c.learnedLine('client:x', 'X', 'up'), c.learnedFooter('client:x', 'X', 'up'), c.learnedSettingsSentence('client:x', 'X', 115, null)]) expect(t).not.toMatch(/\d|percent|%/);
  });
});

describe('weekLine: work stage B handled-mail sentence', () => {
  it('adds "Recorded 41 emails as handled. You reopened 1." when mail was recorded', () => {
    const w = measuresWeek({ ...base, snapshots: snaps(5), handled_mail: { recorded: 41, reopened: 1 } });
    const line = weekLine(w)!;
    expect(line.text).toContain('Recorded 41 emails as handled. You reopened 1.');
    expect(lineIsClean(line.text)).toBe(true);
  });
  it('says nothing when none was recorded, and the line is unchanged without the input', () => {
    const none = weekLine(measuresWeek({ ...base, snapshots: snaps(5), handled_mail: { recorded: 0, reopened: 0 } }))!;
    const absent = weekLine(measuresWeek({ ...base, snapshots: snaps(5) }))!;
    expect(none.text).toBe(absent.text);
    expect(none.text).not.toContain('Recorded');
  });
  it('one email reads in the singular', () => {
    const line = weekLine(measuresWeek({ ...base, snapshots: snaps(5), handled_mail: { recorded: 1, reopened: 0 } }))!;
    expect(line.text).toContain('Recorded 1 email as handled. You reopened 0.');
  });
});
