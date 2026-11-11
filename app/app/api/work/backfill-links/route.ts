import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, AuthError } from '@/lib/api/errors';
import { applyBackfill, backfillBodySchema, backfillLists, planBackfill } from '@/lib/work/backfill';

/**
 * Work stage A: the one-time tidy. Admin, or the Porter lane (work-links/backfill.py). The machine sends claims; Citadel
 * recomputes every decision (lib/work/backfill.ts), so the dry run and the real run decide identically. dry:true writes
 * nothing. The real run links the asks, closes those whose task finished before they arrived, sets RFC keys over null,
 * and writes one Handled line with Undo for 72 hours. Nothing is sent, drafted or changed in any mailbox.
 */
const TX_TIMEOUT_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const porter = auth.role !== 'admin' && auth.lane === 'porter';
    if (auth.role !== 'admin' && !porter) throw new AuthError('Insufficient permissions', 403);

    const body = backfillBodySchema.parse(await request.json());
    const now = new Date();

    if (body.dry) {
      const plan = await planBackfill(prisma, body, now);
      return NextResponse.json({ dry: true, counts: plan.counts, lists: backfillLists(plan) });
    }

    const { plan, applied } = await prisma.$transaction(
      async (tx) => {
        const plan = await planBackfill(tx, body, now);
        return { plan, applied: await applyBackfill(tx, plan, now) };
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return NextResponse.json({ dry: false, counts: plan.counts, lists: backfillLists(plan), applied });
  } catch (error) {
    return handleApiError(error);
  }
}
