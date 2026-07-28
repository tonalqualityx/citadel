import { describe, it, expect } from 'vitest';
import {
  reasonChipForPick,
  reasonChipForTask,
  dueLabel,
  targetLabel,
  countPromisedDueToday,
  dueSoonDoorSummary,
} from '@/lib/reason-chips';

const TODAY = '2026-07-22'; // a Wednesday

describe('reasonChipForPick — the rule table (Clarity Phase 8)', () => {
  it('rule 1: in-progress beats everything, even a promised due-today task', () => {
    const chip = reasonChipForPick(
      { started_at: '2026-07-22T09:00:00.000Z', task: { promised_to: 'Dan', due_date: '2026-07-22T00:00:00.000Z' } },
      { todayDateStr: TODAY }
    );
    expect(chip).toEqual({ variant: 'progress', label: 'in progress' });
  });

  it('a completed pick is not "in progress" even with started_at set', () => {
    const chip = reasonChipForPick(
      { started_at: '2026-07-22T09:00:00.000Z', completed_at: '2026-07-22T10:00:00.000Z', task: null },
      { todayDateStr: TODAY }
    );
    expect(chip.variant).not.toBe('progress');
  });

  it('rule 2: promised + due date renders "promised: due <label>"', () => {
    const chip = reasonChipForPick(
      { task: { promised_to: 'Ricson & Hannah', due_date: '2026-07-22T00:00:00.000Z' } },
      { todayDateStr: TODAY }
    );
    expect(chip).toEqual({ variant: 'promised', label: 'promised: due today' });
  });

  it('rule 3: promised with no due date renders bare "promised"', () => {
    const chip = reasonChipForPick({ task: { promised_to: 'Dan', due_date: null } }, { todayDateStr: TODAY });
    expect(chip).toEqual({ variant: 'promised', label: 'promised' });
  });

  it('rule 4: internal + due date renders "target: <label>"', () => {
    const chip = reasonChipForPick({ task: { promised_to: null, due_date: '2026-07-23T00:00:00.000Z' } }, { todayDateStr: TODAY });
    expect(chip).toEqual({ variant: 'target', label: 'target: tomorrow' });
  });

  it('rule 5: no task ref at all (arc/session/note pick) falls back to "picked this morning"', () => {
    const chip = reasonChipForPick({ task: null }, { todayDateStr: TODAY });
    expect(chip).toEqual({ variant: 'picked', label: 'picked this morning' });
  });

  it('rule 5: a task with neither promised_to nor due_date also falls back to "picked this morning"', () => {
    const chip = reasonChipForPick({ task: { promised_to: null, due_date: null } }, { todayDateStr: TODAY });
    expect(chip.variant).toBe('picked');
  });

  it('reasonChipForTask is the same rule applied to a bare task (Due-soon row/door)', () => {
    const chip = reasonChipForTask({ promised_to: 'Dan', due_date: '2026-07-22T00:00:00.000Z' }, { todayDateStr: TODAY });
    expect(chip).toEqual({ variant: 'promised', label: 'promised: due today' });
  });
});

describe('THE TONE LAW — target is never red, never says "overdue" (research DON\'T-BUILD)', () => {
  const farPastDue = '2026-01-01T00:00:00.000Z'; // ~6 months before TODAY
  const oneDayPastDue = '2026-07-21T00:00:00.000Z';

  it.each([
    ['far past-due internal target', { promised_to: null, due_date: farPastDue }],
    ['one-day past-due internal target', { promised_to: null, due_date: oneDayPastDue }],
    ['far past-due promised task', { promised_to: 'Dan', due_date: farPastDue }],
    ['due today, internal', { promised_to: null, due_date: TODAY }],
    ['due today, promised', { promised_to: 'Dan', due_date: TODAY }],
    ['due next week, internal', { promised_to: null, due_date: '2026-08-01T00:00:00.000Z' }],
    ['no due date, internal', { promised_to: null, due_date: null }],
    ['no due date, promised', { promised_to: 'Dan', due_date: null }],
  ])('%s: label never contains "overdue"', (_label, task) => {
    const chip = reasonChipForTask(task, { todayDateStr: TODAY });
    expect(chip.label.toLowerCase()).not.toContain('overdue');
  });

  it('a far past-due internal task is variant "target", never anything error-flavored', () => {
    const chip = reasonChipForTask({ promised_to: null, due_date: farPastDue }, { todayDateStr: TODAY });
    expect(chip.variant).toBe('target');
  });
});

