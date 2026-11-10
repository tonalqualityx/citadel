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
 * The server is the only author of what a tap does and says. `recordAction` checks every record against the real
 * task read from the database at that moment, stores only values it validated, and writes the summary line itself.
 * The worker's own summary text is ignored and never stored or shown.
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
    /** Ignored: the server writes the line. Still accepted so the machine's current body keeps working. */
    summary: z.string().max(600).optional(),
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

const CREATE_WINDOW_MINUTES = 10;
const STATUS_WORDS: Record<string, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  review: 'review',
  done: 'done',
  blocked: 'blocked',
  abandoned: 'abandoned',
};
const bad = (message: string, code = 'bad_action') => new ApiError(message, 400, code);
const quoted = (title: string | null | undefined) => `"${cleanLine(title ?? 'Untitled', 60)}"`;

async function firstNameOf(db: Pick<Prisma.TransactionClient, 'user'>, id: string | null): Promise<string | null> {
  if (!id) return null;
  const u = await db.user.findUnique({ where: { id }, select: { name: true, is_active: true } });
  if (!u) return null;
  return cleanLine(u.name.split(/\s+/)[0] ?? '', 40) || null;
}

/** The line for an applied write, built only from validated values and the real task. */
async function appliedSummary(
  db: Pick<Prisma.TransactionClient, 'user'>,
  task: { title: string },
  before: TaskFields,
  after: TaskFields,
  ownerId: string,
): Promise<string> {
  const parts: string[] = [];
  if (after.title !== undefined) parts.push(`Renamed ${quoted(before.title)} to ${quoted(after.title)}.`);
  const t = quoted(task.title);
  if (after.status !== undefined) parts.push(after.status === 'done' ? `Marked ${t} done.` : `Moved ${t} to ${STATUS_WORDS[after.status] ?? 'a new status'}.`);
  if ('arc_id' in after) parts.push(after.arc_id ? `Moved ${t} into an arc.` : `Took ${t} out of its arc.`);
  if ('assignee_id' in after && before.assignee_id !== ownerId) {
    const from = before.assignee_id ? await firstNameOf(db, before.assignee_id) : null;
    parts.push(before.assignee_id ? `Took ${t} back from ${from ?? 'someone'}.` : `Assigned ${t} to you.`);
  }
  return parts.join(' ');
}

/**
 * Record a write or a proposal. Every record is checked against the real task as it is right now:
 * - applied (update_task, add_to_arc, remove_from_arc): `after` must equal the task's current values for exactly
 *   those fields (status, title, arc_id, assignee_id), `before` only for the fields in `after`, and `after.assignee_id`
 *   can only be the owner;
 * - applied create_task: the task must be the owner's, tagged from-chat, made in the last 10 minutes;
 * - proposed: the task must be the owner's now and the person one of the fixed handoff users.
 * The summary is written here. Applied writes add one to today's write count; a write past the cap is still
 * recorded (it already happened) and the next one is refused by `assertWriteAllowed`.
 */
