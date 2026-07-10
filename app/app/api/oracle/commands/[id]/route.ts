import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { isOracleBot, MAX_COMMAND_RESULT_BYTES } from '@/lib/oracle/helpers';

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
  } catch {
    return Infinity;
  }
}

const resultSchema = z
  .record(z.string(), z.unknown())
  .refine((r) => byteLength(r) <= MAX_COMMAND_RESULT_BYTES, {
    message: `result exceeds ${MAX_COMMAND_RESULT_BYTES} bytes`,
  });

const claimSchema = z.object({ action: z.literal('claim') });
const completeSchema = z.object({
  action: z.literal('complete'),
  status: z.enum(['done', 'failed']),
  result: resultSchema.optional(),
  error: z.string().max(2000).optional(),
});
const patchBodySchema = z.discriminatedUnion('action', [claimSchema, completeSchema]);

function shapeCommand(c: {
  id: string;
  machine_id: string;
  verb: string;
  payload: unknown;
  status: string;
  claimed_at: Date | null;
  completed_at: Date | null;
  result: unknown;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: c.id,
    machine_id: c.machine_id,
    verb: c.verb,
    payload: c.payload,
    status: c.status,
    claimed_at: c.claimed_at,
    completed_at: c.completed_at,
    result: c.result,
    error: c.error,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

// Bot-only. Two transitions, both machine-scoped by the dispatcher only ever acting on
// commands it fetched from its own machine's GET poll:
//   claim:    pending -> claimed, ATOMIC via updateMany(where status=pending) so two
//             concurrent claim attempts can never both win — exactly one gets count:1,
//             the loser gets 409.
//   complete: claimed -> done|failed, also gated via updateMany(where status=claimed)
//             for the same reason (a claim result reported twice, or reported after
//             some other transition already landed, shouldn't silently double-apply).
// On complete, an OracleEvent (kind=command_executed, machine-scoped) is written for the
// audit trail — payload carries only command metadata (id/verb/status/result), never the
// prompt or cwd, keeping the event tail small and audit-focused.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!isOracleBot(auth)) {
      throw new ApiError('Oracle commands are machine-only', 403);
    }

    const { id } = await params;
    const body = patchBodySchema.parse(await request.json());

    const existing = await prisma.oracleCommand.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Command not found', 404);
    }

    if (body.action === 'claim') {
      const claimResult = await prisma.oracleCommand.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'claimed', claimed_at: new Date() },
      });
      if (claimResult.count === 0) {
        throw new ApiError('Command already claimed or not pending', 409);
      }
      const updated = await prisma.oracleCommand.findUnique({ where: { id } });
      return NextResponse.json(shapeCommand(updated!));
    }

    // action === 'complete'
    const now = new Date();
    const completeResult = await prisma.oracleCommand.updateMany({
      where: { id, status: 'claimed' },
      data: {
        status: body.status,
        completed_at: now,
        ...(body.result !== undefined && { result: body.result as Prisma.InputJsonValue }),
        ...(body.error !== undefined && { error: body.error }),
      },
    });
    if (completeResult.count === 0) {
      throw new ApiError('Command is not in a claimed state', 409);
    }

    await prisma.oracleEvent.create({
      data: {
        machine_id: existing.machine_id,
        kind: 'command_executed',
        payload: {
          command_id: existing.id,
          verb: existing.verb,
          status: body.status,
          result: (body.result ?? null) as Prisma.InputJsonValue,
        },
        ts: now,
      },
    });

    const updated = await prisma.oracleCommand.findUnique({ where: { id } });
    return NextResponse.json(shapeCommand(updated!));
  } catch (error) {
    return handleApiError(error);
  }
}
