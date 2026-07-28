// Clarity Phase 8 (composition) — Work mode's hero: "Today's picks", up to 3 visible +
// "N more" expander. Selection logic carried forward verbatim from the deleted
// now-strip-logic.ts's selectNowStripPicks (Clarity Phase 7 P2) — same discipline: pure,
// dependency-free, unit-testable without mounting anything.
import type { TodayPick } from '@/lib/hooks/use-today';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { isWaitingSession, isWorkingBucketSession } from '@/components/domain/oracle/oracle-logic';

export const HERO_MAX = 3;

/** Doing-column picks (started_at set, not completed) first, then the earliest-sorted
 *  remaining uncompleted picks, filling to `max`. Never touches completed picks. */
export function selectHeroPicks(picks: TodayPick[], max: number = HERO_MAX): TodayPick[] {
  const uncompleted = picks.filter((p) => !p.completed_at);
  const doing = uncompleted
    .filter((p) => !!p.started_at)
    .sort((a, b) => (a.started_at as string).localeCompare(b.started_at as string));
  const rest = uncompleted
    .filter((p) => !p.started_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...doing, ...rest].slice(0, max);
}

export type HeroSessionStatus = 'needs_you' | 'working' | 'done';

export interface HeroSessionStatusResult {
  status: HeroSessionStatus;
  detail: string;
}

/**
 * A hero pick's session-status footer, when it's linked to a live session. Resolution
 * order: an explicit session-type pick matches by external_id; an arc-type pick matches
 * the first session declared against that arc; a task-type pick has no session (null —
 * the footer is simply omitted, never a fabricated "working"). DAY-REALITY #1: sessions
 * count as WIP — this is what lets the hero honestly say "needs you"/"working" at a glance.
 */
export function heroSessionStatus(
  pick: TodayPick,
  sessions: OracleSessionWithMachine[]
): HeroSessionStatusResult | null {
  let session: OracleSessionWithMachine | undefined;

  if (pick.item_type === 'session' && pick.session_external_id) {
    session = sessions.find((s) => s.external_id === pick.session_external_id);
  } else if (pick.item_type === 'arc' && pick.arc_id) {
    session = sessions.find((s) => s.arc_id === pick.arc_id);
  }

  if (!session) return null;

  if (isWaitingSession(session)) {
    return { status: 'needs_you', detail: session.waiting_on ? `— ${session.waiting_on}` : '— needs a decision' };
  }
  if (isWorkingBucketSession(session)) {
    return { status: 'working', detail: '— no action needed' };
  }
  if (session.status === 'ended') {
    return { status: 'done', detail: '— finished' };
  }
  return null;
}
