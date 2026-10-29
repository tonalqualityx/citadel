import { NextRequest, NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { createCommand } from '@/lib/design/commands';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { z } from 'zod';

const emptySchema = z.object({}).passthrough();

// POST /api/design/sessions/:id/stop (design 7.1): DesignCommand(stop); idempotent while one is pending. 202.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    await body(request, emptySchema, 4096);
    if (session.status === 'closed' || session.status === 'abandoned') throw new ApiError('This session is closed', 409, 'session_closed');
    const { command, created } = await createCommand({ sessionId: session.id, verb: 'stop', createdById: actor.userId });
    return NextResponse.json({ command_id: command.id, created }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
