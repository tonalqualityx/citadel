import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

// PUT /api/portal-notices/:id/sent (portal phase B slice 2)
// Recorded by the sender right after the email was delivered. Mirrors PUT
// /api/approval-requests/:id/sent: the notice must be 'sending'; an already 'sent' notice is an
// idempotent re-confirmation (the sender retries RECORDING, never resending); message and thread
// ids are optional only with delivered_unconfirmed.
const sentSchema = z
  .object({
    message_id: z.string().min(1).max(255).nullable().optional(),
    thread_id: z.string().min(1).max(255).nullable().optional(),
    sent_at: z.string().datetime(),
    delivered_unconfirmed: z.boolean().optional(),
  })
  .refine((d) => d.delivered_unconfirmed === true || (!!d.message_id && !!d.thread_id), {
    message: 'message_id and thread_id are required unless delivered_unconfirmed is true',
  });

const UNRESOLVED_ID_MARKER = 'message id unresolved';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.portalNotice.findUnique({ where: { id } });
    if (!existing) throw new ApiError('Notice not found', 404);
    if (existing.status !== 'sending') {
      if (existing.status === 'sent') {
        return NextResponse.json({
          id: existing.id,
          status: existing.status,
          message_id: existing.message_id,
          thread_id: existing.thread_id,
          sent_at: existing.sent_at,
        });
      }
      throw new ApiError(`Notice is '${existing.status}', not 'sending'. Nothing to mark sent.`, 409);
    }

    const data = sentSchema.parse(await request.json());
    const updated = await prisma.portalNotice.update({
      where: { id },
      data: {
        status: 'sent',
        message_id: data.message_id ?? null,
        thread_id: data.thread_id ?? null,
        sent_at: new Date(data.sent_at),
        send_error: data.delivered_unconfirmed ? UNRESOLVED_ID_MARKER : null,
        send_error_count: 0,
      },
    });
    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      message_id: updated.message_id,
      thread_id: updated.thread_id,
      sent_at: updated.sent_at,
      send_error: updated.send_error,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
