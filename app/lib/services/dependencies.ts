import { prisma } from '@/lib/db/prisma';
import { notifyReleasedAssignees } from '@/lib/services/notifications';

/**
 * Dependency / blocking propagation.
 *
 * A task is `blocked` while any of its blockers is unsatisfied. A blocker is satisfied
 * when it is `done` AND one of these holds:
 * - its project is ordering-only (`project.dependencies_ordering_only === true`);
 * - it was not marked for review (`needs_review !== true`): finished work releases the next task;
 * - it was marked for review and has since been `approved`.
 * So only a done blocker that was marked `needs_review` and is not yet approved still holds its
 * dependents. Owner ruling: Mike, 2026-11-18: "Demanding that a task needs a review should be a decision";
 * and Mike, 2026-11-20, asked "Should finished work release the next task without an approval, unless
 * it was marked as needing review?": "Yes".
 *
 * An open card question can block a task too (`blocked_by_questions`; Mike, 2026-11-19: "I mean that in the way that
 * dependencies block tasks"). A task is released only when every blocker task is satisfied AND no question it waits on
 * is still open: answered, defaulted (the go-ahead date passed) and withdrawn questions no longer hold it.
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
  needs_review: boolean;
  project: { dependencies_ordering_only: boolean } | null;
};

/** Whether a single blocker satisfies its dependents: done, and approved if (and only if) it was marked for review. */
export function isBlockerSatisfied(blocker: BlockerSatisfactionShape): boolean {
  if (blocker.status !== 'done') return false;
  if (blocker.project?.dependencies_ordering_only) return true;
  return blocker.needs_review === true ? blocker.approved === true : true;
}

// The blocker fields needed to evaluate satisfaction. Shared so every query that
// feeds isBlockerSatisfied selects an identical shape.
const BLOCKER_SATISFACTION_SELECT = {
  where: { is_deleted: false },
  select: {
    id: true,
    status: true,
    approved: true,
    needs_review: true,
    project: { select: { dependencies_ordering_only: true } },
  },
} as const;

/** The questions a dependent still waits on: only open ones hold it. Shared by every query that feeds isDependentReleasable. */
const OPEN_QUESTION_BLOCKERS = {
  where: { state: 'open' },
  select: { id: true },
} as const;

/** What a dependent needs loaded to decide whether it may be released. */
const DEPENDENT_INCLUDE = {
  blocked_by: BLOCKER_SATISFACTION_SELECT,
  blocked_by_questions: OPEN_QUESTION_BLOCKERS,
} as const;

export type DependentShape = {
  blocked_by: BlockerSatisfactionShape[];
  /** Open questions only (OPEN_QUESTION_BLOCKERS); absent is read as none. */
  blocked_by_questions?: { id: string }[];
};

/** A blocked task may be released when every blocker task is satisfied and no question it waits on is still open. */
export function isDependentReleasable(task: DependentShape): boolean {
  return task.blocked_by.every(isBlockerSatisfied) && (task.blocked_by_questions?.length ?? 0) === 0;
}

/** Release (blocked -> not_started) the given dependents that are releasable. Returns the ids released. */
async function releaseReleasable(dependents: Array<DependentShape & { id: string }>): Promise<string[]> {
  const toUnblock = dependents.filter(isDependentReleasable);
  if (toUnblock.length === 0) return [];
  const ids = toUnblock.map(t => t.id);
  await prisma.task.updateMany({
    // Re-check the status in the write itself: only a task still `blocked` is ever released here,
    // so a task that was filed into triage in the meantime stays there.
    where: { id: { in: ids }, status: 'blocked' },
    data: { status: 'not_started' },
  });
  await sendHeldAssignmentNotices(ids);
  return ids;
}

/**
 * A released task is available to its assignee now: the assignment notice held while it was blocked goes out, once
 * (task 5ad27fc9). Every release path comes through here. A failed notice never fails the release.
 */
async function sendHeldAssignmentNotices(ids: string[]): Promise<void> {
  try {
    await notifyReleasedAssignees(ids);
  } catch (e) {
    console.error('held assignment notice failed', ids, e);
  }
}

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
    include: DEPENDENT_INCLUDE,
  });

  return releaseReleasable(dependentTasks);
}

/**
 * A question stopped being open (answered, withdrawn, or defaulted when its go-ahead date passed): release the cards it
 * blocked whose every other blocker, task or question, is satisfied too.
 */
export async function releaseQuestionDependents(questionId: string): Promise<string[]> {
  const dependentTasks = await prisma.task.findMany({
    where: {
      blocked_by_questions: { some: { id: questionId } },
      status: 'blocked',
      is_deleted: false,
    },
    include: DEPENDENT_INCLUDE,
  });
  return releaseReleasable(dependentTasks);
}

/** Release any of these tasks that sits in `blocked` with every blocker satisfied and no open question (after a blocker edge was removed). */
export async function releaseTasksIfReleasable(taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, status: 'blocked', is_deleted: false },
    include: DEPENDENT_INCLUDE,
  });
  return releaseReleasable(tasks);
}

/**
 * Reopening a completed blocker — re-block dependent tasks that are in active states.
 */
export async function reblockDependents(taskId: string): Promise<string[]> {
  const dependentTasks = await prisma.task.findMany({
    where: {
      blocked_by: { some: { id: taskId } },
      // triage is parked for Mike: a blocker reopening must never flip it to blocked (the heal
      // sweep would then release it to not_started).
      status: { notIn: ['triage', 'blocked', 'done', 'abandoned'] },
      is_deleted: false,
    },
    select: { id: true },
  });

  if (dependentTasks.length > 0) {
    const ids = dependentTasks.map(t => t.id);
    await prisma.task.updateMany({
      where: { id: { in: ids }, status: { notIn: ['triage', 'blocked', 'done', 'abandoned'] } },
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
 * satisfied and that waits on no open question. Robust to a missed propagation from any cause (a project toggled to
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
    include: DEPENDENT_INCLUDE,
  });

  // A blocked task with NO remaining blockers is also eligible (.every on [] is true), unless an open question holds it.
  return releaseReleasable(blockedTasks);
}
