import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { patchQuestion } from '@/lib/tasks/questions';
import { questionPatchSchema } from '@/lib/tasks/question-context';
import { guardDeskQuestionPatch, isTriageDeskLane } from '@/lib/triage-desk/guard';
import { guardDoxQuestionPatch } from '@/lib/dox/guard';

/**
 * PATCH /api/tasks/:id/questions/:qid  { ...context parts } or { withdraw: true, reason? }
 * Changes the Context of an open question (the merged question must still pass every Context check), or withdraws it.
 * Mike, the chat lane, bot keys and the asker only. Dox: withdraw on a live project's task or a client's standalone task not held for Mike, edit only his own question, and on a Triage card only his own question. An answered question is not edited: answer it again instead.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const auth = await requireAuth();
    const { id, qid } = await params;
    const task = await checkTaskAccess(id, auth);
    const body = questionPatchSchema.parse(await request.json());
    await guardDeskQuestionPatch(auth, { id, status: task.status }, qid, body);
    await guardDoxQuestionPatch(auth, request.headers, { id, status: task.status, project_id: task.project_id ?? null, client_id: task.client_id ?? null, tags: task.tags ?? [] }, qid, body);
    const out = await patchQuestion(task, qid, auth, body);
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
