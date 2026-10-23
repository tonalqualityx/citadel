import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { MAX_SEND_ATTEMPTS, releaseClaimForRow } from '@/lib/sends/release';

const failedSchema = z.object({
  last_error: z.string().min(1).max(4000),
});

// POST: the drain records a failed send attempt: attempts + 1, claim released so a later pass retries.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.emailOutbox.findUnique({ where: { id }, select: { id: true, sent_at: true } });
    if (!existing) throw new ApiError('Outbox row not found', 404);
    if (existing.sent_at) throw new ApiError('Already sent', 409);

    const data = failedSchema.parse(await request.json());
    const updated = await prisma.emailOutbox.update({
      where: { id },
      data: { last_error: data.last_error, attempts: { increment: 1 }, claimed_at: null },
    });
    // Out of attempts: nobody was told, so a claim this row held goes back.
    if (updated.attempts >= MAX_SEND_ATTEMPTS) await releaseClaimForRow(updated);
    return NextResponse.json({ id, attempts: updated.attempts, last_error: updated.last_error });
  } catch (error) {
    return handleApiError(error);
  }
}
