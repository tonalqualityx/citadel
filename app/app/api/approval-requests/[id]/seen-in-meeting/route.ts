import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

// Oracle Projects Tab Phase 5 — POST for the meeting-sync skill (the skill change
// itself is a one-line addition, out of this repo — see the plan's Phase 5 notes).
// Bearer, any authenticated user. Stamps seen_in_meeting_at always; when the row is
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
    await requireAuth();
    const { id } = await params;

    const existing = await prisma.approvalRequest.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new ApiError('Approval request not found', 404);
    }

    const body = await request.json();
    const data = seenInMeetingSchema.parse(body);
    const at = new Date(data.at);

    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        seen_in_meeting_at: at,
        ...(existing.status === 'sent'
          ? { status: 'replied', replied_at: at, reply_excerpt: data.excerpt }
          : {}),
      },
    });

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
