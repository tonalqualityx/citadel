import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { guardDoxProjectQuestion } from '@/lib/dox/guard';
import { CAUSE_KEY_MAX } from '@/lib/tasks/questions';
import { questionContextSchema } from '@/lib/tasks/question-context';
import { addProjectQuestion, assertProjectQuestionStaff, listProjectQuestions, loadQuestionProject } from '@/lib/projects/project-questions';

/**
 * GET /api/projects/:id/questions
 * The project's own questions (asked on the project, with no card), every state, each in the shape a card question has. pm, admin, Mike, the
 * chat lane and bot keys; anyone else gets 404. GET /api/questions?project_id= lists these together with the questions on the project's cards.
 *
 * POST /api/projects/:id/questions
 * Asks one question on the project itself, for when its answer decides which cards get made (Mike, 2026-11-23). It carries every Context part a
 * card question does (lib/tasks/question-context.ts) and always waits for its answer (if_nobody_action must be `wait`). At most 10 open on a
 * project. Optional `cause_key` (3 to 120 characters): when a question with that key already exists on the project or any of its cards and was
 * not withdrawn, the answer is that question with 200 and `deduped: true`, and nothing is created. It blocks no cards and is never sent to a client.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    assertProjectQuestionStaff(auth);
    const { id } = await params;
    const project = await loadQuestionProject(id);
    return NextResponse.json(await listProjectQuestions(project, auth));
  } catch (error) {
    return handleApiError(error);
  }
}

const withCause = z.object({ cause_key: z.string().trim().min(3).max(CAUSE_KEY_MAX).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    assertProjectQuestionStaff(auth);
    const { id } = await params;
    const project = await loadQuestionProject(id);
    await guardDoxProjectQuestion(auth, project.id);
    const raw = (await request.json()) as Record<string, unknown>;
    const { cause_key, ...rest } = raw ?? {};
    const cause = withCause.parse({ cause_key });
    const body = questionContextSchema.parse(rest);
    const out = await addProjectQuestion(project, auth, body, cause.cause_key ?? null);
    return NextResponse.json(out, { status: out.deduped ? 200 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
