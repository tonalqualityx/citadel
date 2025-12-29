import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatProjectResponse } from '@/lib/api/formatters';

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z
    .enum(['quote', 'queue', 'ready', 'in_progress', 'review', 'done', 'suspended', 'cancelled'])
    .optional(),
  type: z.enum(['project', 'retainer', 'internal']).optional(),
  billing_type: z.enum(['fixed', 'hourly', 'retainer', 'none']).optional().nullable(),
  client_id: z.string().uuid(),
  site_id: z.string().uuid().optional().nullable(),
  start_date: z.string().datetime().optional().nullable(),
  target_date: z.string().datetime().optional().nullable(),
  budget_amount: z.number().min(0).optional().nullable(),
  is_retainer: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') as any;
    const type = searchParams.get('type') as any;
    const clientId = searchParams.get('client_id') || undefined;
    const siteId = searchParams.get('site_id') || undefined;

    const where: any = {
      is_deleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(status && { status }),
      ...(type && { type }),
      ...(clientId && { client_id: clientId }),
      ...(siteId && { site_id: siteId }),
    };

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true, status: true },
          },
          site: {
            select: { id: true, name: true, url: true },
          },
          created_by: {
            select: { id: true, name: true },
          },
          tasks: {
            where: { is_deleted: false },
            select: { estimated_minutes: true, status: true },
          },
          _count: {
            select: { team_assignments: true },
          },
        },
        orderBy: [{ status: 'asc' }, { updated_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.project.count({ where }),
    ]);

    return NextResponse.json({
      projects: projects.map(formatProjectResponse),
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
    const data = createProjectSchema.parse(body);

    // Validate client exists
    const client = await prisma.client.findUnique({
      where: { id: data.client_id, is_deleted: false },
    });
    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    // Validate site exists and belongs to client if provided
    if (data.site_id) {
      const site = await prisma.site.findUnique({
        where: { id: data.site_id, is_deleted: false },
      });
      if (!site) {
        throw new ApiError('Site not found', 404);
      }
      if (site.client_id !== data.client_id) {
        throw new ApiError('Site does not belong to this client', 400);
      }
    }

    const project = await prisma.project.create({
      data: {
        name: data.name,
        description: data.description,
        status: data.status || 'quote',
        type: data.type || 'project',
        billing_type: data.billing_type,
        client_id: data.client_id,
        site_id: data.site_id,
        start_date: data.start_date ? new Date(data.start_date) : null,
        target_date: data.target_date ? new Date(data.target_date) : null,
        budget_amount: data.budget_amount,
        is_retainer: data.is_retainer || false,
        notes: data.notes,
        created_by_id: auth.userId,
      },
      include: {
        client: { select: { id: true, name: true, status: true } },
        site: { select: { id: true, name: true, url: true } },
        created_by: { select: { id: true, name: true } },
        _count: { select: { tasks: true, team_assignments: true } },
      },
    });

    return NextResponse.json(formatProjectResponse(project), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
