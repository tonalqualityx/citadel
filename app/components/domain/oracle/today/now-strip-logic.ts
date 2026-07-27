// Clarity Phase 7 (Seeing Stone Reckoning P2) — the Now Strip (spec Q7): up to 3 items,
// each with ONE honestly-derived reason chip. Pure, dependency-free (same discipline as
// today-board-logic.ts/time-shape-logic.ts) so the selection + reason math is unit-testable
// without a DB or React. Research law (P2 distillation #11): "execution view shows 1-3 items
// WITH the reason" — never fabricated, never blended with the planning view.
import type { TodayPick } from '@/lib/hooks/use-today';

export const NOW_STRIP_MAX = 3;

export type NowStripReason = 'in_progress' | 'p1' | 'p2' | 'due_today' | 'picked';

export interface NowStripEntry {
  pick: TodayPick;
  reason: NowStripReason;
}

const REASON_LABEL: Record<NowStripReason, string> = {
  in_progress: 'in progress',
  p1: 'P1',
  p2: 'P2',
  due_today: 'due today',
  picked: 'picked this morning',
};

export function nowStripReasonLabel(reason: NowStripReason): string {
  return REASON_LABEL[reason];
}

/** Doing-column picks (started_at set, not completed) first, then the earliest-sorted
 *  remaining uncompleted picks, filling to NOW_STRIP_MAX. Never touches completed picks. */
export function selectNowStripPicks(picks: TodayPick[], max: number = NOW_STRIP_MAX): TodayPick[] {
  const uncompleted = picks.filter((p) => !p.completed_at);
  const doing = uncompleted
    .filter((p) => !!p.started_at)
    .sort((a, b) => (a.started_at as string).localeCompare(b.started_at as string));
  const rest = uncompleted
    .filter((p) => !p.started_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return [...doing, ...rest].slice(0, max);
}

/**
 * The single honest reason a pick is showing right now. Priority order (most concrete/
 * true-right-now first, never stacked — the spec calls for ONE chip): already in progress
 * beats everything else (it's the most immediate truth); otherwise a genuinely high-
 * priority underlying task; otherwise a task due today; otherwise the plain, always-true
 * fallback of when it was picked — never invented urgency for a pick with none.
 */
export function reasonForPick(pick: TodayPick, todayDateStr: string): NowStripReason {
  if (pick.started_at) return 'in_progress';
  if (pick.task?.priority === 1) return 'p1';
  if (pick.task?.priority === 2) return 'p2';
  if (pick.task?.due_date && pick.task.due_date.slice(0, 10) === todayDateStr) return 'due_today';
  return 'picked';
}

export function computeNowStrip(
  picks: TodayPick[],
  todayDateStr: string,
  max: number = NOW_STRIP_MAX
): NowStripEntry[] {
  return selectNowStripPicks(picks, max).map((pick) => ({ pick, reason: reasonForPick(pick, todayDateStr) }));
}
