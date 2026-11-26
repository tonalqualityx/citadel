import { NextRequest, NextResponse } from 'next/server';
import { runRetainerMonthCycle } from '@/lib/retainer-months/service';

/**
 * POST /api/cron/retainer-months
 *
 * The daily retainer month cycle (design.md 2.6): from the 25th, drafts next month for every active monthly charter (items and a planning
 * task for Mike); drafts the current month when a charter has none (a planning task only when drafted on the 1st); a current month still in
 * planning after the 1st becomes planned on the draft; months before the current one are closed with their numbers frozen. Safe to run twice a
 * day: every step is keyed on (charter, month). Rules and code: lib/retainer-months/.
 *
 * Triggered by an external scheduler, like the other /api/cron routes. The script app/scripts/cron/retainer-months.sh is the one line to run from
 * system cron, daily:
 *   20 1 * * *  CITADEL_URL=https://<citadel host> CRON_SECRET=<the app's CRON_SECRET> /path/to/app/scripts/cron/retainer-months.sh
 *
 * Requires the x-cron-secret header to match the CRON_SECRET environment variable.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');
  if (!cronSecret || !provided || provided !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const out = await runRetainerMonthCycle(new Date());
    return NextResponse.json({ success: true, ...out });
  } catch (error) {
    console.error('Error in retainer-months cron:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
