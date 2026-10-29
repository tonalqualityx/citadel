/**
 * POST /api/design/publishes/:id/rollback (design D5, 7.1, T23): one click for an admin or that publish's
 * actor (pm 403, anyone else 404), the site's latest successful publish only (409 not_latest). Creates
 * DesignPublish(kind rollback, queued) + DesignCommand(rollback). Signed-in session only, same-origin JSON.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { resolveDesignActor } from '@/lib/design/helpers';
import { createRollback, designErrorResponse } from '@/lib/design/publishes';

const bodySchema = z.object({ reason: z.string().max(500).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const blocked = rejectCrossSiteRequest(request);
    if (blocked) return blocked;
    const actor = await resolveDesignActor(auth);
    const { id } = await params;
    const raw = await request.json().catch(() => {
      throw new ApiError('Body must be JSON', 400, 'invalid_json');
    });
    const body = bodySchema.parse(raw ?? {});
    const result = await createRollback(actor, id, body.reason);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return designErrorResponse(error);
  }
}
