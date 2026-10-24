import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeSiteKpi } from '@/lib/kpis/serialize';
import { KPI_DIRECTIONS, KPI_SOURCES } from '@/lib/kpis/proposal';

const uuid = z.string().uuid();
const num = z.number().finite().min(-999_999_999_999.99).max(999_999_999_999.99);

const patchSchema = z
  .object({
    site_id: uuid.nullable().optional(),
    charter_id: uuid.nullable().optional(),
    label: z.string().trim().min(1).max(200).optional(),
    direction: z.enum(KPI_DIRECTIONS).optional(),
    baseline_value: num.nullable().optional(),
    baseline_at: z.string().datetime({ offset: true }).nullable().optional(),
    target_value: num.nullable().optional(),
    target_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    source: z.enum(KPI_SOURCES).optional(),
    status: z.enum(['proposed', 'confirmed', 'retired']).optional(),
    last_value: num.nullable().optional(),
    last_checked_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

async function load(id: string) {
  if (!uuid.safeParse(id).success) throw new ApiError('KPI not found', 404);
  const row = await prisma.siteKpi.findUnique({ where: { id } });
  if (!row) throw new ApiError('KPI not found', 404);
  return row;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    return NextResponse.json(serializeSiteKpi(await load(id)));
  } catch (error) {
    return handleApiError(error);
  }
}

/** PATCH /api/site-kpis/:id: edit fields. The metric and the client never change. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    const row = await load(id);

    if (body.site_id) {
      const s = await prisma.site.findFirst({ where: { id: body.site_id, client_id: row.client_id, is_deleted: false }, select: { id: true } });
      if (!s) throw new ApiError('site_id is not a site of this client', 400);
    }
    if (body.charter_id) {
      const c = await prisma.charter.findFirst({ where: { id: body.charter_id, client_id: row.client_id, is_deleted: false }, select: { id: true } });
      if (!c) throw new ApiError('charter_id is not a charter of this client', 400);
    }
    const now = new Date();
    const { baseline_at, target_by, last_checked_at, status, ...rest } = body;
    const updated = await prisma.siteKpi.update({
      where: { id },
      data: {
        ...rest,
        ...(baseline_at !== undefined ? { baseline_at: baseline_at ? new Date(baseline_at) : null } : {}),
        ...(target_by !== undefined ? { target_by: target_by ? new Date(`${target_by}T00:00:00Z`) : null } : {}),
        ...(last_checked_at !== undefined ? { last_checked_at: last_checked_at ? new Date(last_checked_at) : null } : {}),
        ...(status !== undefined
          ? { status, ...(status === 'confirmed' && !row.confirmed_at ? { confirmed_at: now } : {}) }
          : {}),
      },
    });
    return NextResponse.json(serializeSiteKpi(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

/** DELETE /api/site-kpis/:id: retire the KPI. Never a hard delete; the row stays. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    await load(id);
    const updated = await prisma.siteKpi.update({ where: { id }, data: { status: 'retired' } });
    return NextResponse.json(serializeSiteKpi(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
