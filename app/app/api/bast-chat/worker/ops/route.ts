import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { requireChatWorker, chatWorkerBody, isChatUuid } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { ownedConversation } from '@/lib/bast-chat/events';
import { getSettings } from '@/lib/bast-chat/settings';
import { reserveWrite } from '@/lib/bast-chat/usage';
import { prepareOperation, storeProposal, UNDO_WINDOW_HOURS } from '@/lib/bast-chat/actions';
import { getRunnableOp, OP_NAMES } from '@/lib/bast-chat/ops';

const bodySchema = z.object({ conversation_id: z.string().uuid(), op: z.string().min(1).max(40), input: z.record(z.string(), z.unknown()) }).strict();

/**
 * POST /api/bast-chat/worker/ops: one named operation on the owner's home screen, a task comment, an email ask, a
 * wait or a project (lib/bast-chat/ops). Body `{conversation_id, op, input}`, op one of home, comment, email_ask,
 * wait, project. The owner is always the configured owner, never a user id from the request.
 *
 * 200 `{action_id, status: 'applied', line, undo_until, can_undo, result}`: written, recorded with its true before and
 * after, one write counted. 202 `{action_id, status: 'proposed', proposal_kind, line}` with `X-Bast-Chat-Action`:
 * it would start Bast or show a client something, so a proposal waits for Mike's tap, nothing else is written (one
 * write is counted). Every failure is `{error: "<plain sentence>"}`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, bodySchema);
    const settings = await getSettings(prisma);
    const ownerId = await workerOwnerId();
    if (!settings.enabled) throw new ApiError('The chat is off.', 409, 'chat_off');
    const conv = await ownedConversation(body.conversation_id, ownerId, prisma);
    if (conv.status === 'closed') throw new ApiError('Open the chat first.', 409, 'conversation_closed');
    const op = getRunnableOp(body.op);
    if (!op) throw new ApiError(`That change is not known here. Known: ${OP_NAMES.join(', ')}.`, 400, 'unknown_op');
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { is_active: true, role: true } });
    if (!owner || !owner.is_active || owner.role !== 'admin') throw new ApiError('The chat owner is not available.', 409, 'owner_unavailable');

    const now = new Date();
    const { input, prepared } = await prepareOperation(op.name, body.input, { ownerId, now, db: prisma });

    if (prepared.reach.needs_tap) {
      const p = await storeProposal({ ownerId, conversationId: conv.id, tool: op.tool, op: op.name, input, prepared, reserve: true, now, db: prisma });
      const res = chatJson({ action_id: p.id, status: 'proposed', proposal_kind: p.proposal_kind, line: p.line }, 202);
      res.headers.set('X-Bast-Chat-Action', p.id);
      return res;
    }

    const record = async (db: typeof prisma, run: Awaited<ReturnType<typeof op.run>>) =>
      db.bastChatAction.create({
        data: {
          conversation_id: conv.id,
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
    if (!isChatUuid(conv.id)) throw new ApiError('Chat not found', 404, 'not_found');

    let done: { run: Awaited<ReturnType<typeof op.run>>; row: { id: string; undo_until: Date | null } };
    if (op.ownTransaction) {
      // runHomeAct opens its own transaction, so reserve first and record after; a failed record undoes the write.
      await reserveWrite(ownerId, settings.daily_write_cap, now, prisma);
      const run = await op.run({ db: prisma, ownerId, now }, input as never, prepared.expect);
      try {
        done = { run, row: await record(prisma, run) };
      } catch (e) {
        const undone = await op.undo({ db: prisma, ownerId, now, actor: { userId: ownerId, email: '', role: 'admin', via: 'session' } }, { after: run.after } as never, prepared.expect).catch(() => null);
        console.error('bast-chat: ops record failed', undone ? 'write undone' : 'write kept', e instanceof Error ? e.message : 'error');
        throw e;
      }
    } else {
      done = await prisma.$transaction(async (tx) => {
        const db = tx as unknown as typeof prisma;
        await reserveWrite(ownerId, settings.daily_write_cap, now, tx);
        const run = await op.run({ db, ownerId, now }, input as never, prepared.expect);
        return { run, row: await record(db, run) };
      });
    }
    if (done.run.afterCommit) {
      try {
        await done.run.afterCommit();
      } catch (e) {
        console.error('bast-chat: ops after-commit step failed', e instanceof Error ? e.message : 'error');
      }
    }
    return chatJson(
      {
        action_id: done.row.id,
        status: 'applied',
        line: done.run.summary,
        undo_until: done.row.undo_until ? done.row.undo_until.toISOString() : null,
        can_undo: done.row.undo_until !== null,
        result: done.run.result,
      },
      200,
    );
  } catch (error) {
    return chatError(error);
  }
}
