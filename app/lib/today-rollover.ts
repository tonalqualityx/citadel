// Seeing Stone auto-rollover (Mike, 2026-10-12): the Stone is no longer blocked behind the
// morning ritual. When Mike opens it on a new day, the most recent prior day's unfinished
// picks carry onto today automatically, so he lands where he left off instead of re-picking
// yesterday's work by hand. This is the pure half: which prior picks are still worth carrying.
// No React, no Prisma, same "pure sibling" discipline as lib/today-picks.ts.
import { getArcStatus, TERMINAL_TASK_STATUSES } from '@/lib/arc-status';
import { TODAY_PICK_WIP_CAP } from '@/lib/today-picks';
import type { TaskStatus } from '@prisma/client';

/** How far back to look for the last working day that had picks (covers weekends + a
 *  week away; older than this, the board is stale enough that a ritual should rebuild it). */
export const ROLLOVER_LOOKBACK_DAYS = 14;

/** The marker kind stamped in ritual_runs so rollover fires at most once per day, even if
 *  Mike later clears today's board on purpose. */
export const ROLLOVER_MARKER_KIND = 'rollover';

const CLOSED_ACCORD_STATUSES = ['lost'];

export interface RolloverCandidate {
  item_type: 'arc' | 'task' | 'session' | 'lead' | 'note';
  completed_at: Date | null;
  sort: number;
  arc: { closed_at: Date | null; tasks: Array<{ status: TaskStatus }> } | null;
  task: { status: TaskStatus } | null;
  accord: { status: string } | null;
}

/** A prior pick carries only if it was left unfinished AND the thing it points at is still
 *  live: an arc that has since completed (closed, or every quest done/abandoned), a quest
 *  that is done/abandoned, or a lead that was lost stays behind. Sessions and notes carry
 *  as-is. Order is kept, and the WIP ceiling is never exceeded. */
export function selectPicksToCarry<T extends RolloverCandidate>(picks: T[]): T[] {
  const carry = picks.filter((p) => {
    if (p.completed_at) return false;
    switch (p.item_type) {
      case 'arc':
        return !!p.arc && getArcStatus(p.arc) === 'open';
      case 'task':
        return !!p.task && !TERMINAL_TASK_STATUSES.includes(p.task.status);
      case 'lead':
        return !p.accord || !CLOSED_ACCORD_STATUSES.includes(p.accord.status);
      default:
        return true;
    }
  });
  return carry.slice(0, TODAY_PICK_WIP_CAP);
}
