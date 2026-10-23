import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { claimTask, getClaim } from '@/lib/tasks/claims';

const bodySchema = z.object({
  holder: z.string().trim().min(1).max(200),
  ttl_seconds: z.number().int().optional().nullable(),
  set_in_progress: z.boolean().optional(),
});

// POST /api/tasks/:id/claim - take the task (fleet item 3). One compare-and-set UPDATE: exactly one caller
// wins. 200 with the claim token (keep it: renew, release and X-Claim-Token need it), 409 claim_taken with
// the holder and lease_until when someone else owns it, 409 closed when the task is done or abandoned.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const r = await claimTask({ taskId: id, holder: body.holder, ttlSeconds: body.ttl_seconds, setInProgress: body.set_in_progress === true });
    if (r.ok) return NextResponse.json(r.claim);
    if (r.reason === 'not_found') throw new ApiError('Task not found', 404);
    if (r.reason === 'closed') throw new ApiError('This task is done or abandoned, so it cannot be claimed.', 409, 'closed');
    return NextResponse.json({ error: `Held by ${r.holder} until ${r.lease_until?.toISOString()}`, code: 'claim_taken', holder: r.holder, lease_until: r.lease_until }, { status: 409 });
  } catch (error) {
    return handleApiError(error);
  }
}

// GET /api/tasks/:id/claim - who holds the task and until when. Never returns the token.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const claim = await getClaim(id);
    if (!claim) throw new ApiError('Task not found', 404);
    return NextResponse.json(claim);
  } catch (error) {
    return handleApiError(error);
  }
}
