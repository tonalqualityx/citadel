import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { portalReadRateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { searchSitePages } from '@/lib/portal/chat/site-pages-read';

// GET /api/portal/sites/:id/pages?q= (portal phase C)
// The pages of one of the signed-in client's sites, for "Another page" in the chat. A site that is
// not theirs is a 404, the same answer as a missing one. Project-only contacts have no client-level
// role and get a 404 too.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = portalReadRateLimit(request);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success || access.role === 'none' || access.revoked) throw new ApiError('Site not found', 404);
    const q = new URL(request.url).searchParams.get('q');
    const pages = await searchSitePages(access.clientId, { siteId: id.data, q });
    if (!pages) throw new ApiError('Site not found', 404);
    return NextResponse.json({ pages });
  } catch (error) {
    return handleApiError(error);
  }
}
