import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { patchQuestion } from '@/lib/tasks/questions';
import { questionPatchSchema } from '@/lib/tasks/question-context';

/**
 * PATCH /api/tasks/:id/questions/:qid  { ...context parts } or { withdraw: true, reason? }
 * Changes the Context of an open question (the merged question must still pass every Context check), or withdraws it.
 * Mike, the chat lane, bot keys and the asker only. An answered question is not edited: answer it again instead.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const auth = await requireAuth();
    const { id, qid } = await params;
    const task = await checkTaskAccess(id, auth);
    const body = questionPatchSchema.parse(await request.json());
    return NextResponse.json(await patchQuestion(task, qid, auth, body));
  } catch (error) {
    return handleApiError(error);
  }
}
