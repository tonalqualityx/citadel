import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { listAllQuestions, QUESTION_FOR, QUESTION_STATES } from '@/lib/tasks/questions';

const querySchema = z.object({
  state: z.enum(QUESTION_STATES).default('open'),
  for: z.enum(QUESTION_FOR).default('all'),
  project_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * GET /api/questions?state=open&for=client|mike|all&project_id=&limit=
 * Card questions across cards, oldest first, each with its card (and project), who it was for, the email that carried it and the cards it blocks.
 * Never a question on a Triage card. pm and admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const sp = new URL(request.url).searchParams;
    const q = querySchema.parse(Object.fromEntries(Array.from(sp.entries()).filter(([k]) => ['state', 'for', 'project_id', 'limit'].includes(k))));
    return NextResponse.json(await listAllQuestions(auth, q));
  } catch (error) {
    return handleApiError(error);
  }
}
