import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatClientResponse } from '@/lib/api/formatters';

const updateClientSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(['direct', 'agency_partner', 'sub_client']).optional(),
  status: z.enum(['active', 'inactive', 'delinquent']).optional(),
  primary_contact: z.string().max(255).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  retainer_hours: z.number().min(0).optional().nullable(),
  hourly_rate: z.number().min(0).optional().nullable(),
  retainer_usage_mode: z.enum(['low', 'medium', 'high', 'actual']).optional(),
  parent_agency_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const client = await prisma.client.findUnique({
      where: { id, is_deleted: false },
      include: {
        sites: {
          where: { is_deleted: false },
          include: {
            hosting_plan: true,
            maintenance_plan: true,
            _count: { select: { domains: true } },
          },
        },
        sub_clients: {
          where: { is_deleted: false },
          select: { id: true, name: true, status: true },
        },
        parent_agency: {
          select: { id: true, name: true },
        },
        _count: { select: { sites: true, sub_clients: true } },
      },
    });

    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    return NextResponse.json(formatClientResponse(client));
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
    const data = updateClientSchema.parse(body);

    const client = await prisma.client.update({
      where: { id },
      data: {
        ...data,
        email: data.email === '' ? null : data.email,
      },
      include: {
        _count: { select: { sites: true, sub_clients: true } },
      },
    });

    return NextResponse.json(formatClientResponse(client));
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

    // Soft delete
    await prisma.client.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
