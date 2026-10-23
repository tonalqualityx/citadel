import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { renewClaim } from '@/lib/tasks/claims';

const bodySchema = z.object({ token: z.string().min(1).max(100), ttl_seconds: z.number().int().optional().nullable() });

// POST /api/tasks/:id/claim/renew - extend a live lease. 409 claim_lost when the token is wrong or the lease lapsed.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const claim = await renewClaim({ taskId: id, token: body.token, ttlSeconds: body.ttl_seconds });
    if (!claim) throw new ApiError('The claim is not live or the token does not match.', 409, 'claim_lost');
    return NextResponse.json(claim);
  } catch (error) {
    return handleApiError(error);
  }
}
