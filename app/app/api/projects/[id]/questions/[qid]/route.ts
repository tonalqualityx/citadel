import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { guardDoxProjectQuestion } from '@/lib/dox/guard';
import { questionPatchSchema } from '@/lib/tasks/question-context';
import { assertProjectQuestionStaff, loadQuestionProject, patchProjectQuestion } from '@/lib/projects/project-questions';

/**
 * PATCH /api/projects/:id/questions/:qid  { ...context parts } or { withdraw: true, reason? }
 * Changes the Context of an open project question (the merged question must still pass every Context check), or withdraws it. Mike, the chat
 * lane, bot keys and the asker only. Dox: on a live project; he withdraws any, and changes the wording of his own only.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const auth = await requireAuth();
    assertProjectQuestionStaff(auth);
    const { id, qid } = await params;
    const project = await loadQuestionProject(id);
    await guardDoxProjectQuestion(auth, project.id);
    const body = questionPatchSchema.parse(await request.json());
    return NextResponse.json(await patchProjectQuestion(project, qid, auth, body));
  } catch (error) {
    return handleApiError(error);
  }
}
