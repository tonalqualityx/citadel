import { prisma } from '@/lib/db/prisma';

/**
 * Dependency / blocking propagation.
 *
 * A task is `blocked` while any of its blockers is unsatisfied. Whether a single
 * blocker is satisfied depends on its project's gating mode:
 * - ordering-only (`project.dependencies_ordering_only === true`): satisfied once `done`.
 * - approval-gated (default): satisfied only once `done` AND `approved` — so we never
 *   build on unreviewed work. A blocker with no project falls back to approval-gated.
 *
 * The reactive triggers (`unblockEligibleDependents`, `reblockDependents`) fire from a
 * specific blocker's status/approval change. `healBlockedTasks` is the global backstop:
 * it re-evaluates EVERY `blocked` task, so a missed propagation from any path
 * (e.g. a project flipped to ordering-only, a status changed outside the PATCH route)
 * self-heals instead of leaving a task silently stuck where the loop can never see it.
 */

export type BlockerSatisfactionShape = {
  status: string;
  approved: boolean;
  project: { dependencies_ordering_only: boolean } | null;
};

/** Whether a single blocker satisfies its dependents, given its project's gating mode. */
export function isBlockerSatisfied(blocker: BlockerSatisfactionShape): boolean {
  if (blocker.status !== 'done') return false;
  const orderingOnly = blocker.project?.dependencies_ordering_only ?? false;
  return orderingOnly ? true : blocker.approved === true;
}

// The blocker fields needed to evaluate satisfaction. Shared so every query that
// feeds isBlockerSatisfied selects an identical shape.
const BLOCKER_SATISFACTION_SELECT = {
  where: { is_deleted: false },
  select: {
    id: true,
    status: true,
    approved: true,
    project: { select: { dependencies_ordering_only: true } },
  },
} as const;

/**
 * Re-evaluate every task currently `blocked` by `taskId` and unblock those whose blockers
 * are ALL satisfied (per each blocker's project gating mode). Shared by the done-trigger and
 * the approval-trigger so both modes converge on the same predicate.
 */
export async function unblockEligibleDependents(taskId: string): Promise<string[]> {
  const dependentTasks = await prisma.task.findMany({
    where: {
      blocked_by: { some: { id: taskId } },
      status: 'blocked',
      is_deleted: false,
    },
    include: {
      blocked_by: BLOCKER_SATISFACTION_SELECT,
    },
  });

  const toUnblock = dependentTasks.filter(t => t.blocked_by.every(isBlockerSatisfied));
  if (toUnblock.length > 0) {
    const ids = toUnblock.map(t => t.id);
    await prisma.task.updateMany({
      where: { id: { in: ids } },
      data: { status: 'not_started' },
    });
    return ids;
  }
  return [];
}

/**
 * Reopening a completed blocker — re-block dependent tasks that are in active states.
 */
export async function reblockDependents(taskId: string): Promise<string[]> {
  const dependentTasks = await prisma.task.findMany({
    where: {
      blocked_by: { some: { id: taskId } },
      status: { notIn: ['blocked', 'done', 'abandoned'] },
      is_deleted: false,
    },
    select: { id: true },
  });

  if (dependentTasks.length > 0) {
    const ids = dependentTasks.map(t => t.id);
    await prisma.task.updateMany({
      where: { id: { in: ids } },
      data: { status: 'blocked' },
    });
    return ids;
  }
  return [];
}

/**
 * Self-healing backstop: sweep EVERY `blocked` task and unblock any whose blockers are all
 * satisfied. Robust to a missed propagation from any cause (a project toggled to
 * ordering-only, a blocker completed via a path that didn't run the reactive trigger, etc.).
 * Idempotent — running it when nothing is eligible is a no-op.
 *
 * @returns the ids of the tasks that were unblocked.
 */
export async function healBlockedTasks(): Promise<string[]> {
  const blockedTasks = await prisma.task.findMany({
    where: {
      status: 'blocked',
      is_deleted: false,
    },
    include: {
      blocked_by: BLOCKER_SATISFACTION_SELECT,
    },
  });

  // A blocked task with NO remaining blockers is also eligible (.every on [] is true).
  const toUnblock = blockedTasks.filter(t => t.blocked_by.every(isBlockerSatisfied));
  if (toUnblock.length > 0) {
    const ids = toUnblock.map(t => t.id);
    await prisma.task.updateMany({
      where: { id: { in: ids } },
      data: { status: 'not_started' },
    });
    return ids;
  }
  return [];
}