describe('dueLabel — the assertive-chip date matrix', () => {
  it('same day -> "today"', () => expect(dueLabel(TODAY, TODAY)).toBe('today'));
  it('+1 day -> "tomorrow"', () => expect(dueLabel('2026-07-23', TODAY)).toBe('tomorrow'));
  it('+3 days -> short weekday', () => expect(dueLabel('2026-07-25', TODAY)).toBe('Sat'));
  it('+10 days -> "MMM d"', () => expect(dueLabel('2026-08-01', TODAY)).toBe('Aug 1'));
  it('past due -> the real date, never a negative count or "overdue"', () => {
    expect(dueLabel('2026-07-01', TODAY)).toBe('Jul 1');
  });
});

describe('targetLabel — the quiet-chip date matrix', () => {
  it('same day -> "today"', () => expect(targetLabel(TODAY, TODAY)).toBe('today'));
  it('+1 day -> "tomorrow"', () => expect(targetLabel('2026-07-23', TODAY)).toBe('tomorrow'));
  it('within the current Mon-Sun -> "this week"', () => expect(targetLabel('2026-07-24', TODAY)).toBe('this week'));
  it('within the following Mon-Sun -> "next week"', () => expect(targetLabel('2026-07-28', TODAY)).toBe('next week'));
  it('further out -> "MMM d"', () => expect(targetLabel('2026-09-01', TODAY)).toBe('Sep 1'));
  it('past due -> the real date, never "overdue"', () => expect(targetLabel('2026-01-01', TODAY)).toBe('Jan 1'));
});

describe('countPromisedDueToday — signals rail source', () => {
  it('counts only promised tasks due exactly today', () => {
    const n = countPromisedDueToday(
      [
        { promised_to: 'Dan', due_date: `${TODAY}T00:00:00.000Z` },
        { promised_to: null, due_date: `${TODAY}T00:00:00.000Z` }, // internal, excluded
        { promised_to: 'Dan', due_date: '2026-07-23T00:00:00.000Z' }, // tomorrow, excluded
        { promised_to: 'Dan', due_date: null }, // no date, excluded
      ],
      TODAY
    );
    expect(n).toBe(1);
  });

  it('returns 0 for an empty list', () => {
    expect(countPromisedDueToday([], TODAY)).toBe(0);
  });
});

describe('dueSoonDoorSummary — Due-soon door count/subtext', () => {
  it('returns count 0 and null subtext when nothing has a due date', () => {
    expect(dueSoonDoorSummary([{ id: 't1', promised_to: null, due_date: null }])).toEqual({
      count: 0,
      subtext: null,
    });
  });

  it('subtext "promised" when any due task is promised', () => {
    const s = dueSoonDoorSummary([
      { id: 't1', promised_to: 'Dan', due_date: '2026-07-22T00:00:00.000Z' },
      { id: 't2', promised_to: null, due_date: '2026-07-23T00:00:00.000Z' },
    ]);
    expect(s).toEqual({ count: 2, subtext: 'promised' });
  });

  it('subtext "targets" when every due task is internal', () => {
    const s = dueSoonDoorSummary([
      { id: 't1', promised_to: null, due_date: '2026-07-22T00:00:00.000Z' },
      { id: 't2', promised_to: null, due_date: '2026-07-23T00:00:00.000Z' },
    ]);
    expect(s).toEqual({ count: 2, subtext: 'targets' });
  });

  it('dedupes by task id (same task referenced twice)', () => {
    const s = dueSoonDoorSummary([
      { id: 't1', promised_to: 'Dan', due_date: '2026-07-22T00:00:00.000Z' },
      { id: 't1', promised_to: 'Dan', due_date: '2026-07-22T00:00:00.000Z' },
    ]);
    expect(s.count).toBe(1);
  });
});
