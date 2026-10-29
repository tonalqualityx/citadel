import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { canReadAdminLists } from '@/lib/design/access';
import { isUuid } from '@/lib/design/helpers';
import { normalizeMainRole } from '@/lib/design/publish-policy';
import { authActor, requireSessionVia } from '@/lib/design/route-kit';

const PUBLISH_STATUSES = ['awaiting_confirmation', 'expired', 'queued', 'running', 'published', 'blocked_gates', 'blocked_policy', 'conflict', 'failed', 'rolled_back'] as const;

// GET /api/design/admin/publishes (design 7.2): read-only publish history across sites. Admin, pm.
// The publish model belongs to W2.4; this route only reads it.
export async function GET(request: NextRequest) {
  try {
    const { actor } = await authActor();
    requireSessionVia(actor);
    if (!canReadAdminLists(actor.role)) throw new ApiError('Forbidden', 403, 'forbidden');
    const q = request.nextUrl.searchParams;
    const siteId = q.get('site_id');
    const status = q.get('status');
    const sinceRaw = q.get('since');
    if (siteId && !isUuid(siteId)) throw new ApiError('site_id must be a uuid', 400, 'bad_site_id');
    if (status && !(PUBLISH_STATUSES as readonly string[]).includes(status)) throw new ApiError('Unknown status', 400, 'bad_status');
    let since: Date | undefined;
    if (sinceRaw) {
      since = new Date(sinceRaw);
      if (Number.isNaN(since.getTime())) throw new ApiError('since must be a date', 400, 'bad_since');
    }
    const rows = await prisma.designPublish.findMany({
      where: {
        ...(siteId ? { site_id: siteId } : {}),
        ...(status ? { status: status as (typeof PUBLISH_STATUSES)[number] } : {}),
        ...(since ? { created_at: { gte: since } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 200,
      select: { id: true, kind: true, status: true, site_id: true, actor_id: true, actor_role: true, main_role: true, created_at: true, finished_at: true, deploy_url: true },
    });
    const [sites, users] = await Promise.all([
      prisma.site.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.site_id))] } }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actor_id))] } }, select: { id: true, name: true } }),
    ]);
    const siteName = new Map(sites.map((s) => [s.id, s.name]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    return NextResponse.json({
      publishes: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        site: { name: siteName.get(r.site_id) ?? '' },
        actor: { name: userName.get(r.actor_id) ?? '', role: r.actor_role },
        main_role: normalizeMainRole(r.main_role),
        created_at: r.created_at,
        finished_at: r.finished_at,
        deploy_url: r.deploy_url,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
