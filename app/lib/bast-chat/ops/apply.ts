/**
 * Bast chat v2: one chat operation from POST /api/bast-chat/worker/ops, after the route's checks (the key, the body,
 * the conversation is the owner's and running, the op is known, the owner is an active admin).
 *
 * The reach check runs first. A hit stores a proposal for Mike's tap and writes nothing else. Otherwise today's write is
 * reserved in its own statement, BEFORE any lock is taken (VERIFY-6 A1: the day's usage row is shared by every chat
 * write and every message of the day, so it is never held while waiting on a task lock; see the lock order in
 * task-locks.ts), and then the write runs in one transaction with the server-written record. Ops that change what
 * Bast's worker reads (comment, project) take their advisory locks inside that transaction and judge again under them
 * (task-locks.ts), so the transaction runs with LOCKED_TX_OPTIONS. `home` opens its own transaction (`ownTransaction`),
 * so it records after; a failed record undoes the write. A refused or failed write keeps its reserved slot (usage.ts).
 */
import type { PrismaClient } from '@prisma/client';
import { prepareOperation, storeProposal, UNDO_WINDOW_HOURS, type ProposalResult } from '../actions';
import { reserveWrite } from '../usage';
import { EMPTY_SCOPE, inLockedTransaction, scopeFor, throughGate } from '../task-locks';
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

  // Autocommit, before any lock: the usage row is held for this one statement only.
  await reserveWrite(ownerId, a.dailyWriteCap, now, db);
  let done: { run: OpRun; row: { id: string; undo_until: Date | null } };
  if (op.ownTransaction) {
    const run = await op.run({ db, ownerId, now }, input as never, prepared.expect);
    try {
      done = { run, row: await record(db, run) };
    } catch (e) {
      const undone = await op.undo({ db, ownerId, now, actor: { userId: ownerId, email: '', role: 'admin', via: 'session' } }, { after: run.after } as never, prepared.expect).catch(() => null);
      console.error('bast-chat: ops record failed', undone ? 'write undone' : 'write kept', e instanceof Error ? e.message : 'error');
      throw e;
    }
  } else {
    // Every query of the write, the op's helpers included, runs on this transaction's connection, and its best-effort
    // work waits for the commit (task-locks.ts inLockedTransaction, lib/db/scope.ts). An op that takes locks in `run`
    // holds them on this one connection (VERIFY-3 X3).
    // The ops whose `run` takes advisory locks (comment: the task scope; project: the project) first pass this process's
    // gate for the same keys, holding no connection while they wait (task-locks.ts throughGate, VERIFY-6 A1).
    const input0 = input as { task_id?: unknown; project_id?: unknown };
    const gate =
      op.name === 'comment' && typeof input0.task_id === 'string'
        ? await scopeFor(db, [input0.task_id])
        : op.name === 'project' && typeof input0.project_id === 'string'
          ? { tasks: [], projects: [input0.project_id] }
          : EMPTY_SCOPE;
    done = await throughGate(gate, () =>
      inLockedTransaction(
        db,
        async () => undefined,
        async (tx) => {
          const tdb = tx as unknown as PrismaClient;
          const run = await op.run({ db: tdb, ownerId, now }, input as never, prepared.expect);
          return { run, row: await record(tdb, run) };
        },
      ),
    );
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
