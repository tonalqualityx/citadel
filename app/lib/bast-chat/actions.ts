/**
 * Bast chat: the record of what the chat changed, for the action line, undo, and handoff proposals.
 *
 * - `recordAction` (worker): an applied write (with the before and after of allowlisted task fields) or a
 *   proposal. Applied writes count against today's write cap and keep an undo open for 24 hours.
 * - `undoAction` (Mike's route): puts the recorded `before` back, only if the task still equals the recorded
 *   `after` ("Changed since. Open the task." otherwise). A task the chat created is undone by marking it
 *   abandoned; nothing is deleted.
 * - `releaseAction` and `declineAction` (Mike's route): a handoff proposal becomes a real reassignment only here,
 *   under Mike's own id. The worker route has no way to release; `recordAction` can only store `proposed`.
 *
 * Reader-facing sentences are plain and short. Stored summaries are cleaned (no tags, no em or en dash).
 */
import { z } from 'zod';
import type { BastChatAction, Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { cleanLine } from './card-context';
import { getSettings } from './settings';
import { assertWriteAllowed, bumpUsage } from './usage';
import { isChatUuid } from './worker-kit';

export const UNDO_WINDOW_HOURS = 24;
export const CHANGED_SINCE_TEXT = 'Changed since. Open the task.';
export const TASK_FIELDS = ['status', 'title', 'arc_id', 'assignee_id'] as const;
export const ACTION_TOOLS = ['create_task', 'update_task', 'add_to_arc', 'remove_from_arc', 'propose_handoff'] as const;
const TASK_STATUSES = ['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'] as const;

const fieldsSchema = z
  .object({
    status: z.enum(TASK_STATUSES),
    title: z.string().min(1).max(500),
    arc_id: z.string().uuid().nullable(),
    assignee_id: z.string().uuid().nullable(),
  })
  .partial()
  .strict();
export type TaskFields = z.infer<typeof fieldsSchema>;

/** The body of POST /worker/actions. Strict: an unknown key is a 400. */
export const recordActionSchema = z
  .object({
    conversation_id: z.string().uuid(),
    event_seq: z.number().int().positive().optional(),
    tool: z.enum(ACTION_TOOLS),
    target_id: z.string().uuid(),
    summary: z.string().min(1).max(600),
    before: fieldsSchema.nullable().optional(),
    after: fieldsSchema.nullable().optional(),
    proposed_assignee_id: z.string().uuid().optional(),
    status: z.enum(['applied', 'proposed', 'failed']).default('applied'),
    error: z.string().max(500).optional(),
  })
  .strict();
export type RecordActionInput = z.input<typeof recordActionSchema>;

export interface ActionView {
  id: string;
  conversation_id: string;
  event_seq: number | null;
  tool: string;
  target_id: string;
  summary: string;
  status: string;
  can_undo: boolean;
  undo_until: Date | null;
  proposed_assignee_id: string | null;
  created_at: Date;
}

export function actionView(a: BastChatAction, now: Date = new Date()): ActionView {
  return {
    id: a.id,
    conversation_id: a.conversation_id,
    event_seq: a.event_seq,
    tool: a.tool,
    target_id: a.target_id,
    summary: a.summary,
    status: a.status,
    can_undo: a.status === 'applied' && !!a.undo_until && a.undo_until.getTime() > now.getTime(),
    undo_until: a.undo_until,
    proposed_assignee_id: a.proposed_assignee_id,
    created_at: a.created_at,
  };
}

/**
 * Record a write or a proposal. Applied writes add one to today's write count; a write past the cap is still
 * recorded (it already happened) and the next one is refused by `assertWriteAllowed`. Returns the action id the
 * panel shows. A `proposed` action needs `proposed_assignee_id` and cannot be applied from here.
 */
export async function recordAction(
  raw: unknown,
  ownerId: string,
  now: Date = new Date(),
  db: PrismaClient = defaultDb,
): Promise<{ id: string; status: string; undo_until: Date | null }> {
  const input = recordActionSchema.parse(raw);
  if (input.status === 'proposed' && !input.proposed_assignee_id) throw new ApiError('A proposal needs someone to hand it to', 400, 'bad_proposal');
  if (input.status !== 'proposed' && input.proposed_assignee_id) throw new ApiError('Only a proposal names someone to hand it to', 400, 'bad_proposal');
  if (input.status === 'applied' && input.tool === 'propose_handoff') throw new ApiError('A handoff is a proposal', 400, 'bad_proposal');
  const conv = await db.bastChatConversation.findUnique({ where: { id: input.conversation_id }, select: { owner_id: true } });
  if (!conv || conv.owner_id !== ownerId) throw new ApiError('Chat not found', 404, 'not_found');
  const undo_until = input.status === 'applied' ? new Date(now.getTime() + UNDO_WINDOW_HOURS * 3600 * 1000) : null;
  return db.$transaction(async (tx) => {
    const row = await tx.bastChatAction.create({
      data: {
        conversation_id: input.conversation_id,
        event_seq: input.event_seq ?? null,
        tool: input.tool,
        target_type: 'task',
        target_id: input.target_id,
        summary: cleanLine(input.summary, 300),
        before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
        proposed_assignee_id: input.proposed_assignee_id ?? null,
        status: input.status,
        undo_until,
        error: input.error ? cleanLine(input.error, 500) : null,
      },
      select: { id: true, status: true, undo_until: true },
    });
    if (input.status === 'applied') await bumpUsage(ownerId, { writes: 1 }, now, tx);
    return row;
  });
}

/** Refuse the next write when today's write cap is used up (for the task routes and the daemon's own check). */
export async function assertChatWriteAllowed(ownerId: string, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<void> {
  await assertWriteAllowed(ownerId, await getSettings(db), now, db);
}

/** Open actions of a conversation for the panel: applied or proposed, newest last. */
export async function listActions(conversationId: string, now: Date = new Date(), db: Pick<PrismaClient, 'bastChatAction'> = defaultDb): Promise<ActionView[]> {
  const rows = await db.bastChatAction.findMany({ where: { conversation_id: conversationId }, orderBy: { created_at: 'asc' }, take: 200 });
  return rows.map((r) => actionView(r, now));
}

async function loadOwned(actionId: string, ownerId: string, tx: Pick<Prisma.TransactionClient, 'bastChatAction' | 'bastChatConversation'>): Promise<BastChatAction> {
  if (!isChatUuid(actionId)) throw new ApiError('Not found', 404, 'not_found');
  const a = await tx.bastChatAction.findUnique({ where: { id: actionId } });
  if (!a) throw new ApiError('Not found', 404, 'not_found');
  const conv = await tx.bastChatConversation.findUnique({ where: { id: a.conversation_id }, select: { owner_id: true } });
  if (!conv || conv.owner_id !== ownerId) throw new ApiError('Not found', 404, 'not_found');
  return a;
}

const pickFields = (v: unknown): TaskFields => {
  const p = fieldsSchema.safeParse(v ?? {});
  return p.success ? p.data : {};
};

/** Undo an applied write. 409 when it was already undone or resolved, the window has passed, or the task changed since. */
export async function undoAction(actionId: string, actorId: string, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<ActionView> {
  return db.$transaction(async (tx) => {
    const a = await loadOwned(actionId, actorId, tx);
    if (a.status === 'undone') throw new ApiError('That was already undone.', 409, 'undo_used');
    if (a.status !== 'applied') throw new ApiError("That can't be undone.", 409, 'not_undoable');
    if (!a.undo_until || a.undo_until.getTime() <= now.getTime()) throw new ApiError('It is too late to undo that.', 409, 'undo_expired');
    const after = pickFields(a.after);
    let restore: TaskFields;
    if (a.tool === 'create_task') {
      restore = { status: 'abandoned' };
    } else {
      restore = pickFields(a.before);
      // Only the fields the chat changed go back.
      restore = Object.fromEntries(Object.entries(restore).filter(([k]) => k in after)) as TaskFields;
    }
    if (Object.keys(restore).length === 0) throw new ApiError("That can't be undone.", 409, 'not_undoable');
    // Compare and set in one statement: the task must still hold exactly the values the chat wrote.
    const where: Prisma.TaskWhereInput = { id: a.target_id, is_deleted: false, ...(after as Prisma.TaskWhereInput) };
    const r = await tx.task.updateMany({ where, data: restore as Prisma.TaskUncheckedUpdateManyInput });
    if (r.count !== 1) throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
    const done = await tx.bastChatAction.update({ where: { id: a.id }, data: { status: 'undone', resolved_at: now, resolved_by_id: actorId } });
    return actionView(done, now);
  });
}

/**
 * Carry out a handoff proposal under Mike's session: the task goes to the proposed person, and the action is
 * `released`. 409 when it is not a waiting proposal. The proposal is claimed first (one winner on a double tap).
 */
export async function releaseAction(actionId: string, actorId: string, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<ActionView> {
  return db.$transaction(async (tx) => {
    const a = await loadOwned(actionId, actorId, tx);
    if (a.status !== 'proposed' || !a.proposed_assignee_id) throw new ApiError('That is not waiting for a decision.', 409, 'not_proposed');
    const target = await tx.user.findUnique({ where: { id: a.proposed_assignee_id }, select: { id: true, is_active: true } });
    if (!target || !target.is_active) throw new ApiError('That person is not available.', 409, 'assignee_unavailable');
    const claim = await tx.bastChatAction.updateMany({ where: { id: a.id, status: 'proposed' }, data: { status: 'released', resolved_at: now, resolved_by_id: actorId } });
    if (claim.count !== 1) throw new ApiError('That is not waiting for a decision.', 409, 'not_proposed');
    const moved = await tx.task.updateMany({ where: { id: a.target_id, is_deleted: false }, data: { assignee_id: a.proposed_assignee_id } });
    if (moved.count !== 1) throw new ApiError('That task is gone.', 409, 'task_missing');
    const row = await tx.bastChatAction.findUniqueOrThrow({ where: { id: a.id } });
    return actionView(row, now);
  });
}

/** "Keep it": drop a handoff proposal. The task is not touched. */
export async function declineAction(actionId: string, actorId: string, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<ActionView> {
  return db.$transaction(async (tx) => {
    const a = await loadOwned(actionId, actorId, tx);
    if (a.status !== 'proposed') throw new ApiError('That is not waiting for a decision.', 409, 'not_proposed');
    const claim = await tx.bastChatAction.updateMany({ where: { id: a.id, status: 'proposed' }, data: { status: 'declined', resolved_at: now, resolved_by_id: actorId } });
    if (claim.count !== 1) throw new ApiError('That is not waiting for a decision.', 409, 'not_proposed');
    const row = await tx.bastChatAction.findUniqueOrThrow({ where: { id: a.id } });
    return actionView(row, now);
  });
}
