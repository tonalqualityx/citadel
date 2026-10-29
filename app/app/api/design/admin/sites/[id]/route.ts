import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { isUuid } from '@/lib/design/helpers';
import { designerMayPublish, mainRoleFor } from '@/lib/design/publish-policy';
import { authActor, body, guardMutation, requireAdmin, requireSessionVia, type IdParams } from '@/lib/design/route-kit';

const siteSchema = z
  .object({ design_portal_enabled: z.boolean(), designer_publish: z.boolean(), design_auto_timer: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

// PATCH /api/design/admin/sites/:id (design 7.2): the ONLY writer of design_portal_enabled, designer_publish
// and design_auto_timer (kept out of PATCH /api/sites/:id). Admin, signed-in session.
export async function PATCH(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor({ operator: 'setup' });
    requireSessionVia(actor, 'setup');
    requireAdmin(actor);
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError('Site not found', 404, 'not_found');
    const existing = await prisma.site.findUnique({ where: { id }, select: { id: true, is_deleted: true } });
    if (!existing || existing.is_deleted) throw new ApiError('Site not found', 404, 'not_found');
    const input = await body(request, siteSchema, 4096);
    const site = await prisma.site.update({
      where: { id },
      data: input,
      select: { id: true, design_portal_enabled: true, designer_publish: true, design_auto_timer: true },
    });
    const [settings, state] = await Promise.all([
      prisma.designPortalSettings.findUnique({ where: { id: 1 }, select: { designer_publish_mode: true } }),
      prisma.designWorkerState.findUnique({ where: { id: 1 }, select: { site_main_roles: true } }),
    ]);
    const mainRole = mainRoleFor(site.id, state?.site_main_roles);
    return NextResponse.json({
      site: {
        id: site.id,
        design_portal_enabled: site.design_portal_enabled,
        designer_publish: site.designer_publish,
        design_auto_timer: site.design_auto_timer,
        effective_designer_publish: designerMayPublish(site, { designer_publish_mode: settings?.designer_publish_mode ?? 'per_site' }, mainRole),
        main_role: mainRole,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
