import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatScheduledInvoiceResponse } from '@/lib/api/formatters';

// project-record-citadel-changes.md section 1.3 / 2.3 (ruling 33, 2026-08-27) — the billing
// schedule. Minimal CRUD following the repo's route conventions: list (by accord/status),
// create, patch status. Writes are role-gated the same way sibling billing fields are
// (task billing_target/billing_amount, PM/Admin only) — see app/api/tasks/[id]/route.ts.
const createScheduledInvoiceSchema = z.object({
  accord_id: z.string().uuid(),
  client_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  charter_id: z.string().uuid().optional().nullable(),
  ware_id: z.string().uuid().optional().nullable(),
  accord_item_id: z.string().uuid().optional().nullable(),
  item_kind: z.string().max(50).optional().nullable(),
  trigger_type: z.string().min(1).max(50),
  trigger_ref: z.string().max(255).optional().nullable(),
  amount_source: z.string().min(1).max(50),
  amount_percent: z.number().min(0).max(100).optional().nullable(),
  amount_cached: z.number().min(0).optional().nullable(),
  currency: z.string().min(1).max(10).optional(),
  due_on: z.string().optional().nullable(), // 'YYYY-MM-DD'
  status: z.string().max(30).optional(),
  notes: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const accordId = searchParams.get('accord_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const clientId = searchParams.get('client_id') || undefined;

    const where: any = {
      ...(accordId && { accord_id: accordId }),
      ...(status && { status }),
      ...(clientId && { client_id: clientId }),
    };

    const rows = await prisma.scheduledInvoice.findMany({
      where,
      orderBy: [{ due_on: 'asc' }, { created_at: 'asc' }],
    });

    return NextResponse.json({ scheduled_invoices: rows.map(formatScheduledInvoiceResponse) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createScheduledInvoiceSchema.parse(body);

    const accord = await prisma.accord.findUnique({
      where: { id: data.accord_id, is_deleted: false },
    });
    if (!accord) {
      throw new ApiError('Accord not found', 404);
    }

    const row = await prisma.scheduledInvoice.create({
      data: {
        id: randomUUID(),
        accord_id: data.accord_id,
        client_id: data.client_id,
        project_id: data.project_id,
        charter_id: data.charter_id,
        ware_id: data.ware_id,
        accord_item_id: data.accord_item_id,
        item_kind: data.item_kind,
        trigger_type: data.trigger_type,
        trigger_ref: data.trigger_ref,
        amount_source: data.amount_source,
        amount_percent: data.amount_percent,
        amount_cached: data.amount_cached,
        currency: data.currency || 'USD',
        due_on: data.due_on ? new Date(data.due_on) : null,
        status: data.status || 'pending',
        notes: data.notes,
      },
    });

    return NextResponse.json(formatScheduledInvoiceResponse(row), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
