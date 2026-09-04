import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';

// Oracle Projects Tab Phase 5 — PUT used ONLY by the machine-side sender
// (~/.claude/tools/citadel-approvals/approval-sender.py) right after `gog gmail send`
// succeeds. Bearer, any authenticated user — a machine endpoint, matching the next-step
// engine's write route convention. Requires the row to still be 'queued' (the sender
// re-checks status itself immediately before sending too — see the plan's Adaptations
// section — this is belt and suspenders, not the only guard).
const sentSchema = z.object({
  message_id: z.string().min(1).max(255),
  thread_id: z.string().min(1).max(255),
  sent_at: z.string().datetime(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const existing = await prisma.approvalRequest.findUnique({
      where: { id },
      select: { id: true, status: true, task_id: true },
    });
    if (!existing) {
      throw new ApiError('Approval request not found', 404);
    }
    if (existing.status !== 'queued') {
      throw new ApiError(`Approval request is '${existing.status}', not 'queued' — nothing to mark sent`, 409);
    }

    const body = await request.json();
    const data = sentSchema.parse(body);

    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'sent',
        message_id: data.message_id,
        thread_id: data.thread_id,
        sent_at: new Date(data.sent_at),
        send_error: null,
        send_error_count: 0,
      },
    });

    await logUpdate(auth.userId, 'task', existing.task_id, 'Approval request', {
      approval_status: { from: 'queued', to: 'sent' },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      message_id: updated.message_id,
      thread_id: updated.thread_id,
      sent_at: updated.sent_at,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
