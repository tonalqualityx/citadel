import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { loadProjectList } from '@/lib/portal/projects-list';

// GET /api/portal/projects (portal phase B slice 2)
// The projects the signed-in contact may see: { active[], complete[] }. Active first. Same scope
// rule as the project page, so hidden, restricted and pre-kickoff projects never appear.
export async function GET(request: NextRequest) {
  try {
    const limited = rateLimit(request, 120);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    return NextResponse.json(await loadProjectList(access));
  } catch (error) {
    return handleApiError(error);
  }
}
