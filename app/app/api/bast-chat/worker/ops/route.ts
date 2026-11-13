import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { requireChatWorker, chatWorkerBody, isChatUuid } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { ownedConversation } from '@/lib/bast-chat/events';
import { getSettings } from '@/lib/bast-chat/settings';
import { getRunnableOp, OP_NAMES } from '@/lib/bast-chat/ops';
import { applyChatOp } from '@/lib/bast-chat/ops/apply';
import { assertCardConversationOp } from '@/lib/bast-chat/card-conversation';

const bodySchema = z.object({ conversation_id: z.string().uuid(), op: z.string().min(1).max(40), input: z.record(z.string(), z.unknown()) }).strict();

/**
 * POST /api/bast-chat/worker/ops: one named operation on the owner's home screen, a task comment, an email ask, a
 * wait or a project (lib/bast-chat/ops), or the start of a project or a quote. Body `{conversation_id, op, input}`, op one of
 * home, comment, email_ask, wait, project, start_project, start_quote. The owner is always the configured owner, never a user id from the request.
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
    if (conv.status !== 'running') throw new ApiError('Open the chat first.', 409, 'conversation_not_running');
    const op = getRunnableOp(body.op);
    if (!op) throw new ApiError(`That change is not known here. Known: ${OP_NAMES.join(', ')}.`, 400, 'unknown_op');
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { is_active: true, role: true } });
    if (!owner || !owner.is_active || owner.role !== 'admin') throw new ApiError('The chat owner is not available.', 409, 'owner_unavailable');

    if (!isChatUuid(conv.id)) throw new ApiError('Chat not found', 404, 'not_found');
    assertCardConversationOp(conv.task_id, op.name, body.input);

    const r = await applyChatOp({ ownerId, conversationId: conv.id, op, rawInput: body.input, dailyWriteCap: settings.daily_write_cap, now: new Date(), db: prisma });
    if (r.kind === 'proposed') {
      const res = chatJson({ action_id: r.proposal.id, status: 'proposed', proposal_kind: r.proposal.proposal_kind, line: r.proposal.line }, 202);
      res.headers.set('X-Bast-Chat-Action', r.proposal.id);
      return res;
    }
    return chatJson(
      {
        action_id: r.row.id,
        status: 'applied',
        line: r.run.summary,
        undo_until: r.row.undo_until ? r.row.undo_until.toISOString() : null,
        can_undo: r.row.undo_until !== null,
        result: r.run.result,
      },
      200,
    );
  } catch (error) {
    return chatError(error);
  }
}
