import { NextRequest, NextResponse } from 'next/server';
import { runCitadelNumbers } from '@/lib/initiatives/citadel-numbers';

/**
 * POST /api/cron/initiative-numbers
 *
 * The nightly read of initiative numbers Citadel computes itself: one reading (source `citadel`) for every number whose source is
 * `citadel:<key>` (projects_signed, proposals_sent, charters_active, retainer_hours_sold) on a non-deleted initiative. Once per number per UTC day, so
 * running it twice tells nothing twice. A number with no baseline takes its first read as the baseline. An unknown key is skipped and listed in the
 * response, not an error. The same run refreshes stored health on every non-deleted initiative. Rules and code: lib/initiatives/citadel-numbers.ts.
 *
 * Triggered by an external scheduler, like the other /api/cron routes. The script app/scripts/cron/initiative-numbers.sh is the one line to run from
 * system cron, nightly:
 *   15 1 * * *  CITADEL_URL=https://<citadel host> CRON_SECRET=<the app's CRON_SECRET> /path/to/app/scripts/cron/initiative-numbers.sh
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
    const out = await runCitadelNumbers();
    return NextResponse.json({ success: true, ...out });
  } catch (error) {
    console.error('Error in initiative-numbers cron:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
