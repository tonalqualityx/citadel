import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { isOracleBot } from '@/lib/oracle/helpers';

// Phase 1.5b — Remote Spawn. This is a remote-code-execution surface by design (an
// admin queues a command, the local dispatcher runs `claude` in a new tmux session),
// so the defense lives entirely in: (1) a hard verb allowlist enforced here via a Zod
// literal — no other verb can ever be created, and (2) argv-array execution on the
// dispatcher side (never a shell string) — see feature-planning/oracle-phase1-visualizer.md
// "Phase 1.5b" for the full invariant list. Only admins may create commands; only the
// oracle service bot may read/claim them (enforced below, machine-scoped).
const spawnPayloadSchema = z.object({
  cwd: z.string().min(1).max(1024),
  prompt: z.string().max(10240).optional(),
  title: z.string().max(256).optional(),
});

const createCommandSchema = z.object({
  machine: z.string().min(1).max(255),
  verb: z.literal('spawn_session'),
  payload: spawnPayloadSchema,
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const data = createCommandSchema.parse(await request.json());

    const machine = await prisma.oracleMachine.findUnique({ where: { name: data.machine } });
    if (!machine) {
      throw new ApiError('Machine not found', 404);
    }

    const command = await prisma.oracleCommand.create({
      data: {
        machine_id: machine.id,
        verb: data.verb,
        payload: data.payload as Prisma.InputJsonValue,
        status: 'pending',
        created_by_id: auth.userId,
      },
    });

    return NextResponse.json(
      {
        id: command.id,
        machine: machine.name,
        verb: command.verb,
        payload: command.payload,
        status: command.status,
        created_by_id: command.created_by_id,
        claimed_at: command.claimed_at,
        completed_at: command.completed_at,
        result: command.result,
        error: command.error,
        created_at: command.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

const VALID_STATUSES = ['pending', 'claimed', 'done', 'failed'] as const;
const statusQuerySchema = z.enum(VALID_STATUSES);

// Bot-only, machine-scoped poll. The dispatcher calls this once a minute (same cadence
// as the heartbeat) to pick up work queued for its own machine. `machine` is required —
// there is no "give me everyone's commands" mode, by design (a machine only ever acts on
// its own queue). Scoping is done via the relation filter below rather than a pre-check
// on OracleMachine, so a machine that hasn't ingested yet simply yields an empty list
// instead of a 404 (nothing could have been queued for it either way).
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!isOracleBot(auth)) {
      throw new ApiError('Oracle commands are machine-only for reads', 403);
    }

    const url = new URL(request.url);
    const machineName = url.searchParams.get('machine');
    if (!machineName) {
      throw new ApiError('machine query parameter is required', 400);
    }

    const statusParam = url.searchParams.get('status') ?? 'pending';
    const status = statusQuerySchema.parse(statusParam);

    const commands = await prisma.oracleCommand.findMany({
      where: { status, machine: { name: machineName } },
      orderBy: { created_at: 'asc' },
    });

    return NextResponse.json({
      commands: commands.map((c) => ({
        id: c.id,
        verb: c.verb,
        payload: c.payload,
        status: c.status,
        created_at: c.created_at,
        claimed_at: c.claimed_at,
        completed_at: c.completed_at,
        result: c.result,
        error: c.error,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
