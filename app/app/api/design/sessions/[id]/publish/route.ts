/**
 * POST /api/design/sessions/:id/publish: step 1 of the two-step publish (design D5, 7.1). Queues nothing.
 * Signed-in session only (no API key of any kind), same-origin JSON. Returns the one-time confirmation token
 * (only its sha256 is stored) and exactly what the confirm dialog shows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { resolveDesignActor } from '@/lib/design/helpers';
import { createPublishIntent, designErrorResponse } from '@/lib/design/publishes';

const bodySchema = z.object({
  head_sha: z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'must be a git commit sha'),
});

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
    const body = bodySchema.parse(raw);
    const result = await createPublishIntent(actor, id, body.head_sha);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return designErrorResponse(error);
  }
}
