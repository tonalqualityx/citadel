import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { createPin, pinBodySchema } from '@/lib/design/pins';
import { projectPin } from '@/lib/design/projections';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

// POST /api/design/sessions/:id/pins (design 7.1): accepts the shipped dp:packet fields. 201 {pin}.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    const input = await body(request, pinBodySchema, 32 * 1024);
    const pin = await createPin(actor, session, input);
    return NextResponse.json({ pin: projectPin(pin) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
