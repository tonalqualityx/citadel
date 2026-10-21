import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { loadRetainers } from '@/lib/portal/retainer';

// GET /api/portal/retainer (portal phase B slice 2)
// One card per active or paused charter: plan name, period, what is in flight this period, the
// latest report, a staged plan to approve, and the plan's allowance. Never hours used. Any client
// role but none may read it; a grant-only contact gets an empty list.
export async function GET(request: NextRequest) {
  try {
    const limited = rateLimit(request, 120);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    return NextResponse.json({ retainers: await loadRetainers(access) });
  } catch (error) {
    return handleApiError(error);
  }
}
