import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import {
  getAllRetainerStatuses,
  getCurrentMonthPeriod,
  getMonthPeriod,
} from '@/lib/calculations/retainer';

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    // Parse date filters or use current month
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    let period: { start: Date; end: Date };
    if (year && month) {
      period = getMonthPeriod(parseInt(year), parseInt(month) - 1); // month is 0-indexed
    } else {
      period = getCurrentMonthPeriod();
    }

    const retainers = await getAllRetainerStatuses(period.start, period.end);

    // Sort by status severity (exceeded > critical > warning > healthy)
    const statusOrder = { exceeded: 0, critical: 1, warning: 2, healthy: 3 };
    retainers.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    return NextResponse.json({
      retainers,
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
      summary: {
        total: retainers.length,
        exceeded: retainers.filter((r) => r.status === 'exceeded').length,
        critical: retainers.filter((r) => r.status === 'critical').length,
        warning: retainers.filter((r) => r.status === 'warning').length,
        healthy: retainers.filter((r) => r.status === 'healthy').length,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
