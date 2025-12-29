import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatClientResponse } from '@/lib/api/formatters';

const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['direct', 'agency_partner', 'sub_client']).optional(),
  status: z.enum(['active', 'inactive', 'delinquent']).optional(),
  primary_contact: z.string().max(255).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  retainer_hours: z.number().min(0).optional(),
  hourly_rate: z.number().min(0).optional(),
  parent_agency_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') as 'active' | 'inactive' | 'delinquent' | null;
    const type = searchParams.get('type') as 'direct' | 'agency_partner' | 'sub_client' | null;

    const where = {
      is_deleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { primary_contact: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status }),
      ...(type && { type }),
    };

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          _count: {
            select: { sites: true, sub_clients: true },
          },
          parent_agency: {
            select: { id: true, name: true },
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.client.count({ where }),
    ]);

    return NextResponse.json({
      clients: clients.map(formatClientResponse),
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
    const data = createClientSchema.parse(body);

    // Validate parent agency exists if provided
    if (data.parent_agency_id) {
      const parent = await prisma.client.findUnique({
        where: { id: data.parent_agency_id },
      });
      if (!parent || parent.type !== 'agency_partner') {
        throw new ApiError('Invalid parent agency', 400);
      }
    }

    const client = await prisma.client.create({
      data: {
        ...data,
        email: data.email || null,
        type: data.type || 'direct',
      },
      include: {
        _count: { select: { sites: true, sub_clients: true } },
      },
    });

    return NextResponse.json(formatClientResponse(client), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
