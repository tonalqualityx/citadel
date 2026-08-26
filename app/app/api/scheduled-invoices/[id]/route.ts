import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatScheduledInvoiceResponse } from '@/lib/api/formatters';

// project-record-citadel-changes.md section 1.3 / 2.3 (ruling 33) — status-driving PATCH.
// quickbooks_ref is Mike-typed only, never fetched (ruling 12) — this route never reaches
// out to QuickBooks itself, it only stores whatever string the caller sends.
const updateScheduledInvoiceSchema = z.object({
  status: z.string().max(30).optional(),
  due_on: z.string().optional().nullable(),
  amount_cached: z.number().min(0).optional().nullable(),
  amount_percent: z.number().min(0).max(100).optional().nullable(),
  notified_at: z.string().datetime().optional().nullable(),
  sent_at: z.string().datetime().optional().nullable(),
  paid_at: z.string().datetime().optional().nullable(),
  quickbooks_ref: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const row = await prisma.scheduledInvoice.findUnique({ where: { id } });
    if (!row) {
      throw new ApiError('Scheduled invoice not found', 404);
    }

    return NextResponse.json(formatScheduledInvoiceResponse(row));
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

    const existing = await prisma.scheduledInvoice.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Scheduled invoice not found', 404);
    }

    const body = await request.json();
    const data = updateScheduledInvoiceSchema.parse(body);

    const updateData: Record<string, any> = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.due_on !== undefined) updateData.due_on = data.due_on ? new Date(data.due_on) : null;
    if (data.amount_cached !== undefined) updateData.amount_cached = data.amount_cached;
    if (data.amount_percent !== undefined) updateData.amount_percent = data.amount_percent;
    if (data.notified_at !== undefined) {
      updateData.notified_at = data.notified_at ? new Date(data.notified_at) : null;
    }
    if (data.sent_at !== undefined) {
      updateData.sent_at = data.sent_at ? new Date(data.sent_at) : null;
    }
    if (data.paid_at !== undefined) {
      updateData.paid_at = data.paid_at ? new Date(data.paid_at) : null;
    }
    if (data.quickbooks_ref !== undefined) updateData.quickbooks_ref = data.quickbooks_ref;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const row = await prisma.scheduledInvoice.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(formatScheduledInvoiceResponse(row));
  } catch (error) {
    return handleApiError(error);
  }
}
