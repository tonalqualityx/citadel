import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const querySchema = z.object({
  sort: z.enum(['keep', 'digest', 'stop']).optional(),
  user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/notifications/slack-notices: the Slack three-way sort log (keep, digest, stop), newest first.
 * PM or admin.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const sp = new URL(request.url).searchParams;
    const query = querySchema.parse({
      sort: sp.get('sort') ?? undefined,
      user_id: sp.get('user_id') ?? undefined,
      limit: sp.get('limit') ?? undefined,
    });
    const notices = await prisma.slackNotice.findMany({
      where: {
        ...(query.sort ? { sort: query.sort } : {}),
        ...(query.user_id ? { user_id: query.user_id } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: query.limit,
    });
    return NextResponse.json({ notices });
  } catch (error) {
    return handleApiError(error);
  }
}
