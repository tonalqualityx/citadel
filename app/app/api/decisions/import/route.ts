import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { importDecisions, importSchema, requireDecisionAdmin } from '@/lib/decisions';

// Admin only. Idempotent by key; the only path that may write status=confirmed in bulk.
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    await requireDecisionAdmin(user);
    const { decisions } = importSchema.parse(await request.json());
    return NextResponse.json(await importDecisions(decisions, user.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
