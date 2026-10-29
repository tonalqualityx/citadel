import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { applyBodySchema, applyPins, ApplyRefusal } from '@/lib/design/pins';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

// POST /api/design/sessions/:id/apply (design 7.1): budget, stale pins, then one `apply` event = ApplyPayload.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    const input = await body(request, applyBodySchema, 48 * 1024);
    const { seq, duplicate } = await applyPins(actor, session, input);
    return NextResponse.json({ seq }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ApplyRefusal) return NextResponse.json(error.body, { status: error.status });
    return handleApiError(error);
  }
}
