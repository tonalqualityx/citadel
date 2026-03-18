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
} from '../utils';

// Helper: create dates at noon UTC to avoid timezone boundary issues
function d(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

describe('isBusinessDay', () => {
  it('returns true for Monday-Friday', () => {
    // 2026-03-16 is Monday
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
    // 2026-03-18 is Wednesday, +5 business days = 2026-03-25 (Wed)
    const result = addBusinessDays(d('2026-03-18'), 5);
    expect(result.getDate()).toBe(25);
    expect(result.getMonth()).toBe(2); // March = 2
  });

  it('skips a weekend', () => {
    // 2026-03-20 is Friday, +1 business day = 2026-03-23 (Monday)
    const result = addBusinessDays(d('2026-03-20'), 1);
    expect(result.getDate()).toBe(23);
    expect(result.getMonth()).toBe(2);
  });

  it('handles zero days', () => {
    const input = d('2026-03-18');
    const result = addBusinessDays(input, 0);
    expect(result.getDate()).toBe(18);
  });
});

describe('isWithinBusinessDays', () => {
  const today = d('2026-03-18'); // Wednesday

  it('returns true for null due date', () => {
    expect(isWithinBusinessDays(null, 5, today)).toBe(true);
  });

  it('returns true for overdue tasks', () => {
    expect(isWithinBusinessDays(d('2026-03-10'), 5, today)).toBe(true);
  });

  it('returns true for task due within window', () => {
    // 5 business days from Wed 3/18 = Wed 3/25
    expect(isWithinBusinessDays(d('2026-03-25'), 5, today)).toBe(true);
  });

  it('returns false for task due beyond window', () => {
    // 6 business days out = Thu 3/26
    expect(isWithinBusinessDays(d('2026-03-26'), 5, today)).toBe(false);
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
  const today = d('2026-03-18'); // Wednesday

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
    // Due Monday 3/16, today Wednesday 3/18 = 2 business days overdue
    expect(getDaysOverdue(d('2026-03-16'), today)).toBe(2);
  });

  it('skips weekends when counting overdue days', () => {
    // Due Friday 3/13, today Wednesday 3/18 = 3 business days (Mon, Tue, Wed)
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
