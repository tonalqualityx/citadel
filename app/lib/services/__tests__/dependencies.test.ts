import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing the service under test.
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db/prisma';
import {
  isBlockerSatisfied,
  unblockEligibleDependents,
  reblockDependents,
  healBlockedTasks,
  areBlockersSatisfied,
  wouldCreateCycle,
  isDependentReleasable,
  releaseQuestionDependents,
  releaseTasksIfReleasable,
} from '../dependencies';
import type { Mock } from 'vitest';

const mockFindMany = prisma.task.findMany as Mock;
const mockUpdateMany = prisma.task.updateMany as Mock;

// Build a blocker entry as selected by the satisfaction queries.
function blocker(id: string, status: string, approved: boolean, orderingOnly: boolean | null, needsReview = true) {
  return {
    id,
    status,
    approved,
    needs_review: needsReview,
    project: orderingOnly === null ? null : { dependencies_ordering_only: orderingOnly },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isBlockerSatisfied', () => {
  it('ordering-only: satisfied once done (no approval needed)', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', false, true))).toBe(true);
  });
  it('ordering-only: not satisfied while not done', () => {
    expect(isBlockerSatisfied(blocker('b', 'in_progress', true, true))).toBe(false);
  });
  it('marked for review: done but unapproved is NOT satisfied', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', false, false))).toBe(false);
  });
  it('marked for review: done AND approved is satisfied', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', true, false))).toBe(true);
  });
  it('no project and marked for review: done is not enough', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', false, null))).toBe(false);
  });
  it('done, unapproved, not marked for review, review-gated project: satisfied', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', false, false, false))).toBe(true);
  });
  it('not done is never satisfied, even when not marked for review', () => {
    expect(isBlockerSatisfied(blocker('b', 'in_progress', false, false, false))).toBe(false);
  });
  it('no project and not marked for review: satisfied once done', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', false, null, false))).toBe(true);
  });
});

describe('healBlockedTasks (self-healing sweep)', () => {
  it('sweeps ALL blocked tasks (not scoped to one blocker)', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await healBlockedTasks();

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { status: 'blocked', is_deleted: false },
      include: {
        blocked_by: {
          where: { is_deleted: false },
          select: {
            id: true,
            status: true,
            approved: true,
            needs_review: true,
            project: { select: { dependencies_ordering_only: true } },
          },
        },
        blocked_by_questions: { where: { state: 'open' }, select: { id: true } },
      },
    });
  });

  it('unblocks an ordering-only dependent whose blockers are all done', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'dep-1', blocked_by: [blocker('b1', 'done', false, true)] },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const ids = await healBlockedTasks();

    expect(ids).toEqual(['dep-1']);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['dep-1'] }, status: 'blocked' },
      data: { status: 'not_started' },
    });
  });

  it('releases a dependent whose done blocker was not marked for review, unapproved', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'dep-1', blocked_by: [blocker('b1', 'done', false, false, false)] },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    expect(await healBlockedTasks()).toEqual(['dep-1']);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['dep-1'] }, status: 'blocked' },
      data: { status: 'not_started' },
    });
  });

  it('does not release a dependent whose done blocker was marked for review and is unapproved', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'dep-1', blocked_by: [blocker('b1', 'done', false, false, true)] },
    ]);

    expect(await healBlockedTasks()).toEqual([]);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('does NOT unblock an approval-gated dependent whose blocker is done-but-unapproved', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'dep-1', blocked_by: [blocker('b1', 'done', false, false)] },
    ]);

    const ids = await healBlockedTasks();

    expect(ids).toEqual([]);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('multi-blocker: unblocks only dependents whose blockers are ALL satisfied', async () => {
    mockFindMany.mockResolvedValueOnce([
      // ready: both blockers done in an ordering-only project
      {
        id: 'ready',
        blocked_by: [blocker('b1', 'done', false, true), blocker('b2', 'done', false, true)],
      },
      // not ready: one blocker still in progress
      {
        id: 'waiting',
        blocked_by: [blocker('b1', 'done', false, true), blocker('b3', 'in_progress', false, true)],
      },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const ids = await healBlockedTasks();

    expect(ids).toEqual(['ready']);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ready'] }, status: 'blocked' },
      data: { status: 'not_started' },
    });
  });

  it('heals a task left blocked with no remaining blockers (missed propagation)', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'orphan', blocked_by: [] }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const ids = await healBlockedTasks();

    expect(ids).toEqual(['orphan']);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['orphan'] }, status: 'blocked' },
      data: { status: 'not_started' },
    });
  });

  it('is a no-op when nothing is eligible', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const ids = await healBlockedTasks();
    expect(ids).toEqual([]);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

describe('unblockEligibleDependents (scoped reactive trigger)', () => {
  it('queries only dependents blocked by the given task and unblocks the satisfied ones', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'dep-1', blocked_by: [blocker('task-1', 'done', false, true)] },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const ids = await unblockEligibleDependents('task-1');

    expect(ids).toEqual(['dep-1']);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        blocked_by: { some: { id: 'task-1' } },
        status: 'blocked',
        is_deleted: false,
      },
      include: {
        blocked_by: {
          where: { is_deleted: false },
          select: {
            id: true,
            status: true,
            approved: true,
            needs_review: true,
            project: { select: { dependencies_ordering_only: true } },
          },
        },
        blocked_by_questions: { where: { state: 'open' }, select: { id: true } },
      },
    });
  });
});

