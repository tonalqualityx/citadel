import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { addQuestion, listQuestions } from '@/lib/tasks/questions';
import { questionContextSchema } from '@/lib/tasks/question-context';

/**
 * GET /api/tasks/:id/questions
 * The card's questions with a ready-made `citation` on each one Mike answered (his exact words and the date). A question the card was
 * released on without an answer is `defaulted` with released_without_answer true and no citation: never his words.
 * While the card is in triage only Mike, the chat lane, bot keys and a question's asker can read this; everyone else gets 404.
 *
 * POST /api/tasks/:id/questions
 * Adds one question. The server refuses it unless it carries every Context part (see lib/tasks/question-context.ts). At most 10 open per card.
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const task = await checkTaskAccess(id, auth);
    const raw = (await request.json()) as Record<string, unknown>;
    const { chat_conversation_id, ...rest } = raw ?? {};
    const conv = withConversation.parse({ chat_conversation_id }).chat_conversation_id ?? null;
    const body = questionContextSchema.parse(rest);
    return NextResponse.json(await addQuestion(task, auth, body, conv), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
