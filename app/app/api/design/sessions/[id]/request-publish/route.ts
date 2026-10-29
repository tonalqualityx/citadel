/**
 * POST /api/design/sessions/:id/request-publish (design D5, 7.1): only where an admin override has switched
 * designer publish off for this site (else 409 publish_allowed). An FYI notice to the owner, never an
 * approval step. Signed-in session only, same-origin JSON.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { authActor, body as readBody, PUBLISH_BODY_BYTES } from '@/lib/design/route-kit';
import { designErrorResponse, requestPublish } from '@/lib/design/publishes';

const bodySchema = z.object({ note: z.string().max(2000).optional() }).strict(); // W8.2 N8

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Session only, for every API key including an operator key (W8.2 H7): refused before the session is looked up,
    // so a key learns nothing about which ids exist.
    const { actor } = await authActor();
    const blocked = rejectCrossSiteRequest(request);
    if (blocked) return blocked;
    const { id } = await params;
    // Capped like every other design route: 413 over 32 KB, 400 on invalid JSON or an unknown field (W8.2 N1, N8).
    const body = await readBody(request, bodySchema, PUBLISH_BODY_BYTES);
    const result = await requestPublish(actor, id, body.note);
    return NextResponse.json(result);
  } catch (error) {
    return designErrorResponse(error);
  }
}
