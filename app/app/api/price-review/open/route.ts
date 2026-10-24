import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { openPriceReviews } from '@/lib/price-review/open';

/**
 * POST /api/price-review/open: opens the charter.price_review wait for every active charter whose
 * review date is inside its 14 day window (lib/price-review/open.ts). Staff (pm or admin session,
 * or an API key belonging to one). Idempotent: a second call opens nothing. `?dry_run=1` returns
 * what it would open and writes nothing. The wait sweep calls the same opener each pass, so this
 * route is for a hand run and for checking.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
    return NextResponse.json(await openPriceReviews(prisma, { dryRun }));
  } catch (error) {
    return handleApiError(error);
  }
}
