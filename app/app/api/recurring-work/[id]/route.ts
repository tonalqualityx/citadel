import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { formatRecurringWorkResponse } from '@/lib/api/formatters';
import {
  RECURRING_WORK_INCLUDE,
  assertKindFields,
  assertLinksExist,
  assertNoCopyOfCharter,
  recurringWorkUpdateSchema,
} from '@/lib/recurring-work/service';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/recurring-work/[id]
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    await requireAuth();
    const { id } = await params;
    const row = await prisma.recurringWork.findUnique({ where: { id }, include: RECURRING_WORK_INCLUDE });
    if (!row) throw new ApiError('Recurring work not found', 404);
    return NextResponse.json(formatRecurringWorkResponse(row));
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/recurring-work/[id] - any field except kind. Deactivate with is_active: false; there is no hard delete.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const data = recurringWorkUpdateSchema.parse(await request.json());

    const existing = await prisma.recurringWork.findUnique({ where: { id } });
    if (!existing) throw new ApiError('Recurring work not found', 404);

    // The kind's required fields must still be set after the change
    const merged = { ...existing, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
    assertKindFields(merged);
    assertNoCopyOfCharter(data);
    await assertLinksExist(data);

    const updateData: Record<string, unknown> = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    // a row moved onto a charter drops its own client and site: from then on they are the charter's
    if (data.charter_id) Object.assign(updateData, { client_id: null, site_id: null });
    // a client or site set on a charter row would be a second copy
    else if (existing.charter_id && data.charter_id === undefined && (data.client_id || data.site_id)) {
      throw new ApiError('A charter row takes its client and site from the charter', 400);
    }
    const updated = await prisma.recurringWork.update({ where: { id }, data: updateData, include: RECURRING_WORK_INCLUDE });
    return NextResponse.json(formatRecurringWorkResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
