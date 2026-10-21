import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatSiteResponse } from '@/lib/api/formatters';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

const updateSiteSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().max(500).optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  hosted_by: z.enum(['indelible', 'client', 'other']).optional(),
  platform: z.string().max(100).optional().nullable(),
  hosting_plan_id: z.string().uuid().optional().nullable(),
  hosting_discount: z.number().min(0).optional().nullable(),
  maintenance_plan_id: z.string().uuid().optional().nullable(),
  maintenance_assignee_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Troubador publishing config
  site_type: z.enum(['eleventy', 'wordpress', 'handoff', 'custom']).optional().nullable(),
  repo_url: z.string().max(500).optional().nullable(),
  repo_branch: z.string().max(100).optional().nullable(),
  content_dir: z.string().max(255).optional().nullable(),
  wp_base_url: z.string().max(500).optional().nullable(),
  wp_default_author: z.string().max(255).optional().nullable(),
  wp_default_category: z.string().max(255).optional().nullable(),
  handoff_method: z.string().max(50).optional().nullable(),
  handoff_recipient: z.string().max(255).optional().nullable(),
  // Staging + Bast worker config
  prod_branch: z.string().max(100).optional().nullable(),
  staging_branch: z.string().max(100).optional().nullable(),
  staging_url: z.string().max(500).optional().nullable(),
  staging_auth_user: z.string().max(255).optional().nullable(),
  staging_auth_password: z.string().max(255).optional().nullable(),
  bast_enabled: z.boolean().optional(),
  auto_deploy: z.boolean().optional(),
  // Portal phase C: chat switch and the analytics ids the chat tools read (admin, or the Bast user)
  portal_chat_enabled: z.boolean().optional(),
  ga4_property: z.string().max(64).regex(/^properties\/\d+$/).optional().nullable(),
  gsc_property: z.string().max(255).regex(/^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+)$/i).optional().nullable(),
});

const CHAT_SITE_FIELDS = ['portal_chat_enabled', 'ga4_property', 'gsc_property'] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const site = await prisma.site.findUnique({
      where: { id, is_deleted: false },
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        hosting_plan: true,
        maintenance_plan: true,
        maintenance_assignee: {
          select: { id: true, name: true, email: true },
        },
        domains: {
          where: { is_deleted: false },
          orderBy: [{ is_primary: 'desc' }, { name: 'asc' }],
        },
        _count: { select: { domains: true } },
      },
    });

    if (!site) {
      throw new ApiError('Site not found', 404);
    }

    return NextResponse.json(formatSiteResponse(site));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateSiteSchema.parse(body);

    // The chat switch and the analytics ids are admin settings; the Bast user may write them for the
    // backfill. A pm cannot.
    if (CHAT_SITE_FIELDS.some((f) => data[f] !== undefined) && auth.role !== 'admin' && auth.userId !== BAST_USER_ID) {
      throw new ApiError('Only an admin can change the chat switch or analytics ids', 403);
    }

    // Validate client exists if provided (and not null)
    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id, is_deleted: false },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    // Validate hosting plan exists if provided
    if (data.hosting_plan_id) {
      const hostingPlan = await prisma.hostingPlan.findUnique({
        where: { id: data.hosting_plan_id },
      });
      if (!hostingPlan) {
        throw new ApiError('Hosting plan not found', 404);
      }
    }

    // Validate maintenance plan exists if provided
    if (data.maintenance_plan_id) {
      const maintenancePlan = await prisma.maintenancePlan.findUnique({
        where: { id: data.maintenance_plan_id },
      });
      if (!maintenancePlan) {
        throw new ApiError('Maintenance plan not found', 404);
      }
    }

    // Validate maintenance assignee exists if provided
    if (data.maintenance_assignee_id) {
      const assignee = await prisma.user.findUnique({
        where: { id: data.maintenance_assignee_id },
      });
      if (!assignee) {
        throw new ApiError('Maintenance assignee not found', 404);
      }
    }

    const site = await prisma.site.update({
      where: { id },
      data,
      include: {
        client: {
          select: { id: true, name: true },
        },
        hosting_plan: true,
        maintenance_plan: true,
        maintenance_assignee: {
          select: { id: true, name: true, email: true },
        },
        domains: {
          where: { is_deleted: false },
          orderBy: [{ is_primary: 'desc' }, { name: 'asc' }],
        },
        _count: { select: { domains: true } },
      },
    });

    return NextResponse.json(formatSiteResponse(site));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    // Soft delete site and its domains
    await prisma.$transaction([
      prisma.domain.updateMany({
        where: { site_id: id },
        data: { is_deleted: true },
      }),
      prisma.site.update({
        where: { id },
        data: { is_deleted: true },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
