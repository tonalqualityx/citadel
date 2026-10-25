import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { DECISION_INCLUDE, formatDecision, assertUuid } from '@/lib/decisions';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const d = await prisma.decision.findUnique({ where: { id }, include: DECISION_INCLUDE });
    if (!d) throw new ApiError('Decision not found', 404);
    const superseded_by = await prisma.decision.findFirst({
      where: { supersedes_id: id },
      select: { id: true, key: true, title: true },
    });
    return NextResponse.json({ ...formatDecision(d), superseded_by });
  } catch (error) {
    return handleApiError(error);
  }
}
