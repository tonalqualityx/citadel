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
 * Whether every blocker in `blockerIds` is currently satisfied (per each blocker's project
 * gating mode). Reuses the same select shape as the reactive triggers above (never a second,
 * drifting copy of the field list) — see `BLOCKER_SATISFACTION_SELECT`. An empty list is
 * vacuously satisfied (`.every` on `[]` is `true`), matching `healBlockedTasks`' own
 * "no remaining blockers" case.
 *
 * Used by the task-create and task-PATCH dependency wiring (project-record-citadel-changes.md
 * addendum, ruling 32) to decide whether a newly-connected dependent starts/moves to `blocked`.
 */
export async function areBlockersSatisfied(blockerIds: string[]): Promise<boolean> {
  if (blockerIds.length === 0) return true;
  const blockers = await prisma.task.findMany({
    where: { id: { in: blockerIds }, ...BLOCKER_SATISFACTION_SELECT.where },
    select: BLOCKER_SATISFACTION_SELECT.select,
  });
  return blockers.every(isBlockerSatisfied);
}

/**
 * Cycle detection for the ad hoc dependency API (project-record-citadel-changes.md addendum,
 * ruling 32). The recipe wizard only ever wires a DAG by construction; individually-created/
 * -patched tasks have no such guarantee, so every `blocked_by` connect must be checked before
 * it's written.
 *
 * Adding the edge `taskId depends on candidateBlockerId` creates a cycle exactly when
 * `candidateBlockerId` is `taskId` itself, or when `taskId` is already reachable by walking
 * FROM the candidate along its own `blocked_by` edges (i.e. the candidate already, directly or
 * transitively, depends on `taskId` — so the new edge would close a loop). BFS, bounded by a
 * visited set so it terminates even over a graph that already (incorrectly) has a cycle in it.
 */
export async function wouldCreateCycle(
  taskId: string,
  candidateBlockerIds: string[]
): Promise<boolean> {
  const uniqueCandidates = Array.from(new Set(candidateBlockerIds));
  if (uniqueCandidates.includes(taskId)) return true; // self-dependency

  const visited = new Set<string>(uniqueCandidates);
  let frontier = uniqueCandidates;

  while (frontier.length > 0) {
    const rows = await prisma.task.findMany({
      where: { id: { in: frontier } },
      select: { blocked_by: { select: { id: true } } },
    });

    const nextFrontier: string[] = [];
    for (const row of rows) {
      for (const b of row.blocked_by) {
        if (b.id === taskId) return true;
        if (!visited.has(b.id)) {
          visited.add(b.id);
          nextFrontier.push(b.id);
        }
      }
    }
    frontier = nextFrontier;
  }

  return false;
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
