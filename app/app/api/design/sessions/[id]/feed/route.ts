import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { feed, hasUndelivered, FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT } from '@/lib/design/events';
import { canPublish, mainRoleFor } from '@/lib/design/publish-policy';
import { latestLibIndex, projectFeed } from '@/lib/design/projections';
import { onPresence } from '@/lib/design/presence';
import { authActor, type IdParams } from '@/lib/design/route-kit';

function intParam(raw: string | null, name: string, min: number, max: number): number | undefined {
  if (raw === null || raw === '') return undefined;
  if (!/^\d+$/.test(raw)) throw new ApiError(`${name} must be a non-negative integer`, 400, `bad_${name}`);
  const n = Number(raw);
  if (n < min || n > max) throw new ApiError(`${name} must be between ${min} and ${max}`, 400, `bad_${name}`);
  return n;
}

// GET /api/design/sessions/:id/feed?after=<seq>&limit=200&visible=1|0 (design 7.1): the poll.
export async function GET(request: NextRequest, { params }: IdParams) {
  try {
    const { actor } = await authActor({ operator: 'publish' }); // read-only for an operator-publish key
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'read' });
    const q = request.nextUrl.searchParams;
    const after = intParam(q.get('after'), 'after', 0, 2_000_000_000) ?? 0;
    const limit = intParam(q.get('limit'), 'limit', 1, FEED_MAX_LIMIT) ?? FEED_DEFAULT_LIMIT;
    const visible = q.get('visible') === '1';

    // W2.7 hook: keeps the automatic timer alive on visible polls (no-op until then).
    // An operator key is not a person in the workspace: it never starts, keeps or observes a timer.
    const timer = actor.operator ? null : await onPresence(session, visible, actor);

    const [page, site, settings, state, running, undelivered, libIndexEvent] = await Promise.all([
      feed(session.id, { after, limit }),
      prisma.site.findUnique({ where: { id: session.site_id }, select: { id: true, design_portal_enabled: true, designer_publish: true, is_deleted: true } }),
      prisma.designPortalSettings.findUnique({ where: { id: 1 }, select: { designer_publish_mode: true } }),
      prisma.designWorkerState.findUnique({ where: { id: 1 }, select: { site_main_roles: true, last_heartbeat_at: true, paused: true } }),
      prisma.designPublish.findMany({ where: { site_id: session.site_id, status: { in: ['queued', 'running'] } }, select: { id: true, session_id: true } }),
      hasUndelivered(session.id),
      prisma.designEvent.findFirst({ where: { session_id: session.id, kind: 'lib_index' }, orderBy: { seq: 'desc' }, select: { payload: true } }),
    ]);

    const mainRole = mainRoleFor(session.site_id, state?.site_main_roles);
    const publishDecision = site
      ? // loadSessionFor already refused a designer who is not on the session's project (W8.2 H2).
        canPublish(actor, { ...session, designer_on_project: actor.role === 'designer' }, site, { designer_publish_mode: settings?.designer_publish_mode ?? 'per_site' }, mainRole, { publishRunning: running.length > 0 })
      : ({ ok: false, code: 'site_not_enabled' } as const);
    const own = running.find((p) => p.session_id === session.id);

    const projected = projectFeed({
      session,
      // lib_index events carry the whole index; the UI gets the sha, not the payload.
      events: page.events.filter((e) => e.kind !== 'lib_index'),
      libIndexSha: latestLibIndex(libIndexEvent?.payload)?.sha ?? null,
      publishDecision: publishDecision.ok ? { ok: true } : { ok: false, code: publishDecision.code },
      mainRole,
      runningPublishId: own?.id ?? null,
      timer,
      hasUndelivered: undelivered,
      worker: state ? { last_heartbeat_at: state.last_heartbeat_at, paused: state.paused } : null,
    });
    return NextResponse.json({ ...projected, last_seq: page.last_seq, has_more: page.has_more });
  } catch (error) {
    return handleApiError(error);
  }
}
