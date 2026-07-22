import { prisma } from '@/lib/db/prisma';
import { formatTodayPickResponse } from '@/lib/api/formatters';
import { getArcStatus, getArcProgressPercent } from '@/lib/arc-status';
import { primaryActionKindForPick, type TodayPickItemType } from '@/lib/today-picks';

// Clarity Phase 3 — extracted from app/api/today/route.ts in Clarity Phase 5 so the new
// GET /api/oracle/soothsayer route (which needs the SAME per-type-joined-summary shaping,
// for 7 days at once) never drifts from /api/today's own single-day shaping. Both routes
// import this; neither re-implements it.

export const PICK_INCLUDE = {
  arc: { include: { tasks: { select: { status: true } } } },
  task: { select: { id: true, title: true, status: true } },
  charter: { select: { id: true, name: true } },
} as const;

export function fetchTodayPicksForDate(date: Date) {
  return prisma.todayPick.findMany({
    where: { date },
    include: PICK_INCLUDE,
    orderBy: [{ sort: 'asc' }, { created_at: 'asc' }],
  });
}

/** Attach the per-type joined summary + derived primary action a Today card needs to
 *  render. `withProgress` additionally carries the arc's progress_percent — the Soothsayer's
 *  day columns render "arc name + progress" per its own spec; /api/today's existing shape
 *  doesn't need it and stays byte-for-byte unchanged when this is left false. */
export async function shapeTodayPicks(
  picks: Awaited<ReturnType<typeof fetchTodayPicksForDate>>,
  opts: { withProgress?: boolean } = {}
) {
  const sessionIds = Array.from(
    new Set(
      picks.filter((p) => p.item_type === 'session' && p.session_external_id).map((p) => p.session_external_id as string)
    )
  );

  const sessions = sessionIds.length
    ? await prisma.oracleSession.findMany({
        where: { external_id: { in: sessionIds } },
        // Clarity Phase 4c — needs_attention/last_event_at feed the session-type pick
        // card's own quiet "waiting since <time>" line (parity fix with the arc board's
        // attention dot/session panel).
        select: {
          external_id: true,
          title: true,
          status: true,
          remote_url: true,
          goal: true,
          needs_attention: true,
          last_event_at: true,
        },
      })
    : [];
  const sessionByExternalId = new Map(sessions.map((s) => [s.external_id, s]));

  return picks.map((pick) => {
    const arcSummary = pick.arc
      ? {
          id: pick.arc.id,
          name: pick.arc.name,
          status: getArcStatus(pick.arc),
          task_count: pick.arc.tasks.length,
          // Clarity Phase 5 — carried through so an arc-type pick's card can render its own
          // SnoozeMenu with the correct current state (an already-snoozed arc still shows
          // "Unsnooze", not the quick-option list, even though it's odd to have picked a
          // snoozed arc for today in the first place).
          snoozed_until: pick.arc.snoozed_until ?? null,
          ...(opts.withProgress ? { progress_percent: getArcProgressPercent(pick.arc.tasks) } : {}),
        }
      : null;

    const sessionSummary = pick.session_external_id
      ? sessionByExternalId.get(pick.session_external_id) ?? null
      : null;

    const primaryAction = {
      kind: primaryActionKindForPick(pick.item_type as TodayPickItemType, {
        hasRemoteUrl: !!sessionSummary?.remote_url,
      }),
    };

    return formatTodayPickResponse(pick, {
      arcSummary,
      sessionSummary: sessionSummary
        ? {
            external_id: sessionSummary.external_id,
            title: sessionSummary.title,
            status: sessionSummary.status,
            remote_url: sessionSummary.remote_url,
            goal: sessionSummary.goal,
            needs_attention: sessionSummary.needs_attention,
            last_event_at: sessionSummary.last_event_at,
          }
        : null,
      primaryAction,
    });
  });
}