export async function recordAction(
  raw: unknown,
  ownerId: string,
  now: Date = new Date(),
  db: PrismaClient = defaultDb,
): Promise<{ id: string; status: string; undo_until: Date | null }> {
  const input = recordActionSchema.parse(raw);
  if (input.status === 'proposed' && !input.proposed_assignee_id) throw bad('A proposal needs someone to hand it to', 'bad_proposal');
  if (input.status !== 'proposed' && input.proposed_assignee_id) throw bad('Only a proposal names someone to hand it to', 'bad_proposal');
  if (input.status === 'applied' && input.tool === 'propose_handoff') throw bad('A handoff is a proposal', 'bad_proposal');
  if (input.status === 'proposed' && input.tool !== 'propose_handoff') throw bad('Only a handoff can be a proposal', 'bad_proposal');
  const conv = await db.bastChatConversation.findUnique({ where: { id: input.conversation_id }, select: { owner_id: true } });
  if (!conv || conv.owner_id !== ownerId) throw new ApiError('Chat not found', 404, 'not_found');

  let summary: string;
  let before: TaskFields | null = null;
  let after: TaskFields | null = null;
  let proposedId: string | null = null;
  let error: string | null = null;

  if (input.status === 'failed') {
    summary = "That didn't go through.";
    error = input.error ? cleanLine(input.error, 500) : null;
  } else {
    const task = await db.task.findUnique({
      where: { id: input.target_id },
      select: { id: true, title: true, status: true, arc_id: true, assignee_id: true, tags: true, created_at: true, is_deleted: true },
    });
    if (!task || task.is_deleted) throw bad('That task does not exist.', 'task_missing');

    if (input.status === 'proposed') {
      const settings = await getSettings(db);
      const who = input.proposed_assignee_id!;
      if (!settings.handoff_user_ids.includes(who)) throw bad('A task can only be handed to Bast.', 'bad_handoff_target');
      if (task.assignee_id !== ownerId) throw bad('Only a task that is yours can be proposed for a handoff.', 'bad_handoff_task');
      const name = await firstNameOf(db, who);
      if (!name) throw bad('That person is not available.', 'bad_handoff_target');
      summary = `Proposed: hand ${quoted(task.title)} to ${name}.`;
      proposedId = who;
    } else if (input.tool === 'create_task') {
      const age = now.getTime() - task.created_at.getTime();
      if (task.assignee_id !== ownerId || !task.tags.includes('from-chat') || age > CREATE_WINDOW_MINUTES * 60 * 1000 || age < -60 * 1000) {
        throw bad('That is not a task the chat just filed for you.', 'bad_create');
      }
      // The only undo of a filed task: mark it abandoned if it still looks like this.
      after = { status: task.status, assignee_id: ownerId };
      summary = `Filed ${quoted(task.title)}.`;
    } else {
      const a = input.after ?? {};
      const b = input.before ?? {};
      const keys = Object.keys(a) as (keyof TaskFields)[];
      if (keys.length === 0) throw bad('A change needs the new values.', 'bad_action');
      for (const k of keys) {
        if (a[k] !== task[k]) throw bad('The task does not hold those values now.', 'after_mismatch');
        if (!(k in b)) throw bad('A change needs the old value of each field it changed.', 'before_missing');
      }
      for (const k of Object.keys(b)) if (!keys.includes(k as keyof TaskFields)) throw bad('Old values are only accepted for the fields that changed.', 'before_extra');
      if ('assignee_id' in a && a.assignee_id !== ownerId) throw bad('A write can only assign a task to you.', 'bad_assignee');
      before = b;
      after = a;
      summary = await appliedSummary(db, task, b, a, ownerId);
      if (!summary) throw bad('Nothing to record.', 'bad_action');
    }
  }

  const undo_until = input.status === 'applied' ? new Date(now.getTime() + UNDO_WINDOW_HOURS * 3600 * 1000) : null;
  return db.$transaction(async (tx) => {
    const row = await tx.bastChatAction.create({
      data: {
        conversation_id: input.conversation_id,
        event_seq: input.event_seq ?? null,
        tool: input.tool,
        target_type: 'task',
        target_id: input.target_id,
        summary: cleanLine(summary, 300),
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
        proposed_assignee_id: proposedId,
        status: input.status,
        undo_until,
        error,
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

/**
 * Undo an applied write. 409 when it was already undone or resolved, the window has passed, or the task changed since.
 * The stored, validated before values go back to exactly the stored task in one compare and set. An undo never
 * assigns a task to anyone but the owner: undoing a take-back becomes a NEW proposal the owner taps, and it is
 * refused while a later chat action on the task is still applied.
 */
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

    const { assignee_id: backTo, ...direct } = restore;
    const handBack = typeof backTo === 'string' && backTo !== actorId ? backTo : null;
    const data: TaskFields = handBack ? direct : restore;
    if ('assignee_id' in restore) {
      const later = await tx.bastChatAction.findFirst({
        where: { target_id: a.target_id, status: 'applied', id: { not: a.id }, created_at: { gt: a.created_at } },
        select: { id: true },
      });
      if (later) throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
    }
    let handBackName: string | null = null;
    let title: string | null = null;
    if (handBack) {
      const settings = await getSettings(tx);
      handBackName = settings.handoff_user_ids.includes(handBack) ? await firstNameOf(tx, handBack) : null;
      if (!handBackName) throw new ApiError('Open the task to hand it back.', 409, 'handback_unavailable');
    }
    // Compare and set in one statement: the task must still hold exactly the values the chat wrote.
    const where: Prisma.TaskWhereInput = { id: a.target_id, is_deleted: false, ...(after as Prisma.TaskWhereInput) };
    if (Object.keys(data).length > 0) {
      const r = await tx.task.updateMany({ where, data: data as Prisma.TaskUncheckedUpdateManyInput });
      if (r.count !== 1) throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
    } else if ((await tx.task.count({ where })) !== 1) {
      throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
    }
    if (handBack) {
      const t = await tx.task.findUnique({ where: { id: a.target_id }, select: { title: true } });
      title = t?.title ?? null;
      await tx.bastChatAction.create({
        data: {
          conversation_id: a.conversation_id,
          event_seq: a.event_seq,
          tool: 'propose_handoff',
          target_type: 'task',
          target_id: a.target_id,
          summary: cleanLine(`Proposed: hand ${quoted(title)} back to ${handBackName}.`, 300),
          proposed_assignee_id: handBack,
          status: 'proposed',
        },
      });
    }
    const done = await tx.bastChatAction.update({ where: { id: a.id }, data: { status: 'undone', resolved_at: now, resolved_by_id: actorId } });
    return actionView(done, now);
  });
}

/**
 * Carry out a handoff proposal under Mike's session: the task goes to the proposed person, and the action is
 * `released`. 409 when it is not a waiting proposal. The proposal is claimed first (one winner on a double tap).
 * The person must still be a fixed handoff user and the task must still be the owner's, or nothing moves.
 */
export async function releaseAction(actionId: string, actorId: string, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<ActionView> {
  return db.$transaction(async (tx) => {
    const a = await loadOwned(actionId, actorId, tx);
    if (a.status !== 'proposed' || !a.proposed_assignee_id) throw new ApiError('That is not waiting for a decision.', 409, 'not_proposed');
    const settings = await getSettings(tx);
    if (!settings.handoff_user_ids.includes(a.proposed_assignee_id)) throw new ApiError('That person is not available.', 409, 'assignee_unavailable');
    const target = await tx.user.findUnique({ where: { id: a.proposed_assignee_id }, select: { id: true, is_active: true } });
    if (!target || !target.is_active) throw new ApiError('That person is not available.', 409, 'assignee_unavailable');
    const claim = await tx.bastChatAction.updateMany({ where: { id: a.id, status: 'proposed' }, data: { status: 'released', resolved_at: now, resolved_by_id: actorId } });
    if (claim.count !== 1) throw new ApiError('That is not waiting for a decision.', 409, 'not_proposed');
    const moved = await tx.task.updateMany({ where: { id: a.target_id, is_deleted: false, assignee_id: actorId }, data: { assignee_id: a.proposed_assignee_id } });
    if (moved.count !== 1) throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
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
