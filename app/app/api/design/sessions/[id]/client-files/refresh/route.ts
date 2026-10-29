import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { createCommand } from '@/lib/design/commands';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

const emptySchema = z.object({}).strict();

// POST /api/design/sessions/:id/client-files/refresh (design 7.1, D11): DesignCommand(refresh_client_files);
// the daemon re-lists the client folder and posts a new `client_files` event. Idempotent while one is pending. 202.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    await body(request, emptySchema, 4096);
    if (session.status === 'closed' || session.status === 'abandoned') throw new ApiError('This session is closed', 409, 'session_closed');
    const { command, created } = await createCommand({ sessionId: session.id, verb: 'refresh_client_files', createdById: actor.userId });
    return NextResponse.json({ command_id: command.id, created }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
