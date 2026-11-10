import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { isUuid } from '@/lib/design/helpers';
import { patchPin, patchPinSchema } from '@/lib/design/pins';
import { projectPin } from '@/lib/design/projections';
import { assertTrackWritable } from '@/lib/design/track-session';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

// PATCH /api/design/pins/:id (design 7.1): note / status pending|discarded|followup. Only pending pins change.
export async function PATCH(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError('Pin not found', 404, 'not_found');
    const pin = await prisma.designPin.findUnique({ where: { id } });
    if (!pin) throw new ApiError('Pin not found', 404, 'not_found');
    // The pin's session decides visibility: another designer's pin is a 404, a pm write a 403.
    const session = await loadSessionFor(actor, pin.session_id, { mode: 'write' });
    await assertTrackWritable(session, { busy: true, done: true }); // SPEC 2.2, 2.3: 409 track_busy / track_done
    const input = await body(request, patchPinSchema, 16 * 1024);
    const updated = await patchPin(actor, pin, input);
    return NextResponse.json({ pin: projectPin(updated) });
  } catch (error) {
    return handleApiError(error);
  }
}
