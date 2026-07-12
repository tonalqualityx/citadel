import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireClientAuth, assertClientScope, type ClientSession } from '@/lib/services/client-auth';
import { createNotification } from '@/lib/services/notifications';

// A single saved answer, keyed by question_index (preferred — stable against the stored
// questions array) or, failing that, the exact question text.
const answerItemSchema = z
  .object({
    question_index: z.number().int().min(0).optional(),
    question: z.string().max(2000).optional(),
    answer: z.string().max(10_000),
  })
  .refine((v) => v.question_index !== undefined || v.question !== undefined, {
    message: 'Each answer must include question_index or question',
  });

const bodySchema = z.object({
  answers: z.array(answerItemSchema).min(1).max(100),
});

interface StoredAnswer {
  question_index: number | null;
  question: string | null;
  answer: string;
  answered_at: string;
  contact_id: string;
}

function keyFor(item: { question_index?: number | null; question?: string | null }): string {
  return item.question_index !== undefined && item.question_index !== null
    ? `idx:${item.question_index}`
    : `q:${item.question ?? ''}`;
}

/**
 * Merge newly-submitted answers into the existing stored array. A resubmit of the same
 * question (matched by question_index, else exact question text) overwrites in place;
 * every other entry — from this contact or any other — is preserved untouched. Existing
 * order is kept (Map insertion order); genuinely new keys append at the end.
 */
function mergeAnswers(
  existing: unknown,
  incoming: z.infer<typeof answerItemSchema>[],
  contactId: string
): StoredAnswer[] {
  const merged = new Map<string, StoredAnswer>();

  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (item && typeof item === 'object') {
        merged.set(keyFor(item as StoredAnswer), item as StoredAnswer);
      }
    }
  }

  const now = new Date().toISOString();
  for (const item of incoming) {
    merged.set(keyFor(item), {
      question_index: item.question_index ?? null,
      question: item.question ?? null,
      answer: item.answer,
      answered_at: now,
      contact_id: contactId,
    });
  }

  return Array.from(merged.values());
}

function ownAnswers(answers: StoredAnswer[], contactId: string): StoredAnswer[] {
  return answers.filter((a) => a.contact_id === contactId);
}

// POST /api/portal/interview/:runId/answers
// Client saves written prep answers ahead of the live interview call. Supplementary prep
// material only — never touches Interview.status or the run's stage; only the human/skill
// running `interview-complete` advances things. Notifies the run's assignee (fire-and-forget).
//   no session                        → 401 (requireClientAuth)
//   run missing/deleted               → 404 (existence not leaked)
//   another client's run              → 403 (assertClientScope)
//   not ready_for_interview           → 409
//   interview missing or complete     → 409
//   own, ready_for_interview, open    → 200 { run_id, answers: <caller's own saved answers> }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session: ClientSession = await requireClientAuth();
    const { runId } = await params;

    const run = await prisma.troubadorRun.findFirst({
      where: { id: runId, is_deleted: false },
      select: {
        id: true,
        title: true,
        stage: true,
        client_id: true,
        assignee_id: true,
        client: { select: { name: true } },
        interview: { select: { id: true, status: true, answers: true } },
      },
    });
    if (!run) throw new ApiError('Run not found', 404);

    assertClientScope(session, run.client_id);

    if (run.stage !== 'ready_for_interview') {
      throw new ApiError('This run is not currently open for interview prep', 409);
    }
    if (!run.interview || run.interview.status === 'complete') {
      throw new ApiError('This interview is not currently open for answers', 409);
    }

    const data = bodySchema.parse(await request.json());
    const merged = mergeAnswers(run.interview.answers, data.answers, session.contactId);

    await prisma.interview.update({
      where: { id: run.interview.id },
      data: { answers: merged as unknown as object },
    });

    if (run.assignee_id) {
      createNotification({
        userId: run.assignee_id,
        type: 'interview_answers_submitted',
        title: `Interview answers from ${run.client?.name ?? 'client'}: ${run.title}`,
        entityType: 'troubador_run',
        entityId: run.id,
        priority: 'high',
      }).catch(() => {});
    }

    return NextResponse.json({
      run_id: run.id,
      answers: ownAnswers(merged, session.contactId),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
