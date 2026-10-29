import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { canReadAdminLists } from '@/lib/design/access';
import { isUuid } from '@/lib/design/helpers';
import { projectPrecheck, projectSessionListItem } from '@/lib/design/projections';
import { SESSION_STATUSES } from '@/lib/design/sessions';
import { authActor, requireSessionVia } from '@/lib/design/route-kit';

// GET /api/design/admin/sessions (design 7.2): the overview. Admin, pm; signed-in session only.
export async function GET(request: NextRequest) {
  try {
    const { actor } = await authActor();
    requireSessionVia(actor);
    if (!canReadAdminLists(actor.role)) throw new ApiError('Forbidden', 403, 'forbidden');
    const q = request.nextUrl.searchParams;
    const status = q.get('status');
    const siteId = q.get('site_id');
    if (status && !(SESSION_STATUSES as readonly string[]).includes(status)) throw new ApiError('Unknown status', 400, 'bad_status');
    if (siteId && !isUuid(siteId)) throw new ApiError('site_id must be a uuid', 400, 'bad_site_id');
    const rows = await prisma.designSession.findMany({
      where: {
        ...(status ? { status: status as (typeof SESSION_STATUSES)[number] } : {}),
        ...(siteId ? { site_id: siteId } : {}),
        ...(q.get('publish_requested') === 'true' ? { publish_requested_at: { not: null } } : {}),
      },
      orderBy: { updated_at: 'desc' },
      take: 200,
      select: {
        id: true, status: true, cost_usd: true, budget_usd: true, updated_at: true, last_publish_id: true,
        publish_precheck: true, publish_requested_at: true,
        task: { select: { id: true, title: true } },
        site: { select: { name: true } },
        designer: { select: { name: true } },
      },
    });
    const publishIds = rows.map((r) => r.last_publish_id).filter((v): v is string => !!v);
    const pubs = publishIds.length
      ? await prisma.designPublish.findMany({ where: { id: { in: publishIds } }, select: { id: true, status: true, finished_at: true } })
      : [];
    const pubById = new Map(pubs.map((p) => [p.id, p]));
    return NextResponse.json({
      sessions: rows.map((r) => ({
        ...projectSessionListItem({ ...r, last_publish: r.last_publish_id ? pubById.get(r.last_publish_id) ?? null : null }),
        designer: { name: r.designer.name },
        publish_requested_at: r.publish_requested_at,
        publish_precheck: projectPrecheck(r.publish_precheck),
        last_publish: r.last_publish_id ? (() => { const p = pubById.get(r.last_publish_id!); return p ? { id: p.id, status: p.status, finished_at: p.finished_at } : null; })() : null,
        // TODO(W2.7): the automatic timer view for this row.
        timer: { running: false, elapsed_s: 0 },
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
