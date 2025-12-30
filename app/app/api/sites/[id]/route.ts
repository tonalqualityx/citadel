import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatSiteResponse } from '@/lib/api/formatters';

const updateSiteSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().optional().nullable().or(z.literal('')),
  hosted_by: z.enum(['indelible', 'client', 'other']).optional(),
  platform: z.string().max(100).optional().nullable(),
  hosting_plan_id: z.string().uuid().optional().nullable(),
  maintenance_plan_id: z.string().uuid().optional().nullable(),
  maintenance_assignee_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

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
      data: {
        ...data,
        url: data.url === '' ? null : data.url,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
        hosting_plan: true,
        maintenance_plan: true,
        maintenance_assignee: {
          select: { id: true, name: true, email: true },
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
    requireRole(auth, ['admin']);
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
