import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';

// Oracle Projects Tab Phase 5 — POST for the inbound-email classifier
// (~/.claude/tools/oracle/clarity/email-classifier.py). Bearer, any authenticated user.
// The classifier matches an inbound message's thread_id against a 'sent' ApprovalRequest
// (see GET /api/approval-requests?thread_id=... — the classifier's own lookup) and posts
// here with the first ~300 chars of the plain body. Flips 'sent' -> 'replied' and stamps
// replied_at/reply_excerpt. A reply landing while the row is already 'replied' just
// refreshes replied_at/reply_excerpt with the newest evidence (no status change needed).
// A reply landing on a row already past that (approved/changes_requested/cancelled/
// draft/queued) is recorded on reply_excerpt/replied_at too, but never changes status —
// this endpoint only ever ADVANCES the state machine, never reopens a terminal one.
const replySchema = z.object({
  message_id: z.string().min(1).max(255),
  received_at: z.string().datetime(),
  excerpt: z.string().trim().min(1).max(2000),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const body = await request.json();
    const data = replySchema.parse(body);
    const receivedAt = new Date(data.received_at);
    // The excerpt handed to us is already the classifier's own ~300-char slice of the
    // plain body; still capped here defensively against a future caller sending more.
    const excerpt = data.excerpt.slice(0, 300);
    const willTransition = existing.status === 'sent';

    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        replied_at: receivedAt,
        reply_excerpt: excerpt,
        ...(willTransition ? { status: 'replied' } : {}),
      },
    });

    // MEDIUM-4: log the actual state-machine transition (sent -> replied), same
    // logUpdate convention every other transition on this row already carries (PATCH
    // .../[id], PUT .../sent, PUT .../send-error). A reply landing on a row that was
    // already past 'sent' still records replied_at/reply_excerpt above, but that isn't
    // a transition — nothing to log.
    if (willTransition) {
      await logUpdate(auth.userId, 'task', existing.task_id, 'Approval request', {
        approval_status: { from: 'sent', to: 'replied' },
      });
    }

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      replied_at: updated.replied_at,
      reply_excerpt: updated.reply_excerpt,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
