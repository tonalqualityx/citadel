import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';

// GET /api/portal/interview
// The logged-in client's pending interview prep: runs in `ready_for_interview` (client-scoped,
// non-deleted) whose interview has questions and isn't complete yet. Client-safe projection —
// only run_id/run_title/questions/interview_status, plus the CALLER'S OWN previously-saved
// answers (a shared 7-day portal link may be used by more than one contact on the same client,
// so an answer is only ever shown back to the contact who wrote it — see client-auth.ts).
//   no session → 401 (requireClientAuth)
//   own client → 200 { interviews: [...] } (empty array when nothing is pending)
export async function GET(_request: NextRequest) {
  try {
    const session = await requireClientAuth();

    const runs = await prisma.troubadorRun.findMany({
      where: {
        client_id: session.clientId,
        is_deleted: false,
        stage: 'ready_for_interview',
      },
      select: {
        id: true,
        title: true,
        interview: {
          select: { status: true, questions: true, answers: true },
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    const interviews = runs
      .filter((r) => r.interview && r.interview.status !== 'complete' && r.interview.questions != null)
      .map((r) => ({
        run_id: r.id,
        run_title: r.title,
        questions: r.interview!.questions,
        answers: ownAnswers(r.interview!.answers, session.contactId),
        interview_status: r.interview!.status,
      }));

    return NextResponse.json({ interviews });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Filter a stored answers array down to entries the calling contact themselves wrote. */
function ownAnswers(answers: unknown, contactId: string): unknown[] {
  if (!Array.isArray(answers)) return [];
  return answers.filter(
    (a) => a && typeof a === 'object' && (a as { contact_id?: unknown }).contact_id === contactId
  );
}
