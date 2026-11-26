import { describe, it, expect } from 'vitest';
import {
  allotmentHours, attributeEntries, decideCurrentMonth, estimateRange, hoursText, isEligibleCharter, mergeDraftItems, monthLabel,
  planningTaskDescription, planningTaskTitle, rangeText, shiftMonth, shouldClose, shouldDraftNext, usageFromCounted, itemRangeError,
  type UsageEntry,
} from '../helpers';

const client = (retainer_hours: unknown = null) => ({ id: 'c', name: 'Kava Bars', retainer_hours });
const entry = (minutes: number, id: string, charter_id: string | null, is_retainer_work = false): UsageEntry => ({
  minutes, task: { id, title: `Task ${id}`, charter_id, is_retainer_work },
});

describe('allotmentHours', () => {
  it('uses the charter budget_hours first', () => expect(allotmentHours({ budget_hours: '10', client: client(8) })).toBe(10));
  it('falls back to the client retainer_hours when the charter has none', () => {
    expect(allotmentHours({ budget_hours: null, client: client('8.5') })).toBe(8.5);
    expect(allotmentHours({ budget_hours: 0, client: client(8) })).toBe(8);
  });
  it('is 0 with neither', () => expect(allotmentHours({ budget_hours: null, client: client() })).toBe(0));
});

describe('isEligibleCharter', () => {
  const base = { status: 'active', is_deleted: false, billing_period: 'monthly' };
  it('needs active, not deleted, monthly', () => {
    expect(isEligibleCharter(base)).toBe(true);
    expect(isEligibleCharter({ ...base, status: 'paused' })).toBe(false);
    expect(isEligibleCharter({ ...base, is_deleted: true })).toBe(false);
    expect(isEligibleCharter({ ...base, billing_period: 'annually' })).toBe(false);
  });
});

