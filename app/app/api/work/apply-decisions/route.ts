import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, AuthError } from '@/lib/api/errors';
import { applyDecisions, applyDecisionsBodySchema } from '@/lib/work/intake';

/**
 * Work stage B: apply the replayed intake decisions to open legacy asks. Admin, or the Porter lane (the classifier's --decide-replay
 * --apply). Body (strict, at most 300 items): `{dry: boolean, items: [{ask_id, disposition, reason}]}`.
 * Citadel recomputes every decision (lib/work/decision.ts decideReplay), so the dry run and the real run decide identically; dry:true
 * writes nothing. The real run closes only open, undecided asks marked no_action (never an urgent, admin or sales ask, never one
 * linked to a security task, never one he reopened) with ONE Handled line and Undo for 72 hours, and stores reply_mike, meeting and
 * (urgent only) emergency without closing. Nothing is sent, drafted or changed in any mailbox. Owner only.
 * 200 `{dry, counts: {total, would_close, would_set, left, refused, by_disposition}, rows, closed, set, action_id, skipped?: "home_off"}`.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const porter = auth.role !== 'admin' && auth.lane === 'porter';
    if (auth.role !== 'admin' && !porter) throw new AuthError('Insufficient permissions', 403);
    const body = applyDecisionsBodySchema.parse(await request.json());
    return NextResponse.json(await applyDecisions(prisma, body.items, { dry: body.dry }));
  } catch (error) {
    return handleApiError(error);
  }
}
