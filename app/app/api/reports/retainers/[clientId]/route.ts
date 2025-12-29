import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, notFound } from '@/lib/api/errors';
import {
  getRetainerStatus,
  getCurrentMonthPeriod,
  getMonthPeriod,
} from '@/lib/calculations/retainer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    await requireAuth();
    const { clientId } = await params;
    const { searchParams } = new URL(request.url);

    // Parse date filters or use current month
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    let period: { start: Date; end: Date };
    if (year && month) {
      period = getMonthPeriod(parseInt(year), parseInt(month) - 1);
    } else {
      period = getCurrentMonthPeriod();
    }

    const retainer = await getRetainerStatus(clientId, period.start, period.end);

    if (!retainer) {
      return notFound('Client not found or has no retainer');
    }

    return NextResponse.json({
      retainer,
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
