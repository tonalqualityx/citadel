/**
 * Bast chat v2: one chat operation from POST /api/bast-chat/worker/ops, after the route's checks (the key, the body,
 * the conversation is the owner's and running, the op is known, the owner is an active admin).
 *
 * The reach check runs first. A hit stores a proposal for Mike's tap and writes nothing else. Otherwise the write runs
 * in one transaction with today's reservation and the server-written record. Ops that change what Bast's worker reads
 * (comment, project) take their advisory locks inside that transaction and judge again under them (task-locks.ts), so
 * the transaction runs with LOCKED_TX_OPTIONS. `home` opens its own transaction (`ownTransaction`), so it reserves
 * first and records after; a failed record undoes the write.
 */
import type { PrismaClient } from '@prisma/client';
import { prepareOperation, storeProposal, UNDO_WINDOW_HOURS, type ProposalResult } from '../actions';
import { reserveWrite } from '../usage';
import { ApiError } from '@/lib/api/errors';
import { runOnTransaction } from '@/lib/db/scope';
import { BUSY_TEXT, LOCKED_TX_OPTIONS, isBusyError } from '../task-locks';
import type { OpRun, RunnableOp } from './index';

export type ChatOpResult =
  | { kind: 'proposed'; proposal: ProposalResult }
  | { kind: 'applied'; run: OpRun; row: { id: string; undo_until: Date | null } };

export async function applyChatOp(a: {
  ownerId: string;
  conversationId: string;
  op: RunnableOp;
  rawInput: unknown;
  dailyWriteCap: number;
  now: Date;
  db: PrismaClient;
}): Promise<ChatOpResult> {
  const { ownerId, conversationId, op, now, db } = a;
  const { input, prepared } = await prepareOperation(op.name, a.rawInput, { ownerId, now, db });

  if (prepared.reach.needs_tap) {
    const proposal = await storeProposal({ ownerId, conversationId, tool: op.tool, op: op.name, input, prepared, reserve: true, now, db });
    return { kind: 'proposed', proposal };
  }

  const record = async (rdb: PrismaClient, run: OpRun) =>
    rdb.bastChatAction.create({
      data: {
        conversation_id: conversationId,
        tool: op.tool,
        target_type: op.target_type,
        target_id: run.target_id,
        summary: run.summary,
        before: run.before,
        after: run.after,
        status: 'applied',
        undo_until: run.undoable ? new Date(now.getTime() + UNDO_WINDOW_HOURS * 3600 * 1000) : null,
      },
      select: { id: true, undo_until: true },
    });

  let done: { run: OpRun; row: { id: string; undo_until: Date | null } };
  if (op.ownTransaction) {
    await reserveWrite(ownerId, a.dailyWriteCap, now, db);
    const run = await op.run({ db, ownerId, now }, input as never, prepared.expect);
    try {
      done = { run, row: await record(db, run) };
    } catch (e) {
      const undone = await op.undo({ db, ownerId, now, actor: { userId: ownerId, email: '', role: 'admin', via: 'session' } }, { after: run.after } as never, prepared.expect).catch(() => null);
      console.error('bast-chat: ops record failed', undone ? 'write undone' : 'write kept', e instanceof Error ? e.message : 'error');
      throw e;
    }
  } else {
    try {
      // Every query of the write, the op's helpers included, runs on this transaction's connection (lib/db/scope.ts):
      // an op that takes locks in `run` holds them on this one connection and never waits for a second (VERIFY-3 X3).
      done = await db.$transaction(
        async (tx) =>
          runOnTransaction(tx, async () => {
            const tdb = tx as unknown as PrismaClient;
            await reserveWrite(ownerId, a.dailyWriteCap, now, tx);
            const run = await op.run({ db: tdb, ownerId, now }, input as never, prepared.expect);
            return { run, row: await record(tdb, run) };
          }),
        LOCKED_TX_OPTIONS,
      );
    } catch (e) {
      if (!(e instanceof ApiError) && isBusyError(e)) throw new ApiError(BUSY_TEXT, 409, 'busy');
      throw e;
    }
  }
  if (done.run.afterCommit) {
    try {
      await done.run.afterCommit();
    } catch (e) {
      console.error('bast-chat: ops after-commit step failed', e instanceof Error ? e.message : 'error');
    }
  }
  return { kind: 'applied', ...done };
}
