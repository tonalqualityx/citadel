import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { getRunwayReport } from '@/lib/services/troubador-runway';

// Content runway per site: how long the shelf of approved-but-unpublished articles lasts at
// the site's publish cadence, and the drafted meeting request for the sites about to run out.
// Read-only. Nothing here sends anything to a client.
export async function GET() {
  try {
    await requireAuth();
    const report = await getRunwayReport();
    return NextResponse.json({
      generated_at: report.generated_at,
      sites: report.sites,
      alarms: report.alarms,
      low_runway_count: report.alarms.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
