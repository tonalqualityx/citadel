import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAccordResponse } from '@/lib/api/formatters';

const createAccordSchema = z.object({
  name: z.string().min(1).max(255),
  client_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),
  lead_name: z.string().max(255).optional(),
  lead_business_name: z.string().max(255).optional(),
  lead_email: z.string().email().optional().or(z.literal('')),
  lead_phone: z.string().max(50).optional(),
  lead_notes: z.string().optional(),
  status: z.enum(['lead', 'meeting']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') as 'lead' | 'meeting' | 'proposal' | 'contract' | 'signed' | 'active' | 'lost' | null;
    const owner_id = searchParams.get('owner_id') || undefined;
    const client_id = searchParams.get('client_id') || undefined;

    const where = {
      is_deleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { lead_name: { contains: search, mode: 'insensitive' as const } },
          { lead_business_name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status }),
      ...(owner_id && { owner_id }),
      ...(client_id && { client_id }),
    };

    const [accords, total] = await Promise.all([
      prisma.accord.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true, status: true },
          },
          owner: {
            select: { id: true, name: true, email: true, avatar_url: true },
          },
          _count: {
            select: {
              charter_items: { where: { is_deleted: false } },
              commission_items: { where: { is_deleted: false } },
              keep_items: { where: { is_deleted: false } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.accord.count({ where }),
    ]);

    return NextResponse.json({
      accords: accords.map(formatAccordResponse),
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
    const data = createAccordSchema.parse(body);

    // Validate client exists if provided
    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    const accord = await prisma.accord.create({
      data: {
        name: data.name,
        status: data.status || 'lead',
        client_id: data.client_id || null,
        owner_id: data.owner_id || auth.userId,
        lead_name: data.lead_name || null,
        lead_business_name: data.lead_business_name || null,
        lead_email: data.lead_email || null,
        lead_phone: data.lead_phone || null,
        lead_notes: data.lead_notes || null,
      },
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        owner: {
          select: { id: true, name: true, email: true, avatar_url: true },
        },
        _count: {
          select: {
            charter_items: { where: { is_deleted: false } },
            commission_items: { where: { is_deleted: false } },
            keep_items: { where: { is_deleted: false } },
          },
        },
      },
    });

    return NextResponse.json(formatAccordResponse(accord), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
