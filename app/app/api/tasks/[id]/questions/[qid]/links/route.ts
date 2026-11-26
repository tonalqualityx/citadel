import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { mintAnswerLinks, mintLinksSchema } from '@/lib/tasks/answer-links';

/**
 * POST /api/tasks/:id/questions/:qid/links  { report_url, expires_in_days? }
 * Signed one-time links for a report page: one per option of the question, plus a "talk it through" link (lib/tasks/answer-links.ts).
 * Mike, the chat lane, the front session, or Bast's worker key. Only an open question for Mike (never one we sent a client).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const auth = await requireAuth();
    const { id, qid } = await params;
    const task = await checkTaskAccess(id, auth);
    const body = mintLinksSchema.parse(await request.json());
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    return NextResponse.json(await mintAnswerLinks({ id: task.id, status: task.status, tags: task.tags ?? [] }, qid, auth, body, base), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
