import { describe, it, expect } from 'vitest';
import {
  selectNowStripPicks,
  reasonForPick,
  computeNowStrip,
  nowStripReasonLabel,
  NOW_STRIP_MAX,
} from '../now-strip-logic';
import type { TodayPick } from '@/lib/hooks/use-today';

function pick(overrides: Partial<TodayPick> = {}): TodayPick {
  return {
    id: 'pick-1',
    date: '2026-07-27',
    item_type: 'task',
    arc_id: null,
    arc: null,
    task_id: 'task-1',
    task: { id: 'task-1', title: 'Do the thing', status: 'not_started', priority: 3, due_date: null, energy_estimate: null, battery_impact: null, mystery_factor: null  },
    session_external_id: null,
    session: null,
    charter_id: null,
    charter: null,
    accord_id: null,
    accord: null,
    label: null,
    sort: 0,
    started_at: null,
    completed_at: null,
    calendar_event_id: null,
    primary_action: { kind: 'quest' },
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
    ...overrides,
  };
}

describe('selectNowStripPicks', () => {
  it('never returns more than NOW_STRIP_MAX', () => {
    const picks = Array.from({ length: 6 }, (_, i) => pick({ id: `p${i}`, created_at: `2026-07-27T0${i}:00:00.000Z` }));
    expect(selectNowStripPicks(picks)).toHaveLength(NOW_STRIP_MAX);
  });

  it('puts Doing (started_at set) picks first', () => {
    const todo = pick({ id: 'todo-1', created_at: '2026-07-27T08:00:00.000Z' });
    const doing = pick({ id: 'doing-1', started_at: '2026-07-27T09:00:00.000Z', created_at: '2026-07-27T07:00:00.000Z' });
    const result = selectNowStripPicks([todo, doing]);
    expect(result[0].id).toBe('doing-1');
  });

  it('fills remaining slots with earliest-created uncompleted picks', () => {
    const doing = pick({ id: 'doing-1', started_at: '2026-07-27T09:00:00.000Z' });
    const early = pick({ id: 'early', created_at: '2026-07-27T06:00:00.000Z' });
    const late = pick({ id: 'late', created_at: '2026-07-27T08:00:00.000Z' });
    const result = selectNowStripPicks([late, doing, early]);
    expect(result.map((p) => p.id)).toEqual(['doing-1', 'early', 'late']);
  });

  it('excludes completed picks entirely', () => {
    const done = pick({ id: 'done-1', completed_at: '2026-07-27T09:00:00.000Z' });
    const open = pick({ id: 'open-1' });
    expect(selectNowStripPicks([done, open]).map((p) => p.id)).toEqual(['open-1']);
  });

  it('returns empty when there is nothing uncompleted', () => {
    expect(selectNowStripPicks([])).toEqual([]);
  });
});

describe('reasonForPick', () => {
  it('is in_progress once started_at is set, regardless of priority/due_date', () => {
    const p = pick({ started_at: '2026-07-27T09:00:00.000Z', task: { id: 't', title: 'x', status: 'in_progress', priority: 1, due_date: '2026-07-27T00:00:00.000Z', energy_estimate: null, battery_impact: null, mystery_factor: null  } });
    expect(reasonForPick(p, '2026-07-27')).toBe('in_progress');
  });

  it('is p1 for a priority-1 task with no started_at', () => {
    const p = pick({ task: { id: 't', title: 'x', status: 'not_started', priority: 1, due_date: null, energy_estimate: null, battery_impact: null, mystery_factor: null  } });
    expect(reasonForPick(p, '2026-07-27')).toBe('p1');
  });

  it('is p2 for a priority-2 task', () => {
    const p = pick({ task: { id: 't', title: 'x', status: 'not_started', priority: 2, due_date: null, energy_estimate: null, battery_impact: null, mystery_factor: null  } });
    expect(reasonForPick(p, '2026-07-27')).toBe('p2');
  });

  it('is due_today when the task is due today and priority is not 1/2', () => {
    const p = pick({ task: { id: 't', title: 'x', status: 'not_started', priority: 3, due_date: '2026-07-27T00:00:00.000Z', energy_estimate: null, battery_impact: null, mystery_factor: null  } });
    expect(reasonForPick(p, '2026-07-27')).toBe('due_today');
  });

  it('is NOT due_today when the due_date is a different day', () => {
    const p = pick({ task: { id: 't', title: 'x', status: 'not_started', priority: 3, due_date: '2026-07-28T00:00:00.000Z', energy_estimate: null, battery_impact: null, mystery_factor: null  } });
    expect(reasonForPick(p, '2026-07-27')).toBe('picked');
  });

  it('falls back to picked — never fabricates urgency for an arc/note pick with no task', () => {
    const p = pick({ item_type: 'note', task: null, label: 'Call the bank' });
    expect(reasonForPick(p, '2026-07-27')).toBe('picked');
  });
});

describe('nowStripReasonLabel', () => {
  it('renders a human label for every reason kind', () => {
    expect(nowStripReasonLabel('in_progress')).toBe('in progress');
    expect(nowStripReasonLabel('p1')).toBe('P1');
    expect(nowStripReasonLabel('p2')).toBe('P2');
    expect(nowStripReasonLabel('due_today')).toBe('due today');
    expect(nowStripReasonLabel('picked')).toBe('picked this morning');
  });
});

describe('computeNowStrip', () => {
  it('pairs each selected pick with its reason', () => {
    const p1 = pick({ id: 'p1', started_at: '2026-07-27T09:00:00.000Z' });
    const result = computeNowStrip([p1], '2026-07-27');
    expect(result).toEqual([{ pick: p1, reason: 'in_progress' }]);
  });
});
