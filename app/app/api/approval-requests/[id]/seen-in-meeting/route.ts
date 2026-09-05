import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';

// Oracle Projects Tab Phase 5 — POST for the meeting-sync skill (the skill change
// itself is a one-line addition, out of this repo — see the plan's Phase 5 notes).
// pm/admin only (H2 security fix) — a tech-role key must not be able to fabricate a
// client reply via a fake meeting mention. Stamps seen_in_meeting_at always; when the row is
// still 'sent' (no email reply on file yet), a verbal approval mentioned in a meeting
// counts as the client's reply — flips status to 'replied' and stamps replied_at/
// reply_excerpt from the meeting transcript excerpt. Never downgrades a row already
// past 'sent' (replied/approved/changes_requested/cancelled) — only seen_in_meeting_at
// updates there, so a later meeting mention can't undo a real decision already on file.
// meeting_id is accepted (and validated as a real uuid shape) but not persisted —
// ApprovalRequest carries no Meeting relation in this phase; wiring the two together is
// part of the meeting-sync skill's own follow-up, not this route.
const seenInMeetingSchema = z.object({
  meeting_id: z.string().uuid().optional().nullable(),
  excerpt: z.string().trim().min(1).max(2000),
  at: z.string().datetime(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.approvalRequest.findUnique({
      where: { id },
      select: { id: true, status: true, task_id: true },
    });
    if (!existing) {
      throw new ApiError('Approval request not found', 404);
    }

    const body = await request.json();
    const data = seenInMeetingSchema.parse(body);
    const at = new Date(data.at);
    const willTransition = existing.status === 'sent';

    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        seen_in_meeting_at: at,
        ...(willTransition
          ? { status: 'replied', replied_at: at, reply_excerpt: data.excerpt }
          : {}),
      },
    });

    // MEDIUM-4: log the actual state-machine transition (sent -> replied), same
    // convention every other transition on this row already carries. Every OTHER call
    // here only stamps seen_in_meeting_at — not a transition, nothing to log.
    if (willTransition) {
      await logUpdate(auth.userId, 'task', existing.task_id, 'Approval request', {
        approval_status: { from: 'sent', to: 'replied' },
      });
    }

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      seen_in_meeting_at: updated.seen_in_meeting_at,
      replied_at: updated.replied_at,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
