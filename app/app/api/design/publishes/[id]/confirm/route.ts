/**
 * POST /api/design/publishes/:id/confirm: step 2 of the two-step publish (design D5, 7.1, T25). The same
 * signed-in actor as step 1 (404 for anyone else), the one-time token and the typed main branch name (400 when
 * either is missing; 409 when wrong, expired, reused or foreign, or when the head, gates, main_role or live URL
 * changed). On success the row is queued with its DesignCommand and the session moves to publishing, in one
 * transaction.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { resolveDesignActor } from '@/lib/design/helpers';
import { body as readBody, PUBLISH_BODY_BYTES } from '@/lib/design/route-kit';
import { confirmPublish, designErrorResponse } from '@/lib/design/publishes';

const bodySchema = z
  .object({
    confirmation_token: z.string().max(200).optional(),
    typed_confirmation: z.string().max(100).optional(),
  })
  .strict(); // W8.2 N8

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const blocked = rejectCrossSiteRequest(request);
    if (blocked) return blocked;
    const actor = await resolveDesignActor(auth);
    const { id } = await params;
    // Capped like every other design route: 413 over 32 KB, 400 on invalid JSON or an unknown field (W8.2 N1, N8).
    const body = await readBody(request, bodySchema, PUBLISH_BODY_BYTES);
    const result = await confirmPublish(actor, id, body);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return designErrorResponse(error);
  }
}
