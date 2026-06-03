import { NextRequest, NextResponse } from 'next/server';
import { instantiateDueRuns } from '@/lib/services/troubador-scheduler';

/**
 * POST /api/cron/troubador-scheduler
 *
 * Instantiates due Troubador content runs from active schedules.
 * Should be called on a recurring cron (e.g. daily).
 *
 * Requires CRON_SECRET header for authorization.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const cronSecret = request.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await instantiateDueRuns(new Date());

    return NextResponse.json({
      success: true,
      runs_created: result.runs_created,
      skipped: result.skipped,
      details: result.details,
    });
  } catch (error) {
    console.error('Error in troubador-scheduler cron:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
