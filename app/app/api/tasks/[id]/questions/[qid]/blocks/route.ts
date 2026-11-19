import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { addQuestionBlocks, removeQuestionBlocks } from '@/lib/tasks/questions';
import { questionBlocksSchema } from '@/lib/tasks/question-context';

/**
 * POST   /api/tasks/:id/questions/:qid/blocks  { task_ids }  The question also blocks these cards (same project, or its own card). An open question
 *        holds each active card in `blocked` at once, exactly as an unfinished blocker task does.
 * DELETE /api/tasks/:id/questions/:qid/blocks  { task_ids }  It no longer blocks them; each is released when nothing else holds it.
 * The asker, Mike, the chat lane, bot keys, or a pm or admin.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const auth = await requireAuth();
    const { id, qid } = await params;
    const task = await checkTaskAccess(id, auth);
    const body = questionBlocksSchema.parse(await request.json());
    return NextResponse.json(await addQuestionBlocks(task, qid, auth, body.task_ids));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const auth = await requireAuth();
    const { id, qid } = await params;
    const task = await checkTaskAccess(id, auth);
    const body = questionBlocksSchema.parse(await request.json());
    return NextResponse.json(await removeQuestionBlocks(task, qid, auth, body.task_ids));
  } catch (error) {
    return handleApiError(error);
  }
}
