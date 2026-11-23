import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { guardDoxProjectQuestion } from '@/lib/dox/guard';
import { questionAnswerSchema } from '@/lib/tasks/question-context';
import { answerProjectQuestion, assertProjectQuestionStaff, loadQuestionProject } from '@/lib/projects/project-questions';

/**
 * POST /api/projects/:id/questions/:qid/answer  { version, option_id?, text?, source? }
 * Mike's answer to a project question: his own signed-in session, or the bast-chat lane relaying his words. Dox records an answer someone else
 * gave, with `source: { who, said, at, url? }`, on a live project; it is never Mike's word. Answering again replaces the answer. No comment is
 * written (there is no card). When Dox asked the question and someone else answered, the project's refresh request is stamped, so his next
 * pass on the project reads the answer from the snapshot (`project_questions`); `handed_to_dox` says so.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const auth = await requireAuth();
    assertProjectQuestionStaff(auth);
    const { id, qid } = await params;
    const project = await loadQuestionProject(id);
    await guardDoxProjectQuestion(auth, project.id);
    const body = questionAnswerSchema.parse(await request.json());
    return NextResponse.json(await answerProjectQuestion(project, qid, auth, body));
  } catch (error) {
    return handleApiError(error);
  }
}
