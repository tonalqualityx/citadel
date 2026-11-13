import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireTriageOwner } from '@/lib/tasks/triage-auth';
import { isTriageDeskLane } from '@/lib/triage-desk/guard';
import { readCardConversation } from '@/lib/triage-desk/conversation';

/**
 * GET /api/tasks/:id/conversation?after=<seq>&limit=<n>
 * The conversation Mike has had with the chat about this card, as turns in order: { seq, who: mike|bast, at, text }. Tool-call detail is left out; a turn the
 * daemon redacted comes back as { redacted: true, text: null }; credential-looking text is removed. The general home chat is not included (the payload's
 * `home_chat.note` says why). Mike's own session and the triage-desk lane only (403 for everyone else, a missing task is 404).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!isTriageDeskLane(auth)) requireTriageOwner(auth);
    const { id } = await params;
    const task = await prisma.task.findFirst({ where: { id, is_deleted: false }, select: { id: true } });
    if (!task) throw new ApiError('Task not found', 404);
    const sp = request.nextUrl.searchParams;
    const after = Number(sp.get('after') ?? '0');
    const limit = Number(sp.get('limit') ?? '0');
    return NextResponse.json(await readCardConversation(id, { after: Number.isFinite(after) ? after : 0, limit: Number.isFinite(limit) && limit > 0 ? limit : undefined }));
  } catch (error) {
    return handleApiError(error);
  }
}
