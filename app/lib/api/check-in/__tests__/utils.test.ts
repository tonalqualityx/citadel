import { describe, it, expect } from 'vitest';
import {
  isBusinessDay,
  addBusinessDays,
  isWithinBusinessDays,
  isTaskUnblocked,
  isFromActiveProject,
  getActiveBadges,
  getDaysOverdue,
  calcTimeSpent,
  consolidateByProject,
  consolidateBlockingByProject,
} from '../utils';

// Helper: create dates at noon UTC to avoid timezone boundary issues
function d(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

describe('isBusinessDay', () => {
  it('returns true for Monday-Friday', () => {
    expect(isBusinessDay(d('2026-03-16'))).toBe(true); // Mon
    expect(isBusinessDay(d('2026-03-17'))).toBe(true); // Tue
    expect(isBusinessDay(d('2026-03-18'))).toBe(true); // Wed
    expect(isBusinessDay(d('2026-03-19'))).toBe(true); // Thu
    expect(isBusinessDay(d('2026-03-20'))).toBe(true); // Fri
  });

  it('returns false for Saturday and Sunday', () => {
    expect(isBusinessDay(d('2026-03-14'))).toBe(false); // Sat
    expect(isBusinessDay(d('2026-03-15'))).toBe(false); // Sun
  });
});

describe('addBusinessDays', () => {
  it('adds business days skipping weekends', () => {
    const result = addBusinessDays(d('2026-03-18'), 5);
    expect(result.getDate()).toBe(25);
    expect(result.getMonth()).toBe(2);
  });

  it('skips a weekend', () => {
    const result = addBusinessDays(d('2026-03-20'), 1);
    expect(result.getDate()).toBe(23);
    expect(result.getMonth()).toBe(2);
  });

  it('handles zero days', () => {
    const result = addBusinessDays(d('2026-03-18'), 0);
    expect(result.getDate()).toBe(18);
  });
});

describe('isWithinBusinessDays', () => {
  const today = d('2026-03-18');

  it('returns true for null due date', () => {
    expect(isWithinBusinessDays(null, 5, today)).toBe(true);
  });

  it('returns true for overdue tasks', () => {
    expect(isWithinBusinessDays(d('2026-03-10'), 5, today)).toBe(true);
  });

  it('returns true for task due within window', () => {
    expect(isWithinBusinessDays(d('2026-03-25'), 5, today)).toBe(true);
  });

  it('returns false for task due beyond window', () => {
    expect(isWithinBusinessDays(d('2026-03-26'), 5, today)).toBe(false);
  });

  it('handles 2 business day window', () => {
    // Wed + 2 biz days = Fri Mar 20
    expect(isWithinBusinessDays(d('2026-03-20'), 2, today)).toBe(true);
    // Mon Mar 23 is 3 biz days out
    expect(isWithinBusinessDays(d('2026-03-23'), 2, today)).toBe(false);
  });
});

describe('isTaskUnblocked', () => {
  it('returns true when blocked_by is empty', () => {
    expect(isTaskUnblocked({ blocked_by: [] })).toBe(true);
  });

  it('returns true when blocked_by is undefined', () => {
    expect(isTaskUnblocked({})).toBe(true);
  });

  it('returns true when all blockers are done', () => {
    expect(isTaskUnblocked({
      blocked_by: [{ status: 'done' }, { status: 'done' }],
    })).toBe(true);
  });

  it('returns false when any blocker is not done', () => {
    expect(isTaskUnblocked({
      blocked_by: [{ status: 'done' }, { status: 'in_progress' }],
    })).toBe(false);
  });

  it('returns false when only blocker is not done', () => {
    expect(isTaskUnblocked({
      blocked_by: [{ status: 'blocked' }],
    })).toBe(false);
  });
});

describe('isFromActiveProject', () => {
  it('returns true for null project', () => {
    expect(isFromActiveProject({ project: null })).toBe(true);
  });

  it('returns true for in_progress project', () => {
    expect(isFromActiveProject({ project: { status: 'in_progress' } })).toBe(true);
  });

  it('returns true for ready project', () => {
    expect(isFromActiveProject({ project: { status: 'ready' } })).toBe(true);
  });

  it('returns false for done project', () => {
    expect(isFromActiveProject({ project: { status: 'done' } })).toBe(false);
  });

  it('returns false for suspended project', () => {
    expect(isFromActiveProject({ project: { status: 'suspended' } })).toBe(false);
  });
});

describe('getActiveBadges', () => {
  const today = d('2026-03-18');

  it('marks overdue tasks', () => {
    const badges = getActiveBadges({ due_date: d('2026-03-12'), priority: 3 }, today);
    expect(badges).toContain('overdue');
    expect(badges).not.toContain('high_priority');
  });

  it('marks due_today tasks', () => {
    const badges = getActiveBadges({ due_date: d('2026-03-18'), priority: 4 }, today);
    expect(badges).toContain('due_today');
  });

  it('marks due_tomorrow tasks', () => {
    const badges = getActiveBadges({ due_date: d('2026-03-19'), priority: 4 }, today);
    expect(badges).toContain('due_tomorrow');
  });

  it('marks high_priority for P1', () => {
    const badges = getActiveBadges({ due_date: null, priority: 1 }, today);
    expect(badges).toContain('high_priority');
  });

  it('marks high_priority for P2', () => {
    const badges = getActiveBadges({ due_date: null, priority: 2 }, today);
    expect(badges).toContain('high_priority');
  });

  it('does not mark high_priority for P3+', () => {
    const badges = getActiveBadges({ due_date: null, priority: 3 }, today);
    expect(badges).not.toContain('high_priority');
  });

  it('combines overdue and high_priority', () => {
    const badges = getActiveBadges({ due_date: d('2026-03-10'), priority: 1 }, today);
    expect(badges).toContain('overdue');
    expect(badges).toContain('high_priority');
  });

  it('returns empty for future low-priority task', () => {
    const badges = getActiveBadges({ due_date: d('2026-04-01'), priority: 4 }, today);
    expect(badges).toEqual([]);
  });
});

describe('getDaysOverdue', () => {
  const today = d('2026-03-18');

  it('returns 0 for null due date', () => {
    expect(getDaysOverdue(null, today)).toBe(0);
  });

  it('returns 0 for future due date', () => {
    expect(getDaysOverdue(d('2026-03-20'), today)).toBe(0);
  });

  it('returns 0 for due today', () => {
    expect(getDaysOverdue(d('2026-03-18'), today)).toBe(0);
  });

  it('counts business days overdue', () => {
    expect(getDaysOverdue(d('2026-03-16'), today)).toBe(2);
  });

  it('skips weekends when counting overdue days', () => {
    expect(getDaysOverdue(d('2026-03-13'), today)).toBe(3);
  });
});

describe('calcTimeSpent', () => {
  it('returns 0 for no time entries', () => {
    expect(calcTimeSpent({})).toBe(0);
  });

  it('sums durations', () => {
    expect(calcTimeSpent({
      time_entries: [{ duration: 30 }, { duration: 45 }, { duration: 15 }],
    })).toBe(90);
  });

  it('handles zero durations', () => {
    expect(calcTimeSpent({
      time_entries: [{ duration: 0 }, { duration: 60 }],
    })).toBe(60);
  });
});

describe('consolidateByProject', () => {
  const proj = (id: string, name: string) => ({ id, name });

  it('returns tasks individually when ≤2 per project', () => {
    const tasks = [
      { id: '1', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-20') },
      { id: '2', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-21') },
      { id: '3', project: proj('p2', 'Beta'), project_id: 'p2', due_date: d('2026-03-19') },
    ];
    const result = consolidateByProject(tasks);
    expect(result.individual).toHaveLength(3);
    expect(result.consolidated).toHaveLength(0);
  });

  it('consolidates when 3+ tasks from same project', () => {
    const tasks = [
      { id: '1', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-22') },
      { id: '2', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-20') },
      { id: '3', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-25') },
      { id: '4', project: proj('p2', 'Beta'), project_id: 'p2', due_date: d('2026-03-19') },
    ];
    const result = consolidateByProject(tasks);
    expect(result.individual).toHaveLength(1); // Beta task
    expect(result.consolidated).toHaveLength(1);
    expect(result.consolidated[0].project!.name).toBe('Alpha');
    expect(result.consolidated[0].task_count).toBe(3);
    expect(result.consolidated[0].nearest_due_date).toBe('2026-03-20');
  });

  it('handles tasks with no due date in consolidated group', () => {
    const tasks = [
      { id: '1', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: null },
      { id: '2', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: null },
      { id: '3', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-20') },
    ];
    const result = consolidateByProject(tasks);
    expect(result.consolidated).toHaveLength(1);
    expect(result.consolidated[0].nearest_due_date).toBe('2026-03-20');
  });

  it('returns null nearest_due_date when all tasks have no due date', () => {
    const tasks = [
      { id: '1', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: null },
      { id: '2', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: null },
      { id: '3', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: null },
    ];
    const result = consolidateByProject(tasks);
    expect(result.consolidated[0].nearest_due_date).toBeNull();
  });
});

describe('consolidateBlockingByProject', () => {
  const proj = (id: string, name: string) => ({ id, name });

  it('includes blocked persons in consolidated entries', () => {
    const tasks = [
      { id: '1', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-20'), blocking_details: [{ user: 'Sabeen', due_date: '2026-03-21', urgency: 'urgent' as const, task: 'T1' }] },
      { id: '2', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-22'), blocking_details: [{ user: 'Sabeen', due_date: '2026-03-23', urgency: 'standard' as const, task: 'T2' }] },
      { id: '3', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-24'), blocking_details: [{ user: 'Ange', due_date: '2026-03-25', urgency: 'standard' as const, task: 'T3' }] },
    ];
    const result = consolidateBlockingByProject(tasks);
    expect(result.consolidated).toHaveLength(1);
    expect(result.consolidated[0].task_count).toBe(3);
    expect(result.consolidated[0].blocked_persons).toHaveLength(2);
    const sabeen = result.consolidated[0].blocked_persons.find((p) => p.name === 'Sabeen');
    expect(sabeen).toBeDefined();
    expect(sabeen!.nearest_due_date).toBe('2026-03-21');
    const ange = result.consolidated[0].blocked_persons.find((p) => p.name === 'Ange');
    expect(ange).toBeDefined();
  });

  it('keeps ≤2 tasks individual', () => {
    const tasks = [
      { id: '1', project: proj('p1', 'Alpha'), project_id: 'p1', due_date: d('2026-03-20'), blocking_details: [{ user: 'Sabeen', due_date: '2026-03-21', urgency: 'urgent' as const, task: 'T1' }] },
    ];
    const result = consolidateBlockingByProject(tasks);
    expect(result.individual).toHaveLength(1);
    expect(result.consolidated).toHaveLength(0);
  });
});
