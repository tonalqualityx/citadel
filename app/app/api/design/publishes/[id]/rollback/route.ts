/**
 * POST /api/design/publishes/:id/rollback (design D5, 7.1, T23): one click for an admin or that publish's
 * actor while she is a designer on the project (pm 403, anyone else 404); a designer also needs designer
 * publish on for the site (403 designer_publish_off; the admin can always roll back). The site's latest
 * successful publish only (409 not_latest). Creates
 * DesignPublish(kind rollback, queued) + DesignCommand(rollback). Signed-in session only, same-origin JSON.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { resolveDesignActor } from '@/lib/design/helpers';
import { body as readBody, PUBLISH_BODY_BYTES } from '@/lib/design/route-kit';
import { createRollback, designErrorResponse } from '@/lib/design/publishes';

const bodySchema = z.object({ reason: z.string().max(500).optional() }).strict(); // W8.2 N8

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const blocked = rejectCrossSiteRequest(request);
    if (blocked) return blocked;
    const actor = await resolveDesignActor(auth);
    const { id } = await params;
    // Capped like every other design route: 413 over 32 KB, 400 on invalid JSON or an unknown field (W8.2 N1, N8).
    const body = await readBody(request, bodySchema, PUBLISH_BODY_BYTES);
    const result = await createRollback(actor, id, body.reason);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return designErrorResponse(error);
  }
}
