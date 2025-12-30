import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatSiteResponse } from '@/lib/api/formatters';

const createSiteSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url().optional().or(z.literal('')),
  client_id: z.string().uuid(),
  hosted_by: z.enum(['indelible', 'client', 'other']).optional(),
  platform: z.string().max(100).optional(),
  hosting_plan_id: z.string().uuid().optional().nullable(),
  maintenance_plan_id: z.string().uuid().optional().nullable(),
  maintenance_assignee_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const client_id = searchParams.get('client_id') || undefined;
    const hosted_by = searchParams.get('hosted_by') as 'indelible' | 'client' | 'other' | null;

    const where = {
      is_deleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { url: { contains: search, mode: 'insensitive' as const } },
          { platform: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(client_id && { client_id }),
      ...(hosted_by && { hosted_by }),
    };

    const [sites, total] = await Promise.all([
      prisma.site.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true },
          },
          hosting_plan: true,
          maintenance_plan: true,
          maintenance_assignee: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { domains: true },
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.site.count({ where }),
    ]);

    return NextResponse.json({
      sites: sites.map(formatSiteResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createSiteSchema.parse(body);

    // Validate client exists
    const client = await prisma.client.findUnique({
      where: { id: data.client_id, is_deleted: false },
    });
    if (!client) {
      throw new ApiError('Client not found', 404);
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

    const site = await prisma.site.create({
      data: {
        ...data,
        url: data.url || null,
        hosted_by: data.hosted_by || 'indelible',
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

    return NextResponse.json(formatSiteResponse(site), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
