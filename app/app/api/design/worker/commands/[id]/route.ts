import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker, workerBody } from '@/lib/design/worker-kit';
import { claimCommand, completeCommand } from '@/lib/design/commands';
import { trackTx } from '@/lib/design/track-core';
import { TRACK_COMMAND_RESULT_BYTES, applyAdoptCompletion, applyFinishCompletion, isTrackVerb } from '@/lib/design/track-adopt';
import { recordTrackStage } from '@/lib/design/track-stage';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim') }),
  z.object({
    action: z.literal('complete'),
    status: z.enum(['done', 'failed']),
    result: z.record(z.string(), z.unknown()).optional(),
    error: z.string().max(2000).optional(),
  }),
]);

const FINAL_PUBLISH = ['published', 'blocked_gates', 'blocked_policy', 'conflict', 'failed', 'rolled_back', 'expired'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Command not found');
    const b = await workerBody(request, schema);
    if (b.action === 'claim') return NextResponse.json({ command: await claimCommand(id) });

    // A publish or rollback command completes only after its DesignPublish reached a final state.
    const cmd = await prisma.designCommand.findUnique({ where: { id } });
    if (!cmd) throw new ApiError('Command not found', 404, 'not_found');
    if (cmd.verb === 'publish' || cmd.verb === 'rollback') {
      const pid = (cmd.payload as { publish_id?: unknown } | null)?.publish_id;
      const pub = typeof pid === 'string' ? await prisma.designPublish.findUnique({ where: { id: pid }, select: { status: true } }) : null;
      if (!pub || !FINAL_PUBLISH.includes(pub.status)) {
        throw new ApiError('The publish has not reached a final state', 409, 'publish_not_final');
      }
    }
    if (isTrackVerb(cmd.verb)) {
      // v2 track verbs: the completion and its stage effects (adopt: job, head, stage; finish: result, done) are one
      // transaction, so a failure leaves the command claimed for the daemon to retry. Results may carry a page list.
      const command = await trackTx(async (scope) => {
        const done = await completeCommand(
          id,
          { status: b.status, result: b.result as Prisma.InputJsonValue | undefined, error: b.error, maxResultBytes: TRACK_COMMAND_RESULT_BYTES },
          scope.tx as never,
        );
        if (done.verb === 'adopt_branch') await applyAdoptCompletion(scope, done);
        else await applyFinishCompletion(scope, done);
        return done;
      });
      const trackId = (command.payload as { track_id?: unknown } | null)?.track_id;
      if (typeof trackId === 'string') {
        const t = await prisma.designTrack.findUnique({ where: { id: trackId }, select: { stage: true, busy_job_id: true } });
        if (t) await recordTrackStage(trackId, { stage: t.stage, busy: t.busy_job_id !== null, command: command.verb, status: command.status });
      }
      return NextResponse.json({ command });
    }
    const command = await completeCommand(id, { status: b.status, result: b.result as Prisma.InputJsonValue | undefined, error: b.error });
    return NextResponse.json({ command });
  } catch (error) {
    return handleApiError(error);
  }
}
