import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { ledgerPushSchema, ledgerSummary, upsertLedgerDays } from '@/lib/model-ledger/service';

// GET /api/model-ledger/days?days=7|30 - totals per model and task type over the window
export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const raw = request.nextUrl.searchParams.get('days') ?? '7';
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new ApiError('days must be a whole number from 1 to 90', 400);
    return NextResponse.json(await ledgerSummary(days));
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/model-ledger/days - the Bast machine's daily rollup; upserts by (day, model, task_type), never deletes
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { rows } = ledgerPushSchema.parse(await request.json());
    return NextResponse.json(await upsertLedgerDays(rows));
  } catch (error) {
    return handleApiError(error);
  }
}
