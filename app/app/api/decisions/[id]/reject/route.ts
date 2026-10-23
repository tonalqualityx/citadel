import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { DECISION_INCLUDE, formatDecision, requireDecisionAdmin } from '@/lib/decisions';

// Admin only. Moves a decision to rejected. A bot key gets 403.
const FROM = ['proposed','recorded_from_source'];

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    await requireDecisionAdmin(user);
    const { id } = await params;
    const d = await prisma.decision.findUnique({ where: { id } });
    if (!d) throw new ApiError('Decision not found', 404);
    if (!FROM.includes(d.status)) throw new ApiError(`Decision is ${d.status}`, 409);

    const updated = await prisma.decision.update({
      where: { id },
      data: {
        status: 'rejected',
      },
      include: DECISION_INCLUDE,
    });
    return NextResponse.json(formatDecision(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
