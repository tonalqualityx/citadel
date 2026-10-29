import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { createCommand } from '@/lib/design/commands';
import { projectSession, workerView } from '@/lib/design/projections';
import { closeSession } from '@/lib/design/sessions';
import { stopTimer } from '@/lib/design/timer';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

const closeSchema = z.object({ reason: z.string().max(500).optional() }).strict();
const CLOSABLE_WITHOUT_DAEMON = ['awaiting_input', 'paused_budget', 'stopped'];

// POST /api/design/sessions/:id/close (design 7.1): DesignCommand(close); refused while publishing.
// The daemon does the real close (worktree removal, claim release). When the daemon is offline and the session
// is in a state the worker could close from, the server closes it now through closeSession (closed vs
// abandoned by publish history) so the designer is never stuck; the command stays queued for the cleanup.
// The automatic timer (D10) stops here; the daemon-side close also ends the session, which the sweep covers.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    const input = await body(request, closeSchema, 4096);
    if (session.status === 'closed' || session.status === 'abandoned') return NextResponse.json({ session: projectSession(session) });
    if (session.status === 'publishing') throw new ApiError('A publish is running; close after it finishes', 409, 'publish_in_progress');

    await createCommand({ sessionId: session.id, verb: 'close', payload: input.reason ? { reason: input.reason } : {}, createdById: actor.userId });

    await stopTimer(session);

    let current = session;
    if (CLOSABLE_WITHOUT_DAEMON.includes(session.status)) {
      const state = await prisma.designWorkerState.findUnique({ where: { id: 1 }, select: { last_heartbeat_at: true, paused: true } });
      if (!workerView(state).online) current = await closeSession(session.id);
    }
    return NextResponse.json({ session: projectSession(current) });
  } catch (error) {
    return handleApiError(error);
  }
}
