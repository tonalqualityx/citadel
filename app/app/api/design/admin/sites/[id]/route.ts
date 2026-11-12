import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { isUuid } from '@/lib/design/helpers';
import { designerMayPublish, mainRoleFor } from '@/lib/design/publish-policy';
import { authActor, body, guardMutation, requireAdmin, requireSessionVia, type IdParams } from '@/lib/design/route-kit';

const siteSchema = z
  .object({
    design_portal_enabled: z.boolean(),
    designer_publish: z.boolean(),
    design_auto_timer: z.boolean(),
    // Only 'portal' or null (not set) is settable here; designer and zero_design are not.
    design_path: z.literal('portal').nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

// PATCH /api/design/admin/sites/:id (design 7.2): the ONLY writer of design_portal_enabled, designer_publish,
// design_auto_timer and design_path (kept out of PATCH /api/sites/:id). design_path accepts 'portal' or null only.
// Admin, signed-in session only: no API-key path.
export async function PATCH(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor({ operator: 'setup' });
    requireSessionVia(actor, 'setup');
    requireAdmin(actor);
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError('Site not found', 404, 'not_found');
    const existing = await prisma.site.findUnique({ where: { id }, select: { id: true, is_deleted: true, site_type: true } });
    if (!existing || existing.is_deleted) throw new ApiError('Site not found', 404, 'not_found');
    const input = await body(request, siteSchema, 4096);
    // The drawer lists only eleventy sites, so enabling any other type would succeed and show nothing. An untyped
    // site is stamped eleventy when enabled; any other type is refused.
    const data: typeof input & { site_type?: 'eleventy' } = { ...input };
    if (input.design_portal_enabled === true) {
      if (existing.site_type === null || existing.site_type === undefined) data.site_type = 'eleventy';
      else if (existing.site_type !== 'eleventy') throw new ApiError('only eleventy sites can use the Designer Portal', 409, 'site_not_eleventy');
    }
    const site = await prisma.site.update({
      where: { id },
      data,
      select: { id: true, design_portal_enabled: true, designer_publish: true, design_auto_timer: true, design_path: true },
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
        design_path: site.design_path,
        effective_designer_publish: designerMayPublish(site, { designer_publish_mode: settings?.designer_publish_mode ?? 'per_site' }, mainRole),
        main_role: mainRole,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
