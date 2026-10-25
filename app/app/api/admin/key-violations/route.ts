import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const querySchema = z.object({
  key_prefix: z.string().min(1).max(20).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

/**
 * GET /api/admin/key-violations?key_prefix=&since=&limit=  (admin only)
 * Calls a lane-scoped key made outside its lane (fleet item 6), newest first. Shadow rows have
 * enforced=false (the call went through); enforce rows have enforced=true (it got 403).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const sp = request.nextUrl.searchParams;
    const q = querySchema.parse({
      key_prefix: sp.get('key_prefix') ?? undefined,
      since: sp.get('since') ?? undefined,
      limit: sp.get('limit') ?? undefined,
    });

    const violations = await prisma.apiKeyViolation.findMany({
      where: {
        ...(q.key_prefix ? { key_prefix: q.key_prefix } : {}),
        ...(q.since ? { at: { gte: new Date(q.since) } } : {}),
      },
      orderBy: { at: 'desc' },
      take: q.limit,
    });

    return NextResponse.json({ violations, count: violations.length });
  } catch (error) {
    return handleApiError(error);
  }
}
