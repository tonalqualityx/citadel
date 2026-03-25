import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatCharterResponse } from '@/lib/api/formatters';

const createCharterSchema = z.object({
  name: z.string().min(1).max(255),
  client_id: z.string().uuid(),
  accord_id: z.string().uuid().optional(),
  billing_period: z.enum(['monthly', 'annually']),
  budget_hours: z.number().min(0).optional(),
  hourly_rate: z.number().min(0).optional(),
  budget_amount: z.number().min(0).optional(),
  start_date: z.string(),
  end_date: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') as 'active' | 'paused' | 'cancelled' | null;
    const clientId = searchParams.get('client_id') || undefined;

    const where = {
      is_deleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status: status }),
      ...(clientId && { client_id: clientId }),
    };

    const [charters, total] = await Promise.all([
      prisma.charter.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true, status: true },
          },
          accord: {
            select: { id: true, name: true, status: true },
          },
          created_by: {
            select: { id: true, name: true },
          },
          _count: {
            select: { tasks: true },
          },
          charter_wares: true,
          scheduled_tasks: true,
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.charter.count({ where }),
    ]);

    return NextResponse.json({
      charters: charters.map(formatCharterResponse),
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
    const data = createCharterSchema.parse(body);

    const charter = await prisma.charter.create({
      data: {
        ...data,
        created_by_id: auth.userId,
      },
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        accord: {
          select: { id: true, name: true, status: true },
        },
        created_by: {
          select: { id: true, name: true },
        },
        _count: { select: { tasks: true } },
        charter_wares: true,
        scheduled_tasks: true,
      },
    });

    return NextResponse.json(formatCharterResponse(charter), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
