import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { appendDesignerEvent } from '@/lib/design/events';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

const messageSchema = z.object({ client_ref: z.string().uuid(), text: z.string().trim().min(1).max(8000) });

// POST /api/design/sessions/:id/messages (design 7.1): steering or chat. 201 {seq}, 200 on a repeat.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    const input = await body(request, messageSchema, 48 * 1024);
    const { seq, duplicate } = await appendDesignerEvent({
      sessionId: session.id,
      authorId: actor.userId,
      kind: 'text',
      payload: { text: input.text },
      clientRef: input.client_ref,
    });
    return NextResponse.json({ seq }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
