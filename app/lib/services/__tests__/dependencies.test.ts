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
} from '../dependencies';
import type { Mock } from 'vitest';

const mockFindMany = prisma.task.findMany as Mock;
const mockUpdateMany = prisma.task.updateMany as Mock;

// Build a blocker entry as selected by the satisfaction queries.
function blocker(id: string, status: string, approved: boolean, orderingOnly: boolean | null) {
  return {
    id,
    status,
    approved,
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
  it('approval-gated: done but unapproved is NOT satisfied', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', false, false))).toBe(false);
  });
  it('approval-gated: done AND approved is satisfied', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', true, false))).toBe(true);
  });
  it('no project falls back to approval-gated (done is not enough)', () => {
    expect(isBlockerSatisfied(blocker('b', 'done', false, null))).toBe(false);
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
            project: { select: { dependencies_ordering_only: true } },
          },
        },
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
      where: { id: { in: ['dep-1'] } },
      data: { status: 'not_started' },
    });
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
      where: { id: { in: ['ready'] } },
      data: { status: 'not_started' },
    });
  });

  it('heals a task left blocked with no remaining blockers (missed propagation)', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'orphan', blocked_by: [] }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const ids = await healBlockedTasks();

    expect(ids).toEqual(['orphan']);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['orphan'] } },
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
            project: { select: { dependencies_ordering_only: true } },
          },
        },
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
        status: { notIn: ['blocked', 'done', 'abandoned'] },
        is_deleted: false,
      },
      select: { id: true },
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['dep-1'] } },
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
