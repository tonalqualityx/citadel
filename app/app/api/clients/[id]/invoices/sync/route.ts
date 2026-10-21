import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

// POST /api/clients/[id]/invoices/sync (pm/admin, cookie or Bearer API key)
// Called by ~/.claude/tools/qbo-bridge/sync_invoices.py. The body is the FULL set of QuickBooks
// invoices the script read for this client (open + paid in the last 12 months). Rows are upserted
// by qbo_invoice_id. An invoice this client still holds as open/overdue but that is absent from the
// payload was deleted or voided in QuickBooks, so it is marked void (never left looking owed).
// QuickBooks is billing truth; Citadel only mirrors it.
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().min(0).max(100_000_000);

const invoiceSchema = z.object({
  qbo_invoice_id: z.string().min(1).max(64),
  doc_number: z.string().max(64).nullable().optional(),
  txn_date: dateStr,
  due_date: dateStr.nullable().optional(),
  total: money,
  balance: money,
  status: z.enum(['open', 'paid', 'overdue', 'void']),
  pay_link: z.string().url().max(2000).nullable().optional(),
});

const bodySchema = z.object({ invoices: z.array(invoiceSchema).max(2000) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, is_deleted: false },
      select: { id: true, qbo_customer_id: true },
    });
    if (!client) throw new ApiError('Client not found', 404);
    if (!client.qbo_customer_id) throw new ApiError('Client has no qbo_customer_id', 409);

    const { invoices } = bodySchema.parse(await request.json());
    const now = new Date();

    for (const inv of invoices) {
      const data = {
        client_id: id,
        doc_number: inv.doc_number ?? null,
        txn_date: new Date(inv.txn_date),
        due_date: inv.due_date ? new Date(inv.due_date) : null,
        total: inv.total,
        balance: inv.balance,
        status: inv.status,
        pay_link: inv.pay_link ?? null,
        synced_at: now,
      };
      await prisma.clientInvoice.upsert({
        where: { qbo_invoice_id: inv.qbo_invoice_id },
        create: { qbo_invoice_id: inv.qbo_invoice_id, ...data },
        update: data,
      });
    }

    const present = invoices.map((i) => i.qbo_invoice_id);
    const voided = await prisma.clientInvoice.updateMany({
      where: { client_id: id, status: { in: ['open', 'overdue'] }, qbo_invoice_id: { notIn: present } },
      data: { status: 'void', synced_at: now },
    });

    return NextResponse.json({ synced: invoices.length, voided: voided.count });
  } catch (error) {
    return handleApiError(error);
  }
}
