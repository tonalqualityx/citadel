/**
 * Designer Portal: the command queue (design 6 DesignCommand, 7.3 inbox and PATCH worker/commands/:id).
 * Claim and complete are compare-and-set updateMany calls (the oracle/commands precedent): exactly one
 * claimer wins, the loser gets a 409.
 */
import type { DesignCommand, DesignCommandVerb, Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { isUuid } from './helpers';
import { MAX_EVENT_PAYLOAD_BYTES, pendingDesignerEvents, type PendingMessage } from './events';

export const MAX_COMMAND_RESULT_BYTES = 8 * 1024;
/** Verbs where a second pending copy is pointless: creating one while another is pending returns the first. */
export const IDEMPOTENT_VERBS: readonly DesignCommandVerb[] = ['stop', 'close', 'resume', 'refresh_client_files'];

type Db = PrismaClient;

const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');

export async function createCommand(
  input: { sessionId: string; verb: DesignCommandVerb; payload?: Prisma.InputJsonValue; createdById: string },
  db: PrismaClient | Prisma.TransactionClient = defaultDb,
): Promise<{ command: DesignCommand; created: boolean }> {
  if (!isUuid(input.sessionId)) throw new ApiError('Session not found', 404, 'not_found');
  const payload = input.payload ?? {};
  if (size(payload) > MAX_EVENT_PAYLOAD_BYTES) throw new ApiError('Command payload too large', 413, 'payload_too_large');
  // Inside a caller's transaction (raiseBudget) the lock and insert join it; otherwise open one.
  const run = async (tx: Prisma.TransactionClient) => {
    if (IDEMPOTENT_VERBS.includes(input.verb)) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`design-cmd:${input.sessionId}:${input.verb}`}))`;
      const existing = await tx.designCommand.findFirst({ where: { session_id: input.sessionId, verb: input.verb, status: 'pending' }, orderBy: { created_at: 'asc' } });
      if (existing) return { command: existing, created: false };
    }
    const command = await tx.designCommand.create({
      data: { session_id: input.sessionId, verb: input.verb, payload, created_by_id: input.createdById },
    });
    return { command, created: true };
  };
  return '$transaction' in db ? db.$transaction(run) : run(db);
}

export interface InboxCommand {
  id: string;
  /** null for the session-less Drive share verbs. */
  session_id: string | null;
  verb: DesignCommandVerb;
  payload: Prisma.JsonValue;
  created_at: Date;
  created_by: { id: string; role: string | null };
}

/** Pending commands first, oldest first, then undelivered designer messages (7.3 inbox). */
export async function inbox(
  opts: { max?: number } = {},
  db: Pick<PrismaClient, 'designCommand' | 'designEvent' | 'user'> = defaultDb,
): Promise<{ commands: InboxCommand[]; messages: PendingMessage[] }> {
  const max = Math.min(200, Math.max(1, Math.trunc(opts.max ?? 50) || 50));
  const rows = await db.designCommand.findMany({
    where: { status: 'pending' },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    take: max,
  });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.created_by_id))] } }, select: { id: true, role: true } });
  const roleOf = new Map(users.map((u) => [u.id, u.role as string]));
  const commands = rows.map((r) => ({
    id: r.id, session_id: r.session_id, verb: r.verb, payload: r.payload, created_at: r.created_at,
    created_by: { id: r.created_by_id, role: roleOf.get(r.created_by_id) ?? null },
  }));
  const messages = await pendingDesignerEvents(max, db);
  return { commands, messages };
}

/** pending -> claimed. Exactly one concurrent caller wins; the rest get 409 `command_taken` (404 if the id is unknown). */
export async function claimCommand(id: string, db: Db = defaultDb): Promise<DesignCommand> {
  if (!isUuid(id)) throw new ApiError('Command not found', 404, 'not_found');
  const res = await db.designCommand.updateMany({ where: { id, status: 'pending' }, data: { status: 'claimed', claimed_at: new Date() } });
  const row = await db.designCommand.findUnique({ where: { id } });
  if (!row) throw new ApiError('Command not found', 404, 'not_found');
  if (res.count !== 1) throw new ApiError('Command already claimed', 409, 'command_taken');
  return row;
}

/** claimed -> done|failed with a result capped at 8 KB (413). 409 unless the command is currently claimed. */
export async function completeCommand(
  id: string,
  input: { status: 'done' | 'failed'; result?: Prisma.InputJsonValue | null; error?: string | null },
  db: Db = defaultDb,
): Promise<DesignCommand> {
  if (!isUuid(id)) throw new ApiError('Command not found', 404, 'not_found');
  if (input.status !== 'done' && input.status !== 'failed') throw new ApiError('status must be done or failed', 400, 'bad_status');
  if (input.result != null && size(input.result) > MAX_COMMAND_RESULT_BYTES) throw new ApiError('Command result is over 8 KB', 413, 'result_too_large');
  const res = await db.designCommand.updateMany({
    where: { id, status: 'claimed' },
    data: { status: input.status, completed_at: new Date(), result: input.result == null ? undefined : input.result, error: input.error ?? null },
  });
  const row = await db.designCommand.findUnique({ where: { id } });
  if (!row) throw new ApiError('Command not found', 404, 'not_found');
  if (res.count !== 1) throw new ApiError(`Command is ${row.status}, not claimed`, 409, 'command_not_claimed');
  return row;
}
