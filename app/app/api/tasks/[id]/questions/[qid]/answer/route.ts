import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { answerQuestion } from '@/lib/tasks/questions';
import { questionAnswerSchema } from '@/lib/tasks/question-context';
import { guardDoxAnswer } from '@/lib/dox/guard';

/**
 * POST /api/tasks/:id/questions/:qid/answer  { option_id?, text? }
 * Mike's answer: his own signed-in session, or the bast-chat lane relaying his words (the comment then starts "From Mike, through the chat: ").
 * Dox records an answer someone else gave, with `source: { who, said, at, url? }` (lib/dox/guard.ts guardDoxAnswer: never on a Triage card, only on a
 * live project's task or a standalone task); it is never cited as Mike's word and never lifts a needs-mike hold.
 * One transaction: answer fields, an internal comment marked with the question id (it wakes a parked worker task), the `held-for-questions`
 * tag and `needs-mike` removed when this was the last open question, and a human asker told. Answering again replaces the answer; every
 * answer stays in the comments.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  try {
    const auth = await requireAuth();
    const { id, qid } = await params;
    const task = await checkTaskAccess(id, auth);
    await guardDoxAnswer(auth, request.headers, { id: task.id, status: task.status, project_id: task.project_id ?? null, client_id: task.client_id ?? null, tags: task.tags ?? [] });
    const body = questionAnswerSchema.parse(await request.json());
    return NextResponse.json(await answerQuestion(task, qid, auth, body));
  } catch (error) {
    return handleApiError(error);
  }
}
