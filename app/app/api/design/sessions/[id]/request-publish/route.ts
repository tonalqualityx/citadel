/**
 * POST /api/design/sessions/:id/request-publish (design D5, 7.1): only where an admin override has switched
 * designer publish off for this site (else 409 publish_allowed). An FYI notice to the owner, never an
 * approval step. Signed-in session only, same-origin JSON.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { resolveDesignActor } from '@/lib/design/helpers';
import { designErrorResponse, requestPublish } from '@/lib/design/publishes';

const bodySchema = z.object({ note: z.string().max(2000).optional() });

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
    const result = await requestPublish(actor, id, body.note);
    return NextResponse.json(result);
  } catch (error) {
    return designErrorResponse(error);
  }
}
