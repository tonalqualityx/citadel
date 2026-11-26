import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { monthString } from '@/lib/retainer-months/helpers';
import { listMonths, monthKeySchema } from '@/lib/retainer-months/service';

// GET /api/retainer-months?month=YYYY-MM - every eligible charter's month for that month (default: this month), with used against allotment
export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const raw = new URL(request.url).searchParams.get('month');
    const month = raw ? monthKeySchema.parse(raw) : monthString(new Date());
    return NextResponse.json(await listMonths(month));
  } catch (error) {
    return handleApiError(error);
  }
}