describe('estimates and wording', () => {
  it('gives a range from energy, mystery and battery', () => {
    expect(estimateRange({ energy_estimate: 3, mystery_factor: 'average', battery_impact: 'average_drain', estimated_minutes: null })).toEqual({ low: 60, high: 106 });
  });
  it('falls back to estimated_minutes, then zero', () => {
    expect(estimateRange({ energy_estimate: null, mystery_factor: 'none', battery_impact: null, estimated_minutes: 100 })).toEqual({ low: 70, high: 100 });
    expect(estimateRange({ energy_estimate: null, mystery_factor: 'none', battery_impact: null, estimated_minutes: null })).toEqual({ low: 0, high: 0 });
  });
  it('formats hours and ranges', () => {
    expect(hoursText(210)).toBe('3.5 h');
    expect(hoursText(120)).toBe('2 h');
    expect(rangeText(180, 240)).toBe('3 to 4 h');
    expect(rangeText(60, 60)).toBe('1 h');
    expect(monthLabel('2026-12')).toBe('December 2026');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('rejects a backwards range', () => {
    expect(itemRangeError(5, 3)).toMatch(/low/);
    expect(itemRangeError(3, 3)).toBeNull();
  });
});

describe('mergeDraftItems', () => {
  it('drops repeats of a task or recurring row and numbers positions', () => {
    const a = { title: 'A', estimate_min_low: 1, estimate_min_high: 2, recurring_work_id: 'r1', task_id: 't1' };
    const out = mergeDraftItems([[a], [{ ...a, title: 'dup task', recurring_work_id: null }, { ...a, title: 'dup row', task_id: null }, { ...a, title: 'B', recurring_work_id: null, task_id: 't2' }]]);
    expect(out.map((i) => [i.title, i.position])).toEqual([['A', 0], ['B', 1]]);
  });
});

describe('planning task text', () => {
  it('titles and describes the month with the total and the last line', () => {
    expect(planningTaskTitle('Kava Bars', '2026-12')).toBe('Kava Bars: plan December 2026 retainer work');
    const d = planningTaskDescription({ month: '2026-12', hours: 10, items: [{ title: 'Two blog posts', estimate_min_low: 180, estimate_min_high: 240 }, { title: 'Report', estimate_min_low: 60, estimate_min_high: 90 }] });
    expect(d).toContain('10 h of retainer time');
    expect(d).toContain('- Two blog posts: 3 to 4 h');
    expect(d).toContain('Total: 4 to 5.5 h of 10 h');
    expect(d).toContain('Use this plan');
    expect(d.trim().split('\n').pop()).toBe('Finalized by: a step Mike takes.');
  });
});

describe('cycle decisions', () => {
  const d = (day: number) => new Date(2026, 10, day, 1, 20);
  it('drafts next month from the 25th, not the 24th', () => {
    expect(shouldDraftNext(d(24))).toBe(false);
    expect(shouldDraftNext(d(25))).toBe(true);
  });
  it('a current month with no row: task on the 1st, backfill after', () => {
    expect(decideCurrentMonth(d(1), null)).toBe('draft_with_task');
    expect(decideCurrentMonth(d(2), null)).toBe('draft_backfill');
  });
  it('a planning current month stands once the 1st has passed', () => {
    expect(decideCurrentMonth(d(1), { state: 'planning' })).toBe('none');
    expect(decideCurrentMonth(d(2), { state: 'planning' })).toBe('auto_plan');
    expect(decideCurrentMonth(d(2), { state: 'planned' })).toBe('none');
  });
  it('closes only earlier months not already closed', () => {
    expect(shouldClose({ month: '2026-10', state: 'planned' }, '2026-11')).toBe(true);
    expect(shouldClose({ month: '2026-10', state: 'closed' }, '2026-11')).toBe(false);
    expect(shouldClose({ month: '2026-11', state: 'planned' }, '2026-11')).toBe(false);
  });
});

describe('attributeEntries', () => {
  const es = [entry(60, 'a', 'ch1'), entry(30, 'b', null, true), entry(45, 'c', null, false), entry(20, 'd', 'other', true)];
  it('counts charter time, and retainer-work time with exactly one monthly charter', () => {
    const r = attributeEntries(es, 'ch1', 1);
    expect(r.counted.map((e) => e.task.id)).toEqual(['a', 'b']);
    expect(r.unassigned_minutes).toBe(0);
  });
  it('with two monthly charters the no-charter time is unassigned, not counted', () => {
    const r = attributeEntries(es, 'ch1', 2);
    expect(r.counted.map((e) => e.task.id)).toEqual(['a']);
    expect(r.unassigned_minutes).toBe(30);
  });
});

describe('usageFromCounted', () => {
  it('splits used per item and outside the plan, ignoring the planning task', () => {
    const counted = [entry(60, 'a', 'ch'), entry(30, 'a', 'ch'), entry(45, 'x', 'ch'), entry(15, 'y', 'ch'), entry(10, 'plan', 'ch')];
    const r = usageFromCounted(counted, [{ id: 'i1', task_id: 'a' }, { id: 'i2', task_id: null }], 20, 'plan');
    expect(r.used_minutes).toBe(160);
    expect(r.item_minutes).toEqual({ i1: 90, i2: 0 });
    expect(r.outside).toEqual([{ id: 'x', title: 'Task x', minutes: 45 }, { id: 'y', title: 'Task y', minutes: 15 }]);
    expect(r.outside_minutes).toBe(60);
    expect(r.unassigned_minutes).toBe(20);
  });

  it('counts a task generated from a planned recurring row toward that item, not outside the plan', () => {
    const generated: UsageEntry = { minutes: 50, task: { id: 'gen', title: 'Monthly report', charter_id: 'ch', is_retainer_work: true, recurring_work_id: 'rw1' } };
    const r = usageFromCounted([generated, entry(20, 'z', 'ch')], [{ id: 'i1', task_id: null, recurring_work_id: 'rw1' }], 0, null);
    expect(r.item_minutes).toEqual({ i1: 50 });
    expect(r.outside).toEqual([{ id: 'z', title: 'Task z', minutes: 20 }]);
    expect(r.used_minutes).toBe(70);
  });
});
