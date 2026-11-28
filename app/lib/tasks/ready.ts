/**
 * When a task is ready for the person it is assigned to (task abe6e46c). Mike, 2026-11-28: "We've got to fix this so you
 * don't see work I can't do as waiting on me. That throws our numbers and gives me a small heart attack when I see there's
 * suddenly 20 new items. If they're real fine, but if 14 aren't ready for me then they aren't truly waiting on me."
 *
 * A task is ready only when every task it waits on is finished: done or abandoned. A blocker still sitting in Triage is
 * not finished (a Triage hold card holds its work until it is released and then closed), and neither is any other open
 * status. A task becomes new to its owner when it became ready: when it was made, or when its last blocker finished,
 * whichever is later.
 */
import { Prisma, TaskStatus } from '@prisma/client';

/** The blocker statuses that release the work behind them. Triage is deliberately not one of them. */
export const CLEARED_BLOCKER_STATUSES: TaskStatus[] = [TaskStatus.done, TaskStatus.abandoned];

/** Where-clause: the task has no unfinished blocker. */
export const noOpenBlockerWhere = {
  blocked_by: { none: { is_deleted: false, status: { notIn: CLEARED_BLOCKER_STATUSES } } },
} satisfies Prisma.TaskWhereInput;

/** Where-clause: the task has at least one unfinished blocker (it is held behind other work). */
export const hasOpenBlockerWhere = {
  blocked_by: { some: { is_deleted: false, status: { notIn: CLEARED_BLOCKER_STATUSES } } },
} satisfies Prisma.TaskWhereInput;

/** The blocker fields readySince needs. */
export const BLOCKER_FINISH_SELECT = {
  where: { is_deleted: false },
  select: { status: true, completed_at: true, updated_at: true },
} as const;

export type BlockerFinish = { status: string; completed_at: Date | null; updated_at?: Date | null };

/**
 * When the task became ready: the later of when it was made and when its last finished blocker finished. A done blocker
 * finished at completed_at; an abandoned one (which may carry no completed_at) at completed_at, else updated_at.
 * Unfinished blockers are ignored here; callers only ask this of tasks that are ready.
 */
export function readySince(createdAt: Date | null | undefined, blockers: BlockerFinish[] | null | undefined): Date | null {
  let since: Date | null = createdAt ?? null;
  for (const b of blockers ?? []) {
    if (!CLEARED_BLOCKER_STATUSES.includes(b.status as TaskStatus)) continue;
    const at = b.completed_at ?? b.updated_at ?? null;
    if (at && (!since || at.getTime() > since.getTime())) since = at;
  }
  return since;
}
