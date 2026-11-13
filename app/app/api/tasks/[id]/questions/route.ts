import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { guardDoxTaskWrite } from '@/lib/dox/guard';
import { guardDeskQuestionAsk, isTriageDeskLane } from '@/lib/triage-desk/guard';
import { recordSessionChange } from '@/lib/triage-desk/changes';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { addQuestion, listQuestions, CAUSE_KEY_MAX, CAUSE_SCOPES } from '@/lib/tasks/questions';
import { questionContextSchema } from '@/lib/tasks/question-context';

/**
 * GET /api/tasks/:id/questions
 * The card's questions with a ready-made `citation` on each one Mike answered (his exact words and the date). A question the card was
 * released on without an answer is `defaulted` with released_without_answer true and no citation: never his words.
 * While the card is in triage only Mike, the chat lane, bot keys and a question's asker can read this; everyone else gets 404.
 *
 * POST /api/tasks/:id/questions
 * Adds one question. The server refuses it unless it carries every Context part (see lib/tasks/question-context.ts). At most 10 open per card.
 * Optional `cause_key` (3 to 120 characters) and `cause_scope` (`card` default, or `project`): when a question with that key already exists on the card (or anywhere in the
 * card's project for scope `project`) and was not withdrawn, open OR answered OR defaulted, the answer is that question with 200 and `deduped: true` (its answer, if any, is on it, so the
 * asker reads the answer instead of asking again), and nothing is created. A withdrawn question can be asked again. A changed cause is a different cause_key by definition: a new key is a new question.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const task = await checkTaskAccess(id, auth);
    return NextResponse.json(await listQuestions(task, auth));
  } catch (error) {
    return handleApiError(error);
  }
}

const withConversation = z.object({ chat_conversation_id: z.string().uuid().optional() });
const withCause = z.object({
  cause_key: z.string().trim().min(3).max(CAUSE_KEY_MAX).optional(),
  cause_scope: z.enum(CAUSE_SCOPES).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const task = await checkTaskAccess(id, auth);
    await guardDoxTaskWrite(auth, request.headers, { status: task.status, project_id: task.project_id ?? null });
    guardDeskQuestionAsk(auth, { status: task.status });
    const raw = (await request.json()) as Record<string, unknown>;
    const { chat_conversation_id, cause_key, cause_scope, ...rest } = raw ?? {};
    const conv = withConversation.parse({ chat_conversation_id }).chat_conversation_id ?? null;
    const cause = withCause.parse({ cause_key, cause_scope });
    const body = questionContextSchema.parse(rest);
    const out = await addQuestion(task, auth, body, conv, cause.cause_key ? { key: cause.cause_key, scope: cause.cause_scope } : null);
    if (isTriageDeskLane(auth) && !out.deduped) await recordSessionChange(auth.userId, id, `asked a question: ${out.question}`);
    // A repeat of a cause that is still open answers 200 with the question that already exists; a new question is 201.
    return NextResponse.json(out, { status: out.deduped ? 200 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
