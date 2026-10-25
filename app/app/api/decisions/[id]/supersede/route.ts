import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatDecision, requireDecisionAdmin, supersede, assertUuid } from '@/lib/decisions';

// Admin only. {by_id} is the newer decision that replaces this one. One transaction.
const bodySchema = z.object({ by_id: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    await requireDecisionAdmin(user);
    const { id } = await params;
    assertUuid(id);
    const { by_id } = bodySchema.parse(await request.json());
    const updated = await supersede(id, by_id);
    return NextResponse.json(formatDecision(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