describe('reblockDependents (reopen trigger)', () => {
  it('re-blocks dependents in active states', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'dep-1' }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const ids = await reblockDependents('task-1');

    expect(ids).toEqual(['dep-1']);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        blocked_by: { some: { id: 'task-1' } },
        status: { notIn: ['triage', 'blocked', 'done', 'abandoned'] },
        is_deleted: false,
      },
      select: { id: true },
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['dep-1'] }, status: { notIn: ['triage', 'blocked', 'done', 'abandoned'] } },
      data: { status: 'blocked' },
    });
  });

  it('does nothing when there are no active dependents', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const ids = await reblockDependents('task-1');
    expect(ids).toEqual([]);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

// project-record-citadel-changes.md addendum (ruling 32) — dependency API predicates shared
// by the task create/PATCH routes.
describe('areBlockersSatisfied', () => {
  it('is vacuously true for an empty blocker list (no query issued)', async () => {
    const result = await areBlockersSatisfied([]);
    expect(result).toBe(true);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('is true when every blocker satisfies its project gating mode', async () => {
    mockFindMany.mockResolvedValueOnce([
      blocker('b1', 'done', true, false),
      blocker('b2', 'done', false, true),
    ]);

    const result = await areBlockersSatisfied(['b1', 'b2']);

    expect(result).toBe(true);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['b1', 'b2'] }, is_deleted: false },
      select: {
        id: true,
        status: true,
        approved: true,
        needs_review: true,
        project: { select: { dependencies_ordering_only: true } },
      },
    });
  });

  it('is false when any blocker is unsatisfied', async () => {
    mockFindMany.mockResolvedValueOnce([
      blocker('b1', 'done', true, false),
      blocker('b2', 'in_progress', false, true),
    ]);

    const result = await areBlockersSatisfied(['b1', 'b2']);
    expect(result).toBe(false);
  });
});

describe('wouldCreateCycle', () => {
  it('rejects a task depending directly on itself', async () => {
    const result = await wouldCreateCycle('task-1', ['task-1']);
    expect(result).toBe(true);
    expect(mockFindMany).not.toHaveBeenCalled(); // caught before any query
  });

  it('is false when the candidate blocker has no blockers of its own', async () => {
    mockFindMany.mockResolvedValueOnce([{ blocked_by: [] }]);

    const result = await wouldCreateCycle('task-1', ['task-2']);

    expect(result).toBe(false);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['task-2'] } },
      select: { blocked_by: { select: { id: true } } },
    });
  });

  it('detects an indirect cycle: candidate transitively already depends on the task', async () => {
    // task-1 wants to add "depends on task-2". task-2 already depends on task-3, which
    // already depends on task-1 — adding the edge would close the loop.
    mockFindMany
      .mockResolvedValueOnce([{ blocked_by: [{ id: 'task-3' }] }]) // frontier: task-2
      .mockResolvedValueOnce([{ blocked_by: [{ id: 'task-1' }] }]); // frontier: task-3

    const result = await wouldCreateCycle('task-1', ['task-2']);

    expect(result).toBe(true);
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });

  it('is false for an unrelated, non-cyclic dependency graph', async () => {
    mockFindMany
      .mockResolvedValueOnce([{ blocked_by: [{ id: 'task-9' }] }])
      .mockResolvedValueOnce([{ blocked_by: [] }]);

    const result = await wouldCreateCycle('task-1', ['task-2']);
    expect(result).toBe(false);
  });

  it('terminates on a graph that already contains a cycle unrelated to the check', async () => {
    // task-9 <-> task-10 already cycle among themselves; must not infinite-loop.
    mockFindMany
      .mockResolvedValueOnce([{ blocked_by: [{ id: 'task-9' }] }])
      .mockResolvedValueOnce([{ blocked_by: [{ id: 'task-10' }] }])
      .mockResolvedValueOnce([{ blocked_by: [{ id: 'task-9' }] }]);

    const result = await wouldCreateCycle('task-1', ['task-2']);
    expect(result).toBe(false);
  });
});

describe('open questions block like unfinished blocker tasks (Mike, 2026-11-19)', () => {
  it('a dependent with an open question is not releasable, even with every blocker task satisfied', () => {
    expect(isDependentReleasable({ blocked_by: [blocker('b', 'done', true, false)], blocked_by_questions: [{ id: 'q1' }] })).toBe(false);
    expect(isDependentReleasable({ blocked_by: [], blocked_by_questions: [{ id: 'q1' }] })).toBe(false);
  });
  it('no open question and satisfied blockers: releasable (questions absent reads as none)', () => {
    expect(isDependentReleasable({ blocked_by: [blocker('b', 'done', true, false)], blocked_by_questions: [] })).toBe(true);
    expect(isDependentReleasable({ blocked_by: [] })).toBe(true);
  });
  it('an open question never releases a card whose blocker task is unfinished', () => {
    expect(isDependentReleasable({ blocked_by: [blocker('b', 'in_progress', false, true)], blocked_by_questions: [] })).toBe(false);
  });

  it('healBlockedTasks leaves a card an open question holds, releases the rest', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'held', blocked_by: [], blocked_by_questions: [{ id: 'q1' }] },
      { id: 'free', blocked_by: [], blocked_by_questions: [] },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const ids = await healBlockedTasks();
    expect(ids).toEqual(['free']);
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ['free'] }, status: 'blocked' }, data: { status: 'not_started' } });
  });

  it('releaseQuestionDependents reads only the blocked cards of that question', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'dep', blocked_by: [], blocked_by_questions: [] }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const ids = await releaseQuestionDependents('q1');
    expect(ids).toEqual(['dep']);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { blocked_by_questions: { some: { id: 'q1' } }, status: 'blocked', is_deleted: false },
    }));
  });

  it('releaseTasksIfReleasable with no ids touches nothing', async () => {
    expect(await releaseTasksIfReleasable([])).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
