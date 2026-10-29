import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { canReadAdminLists } from '@/lib/design/access';
import { designerMayPublish, mainRoleFor } from '@/lib/design/publish-policy';
import { authActor, requireSessionVia } from '@/lib/design/route-kit';

// GET /api/design/admin/sites (design 7.2): every live site with its three design switches, for the admin
// page's per-site toggles. Admin, pm; signed-in session only. Read twin of PATCH /api/design/admin/sites/:id.
export async function GET() {
  try {
    const { actor } = await authActor();
    requireSessionVia(actor);
    if (!canReadAdminLists(actor.role)) throw new ApiError('Forbidden', 403, 'forbidden');
    const [rows, settings, state] = await Promise.all([
      prisma.site.findMany({
        where: { is_deleted: false },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, url: true, design_portal_enabled: true, designer_publish: true, design_auto_timer: true },
      }),
      prisma.designPortalSettings.findUnique({ where: { id: 1 }, select: { designer_publish_mode: true } }),
      prisma.designWorkerState.findUnique({ where: { id: 1 }, select: { site_main_roles: true } }),
    ]);
    const mode = settings?.designer_publish_mode ?? 'per_site';
    return NextResponse.json({
      sites: rows.map((s) => {
        const mainRole = mainRoleFor(s.id, state?.site_main_roles);
        return {
          id: s.id,
          name: s.name,
          url: s.url,
          design_portal_enabled: s.design_portal_enabled,
          designer_publish: s.designer_publish,
          design_auto_timer: s.design_auto_timer,
          effective_designer_publish: designerMayPublish(s, { designer_publish_mode: mode }, mainRole),
          main_role: mainRole,
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
