/**
 * POST /api/design/sessions/:id/publish: step 1 of the two-step publish (design D5, 7.1). Queues nothing.
 * Signed-in session only (no API key of any kind), same-origin JSON. Returns the one-time confirmation token
 * (only its sha256 is stored) and exactly what the confirm dialog shows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { authActor, body as readBody, PUBLISH_BODY_BYTES } from '@/lib/design/route-kit';
import { createPublishIntent, designErrorResponse } from '@/lib/design/publishes';

const bodySchema = z
  .object({
    head_sha: z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'must be a git commit sha'),
  })
  .strict(); // unknown fields (force, skip_gates, ...) are 400, not silently dropped (W8.2 N8)

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // A signed-in session, or a design:operator-publish key acting as an admin publisher (lib/design/operator.ts).
    const { actor } = await authActor({ operator: 'publish' });
    const blocked = rejectCrossSiteRequest(request);
    if (blocked) return blocked;
    const { id } = await params;
    // Capped like every other design route: 413 over 32 KB, 400 on invalid JSON or an unknown field (W8.2 N1, N8).
    const body = await readBody(request, bodySchema, PUBLISH_BODY_BYTES);
    const result = await createPublishIntent(actor, id, body.head_sha);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return designErrorResponse(error);
  }
}
