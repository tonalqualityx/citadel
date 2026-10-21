import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { loadRitualBlocks } from '@/lib/waits/load-blocks';
import { blockingSummary } from '@/lib/waits/ritual-blocks';

/**
 * GET /api/waits/mine: the Work-mode blocks for the signed-in user, exactly as the Seeing Stone
 * renders them (Blocking today, Due this week, Admin), plus the one-line summary the ritual
 * reads aloud. Nothing here reads the focus flag. The ritual walks Blocking today with this.
 */
export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    // The Admin block reads the admin-soon list, which is admin-only everywhere else.
    const blocks = await loadRitualBlocks(prisma, auth.userId, new Date(), { includeAdmin: auth.role === 'admin' });
    return NextResponse.json({ ...blocks, summary: blockingSummary(blocks.blocking_today) });
  } catch (error) {
    return handleApiError(error);
  }
}
