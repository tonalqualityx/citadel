/**
 * Bast chat: the record of what the chat changed, for the action line, undo, and handoff proposals.
 *
 * - `recordAction` (worker): a handoff proposal, and nothing else. Every record of a change (what the chat key
 *   changed on a task) is written by the server itself at the moment of the change (`task-record.ts`), from the
 *   real before and after, so the worker never reports a change and cannot invent one.
 * - `undoAction` (Mike's route): puts the recorded `before` back, only if the task still equals the recorded
 *   `after` ("Changed since. Open the task." otherwise). A task the chat created is undone by marking it
 *   abandoned; nothing is deleted.
 * - `releaseAction` and `declineAction` (Mike's route): a handoff proposal becomes a real reassignment only here,
 *   under Mike's own id. The worker route has no way to release; `recordAction` can only store `proposed`.
 *
 * The server is the only author of what a tap does and says. `recordAction` checks the proposal against the real
 * task read from the database at that moment and writes the summary line itself. The worker's own summary text is
 * ignored and never stored or shown.
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

const CHAT_TAG = 'from-chat';

export const UNDO_WINDOW_HOURS = 24;
export const CHANGED_SINCE_TEXT = 'Changed since. Open the task.';
export const TASK_FIELDS = ['status', 'title', 'arc_id', 'assignee_id'] as const;
/** Recorded only beside a change to one of TASK_FIELDS, so Undo can put back what the same PATCH cleared. */
export const RESTORE_EXTRA_FIELDS = ['due_date', 'completed_at'] as const;
export const ACTION_TOOLS = ['create_task', 'update_task', 'add_to_arc', 'remove_from_arc', 'propose_handoff'] as const;
const TASK_STATUSES = ['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'] as const;

const fieldsSchema = z
  .object({
    status: z.enum(TASK_STATUSES),
    title: z.string().min(1).max(500),
    arc_id: z.string().uuid().nullable(),
    assignee_id: z.string().uuid().nullable(),
    due_date: z.string().datetime().nullable(),
    completed_at: z.string().datetime().nullable(),
  })
  .partial()
  .strict();
export type TaskFields = z.infer<typeof fieldsSchema>;

/**
 * The body of POST /worker/actions. Strict: an unknown key is a 400. The worker may only PROPOSE a handoff; the
 * other tools and statuses are still named here so a record of a change gets a plain refusal, not a schema error.
 * `summary`, `before`, `after` and `error` are accepted and ignored (never stored).
 */
export const recordActionSchema = z
  .object({
    conversation_id: z.string().uuid(),
    event_seq: z.number().int().positive().optional(),
    tool: z.enum(ACTION_TOOLS),
    target_id: z.string().uuid(),
    summary: z.string().max(600).optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    proposed_assignee_id: z.string().uuid().optional(),
    status: z.enum(['applied', 'proposed', 'failed']).default('proposed'),
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

const STATUS_WORDS: Record<string, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  review: 'review',
  done: 'done',
  blocked: 'blocked',
  abandoned: 'abandoned',
};
const bad = (message: string, code = 'bad_action') => new ApiError(message, 400, code);
/** A title for a line: cut at a word boundary with three full stops when over 60 characters. */
export function shortTitle(title: string | null | undefined, max = 60): string {
  const t = cleanLine(title ?? 'Untitled', 500);
  if (t.length <= max) return t;
  const room = t.slice(0, max - 3);
  const sp = room.lastIndexOf(' ');
  return `${(sp >= 15 ? room.slice(0, sp) : room).replace(/[\s.,;:]+$/, '')}...`;
}
const quoted = (title: string | null | undefined) => `"${shortTitle(title)}"`;

async function firstNameOf(db: Pick<Prisma.TransactionClient, 'user'>, id: string | null): Promise<string | null> {
  if (!id) return null;
  const u = await db.user.findUnique({ where: { id }, select: { name: true, is_active: true } });
  if (!u) return null;
  return cleanLine(u.name.split(/\s+/)[0] ?? '', 40) || null;
}

/** The line for an applied write, built only from validated values and the real task. */
export async function appliedSummary(
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
 * Record a handoff proposal from the worker. The only thing the worker can record:
 * - the task must be the owner's right now and the person one of the fixed handoff users;
 * - the summary is written here; nothing the worker says about before, after or the summary is stored.
 * Applied, filed and failed records are refused with a 400: the server writes those itself (`task-record.ts`).
 */
export const WORKER_RECORD_REFUSED = 'The chat can only propose a handoff. Citadel records every change itself.';

export async function recordAction(
  raw: unknown,
  ownerId: string,
  now: Date = new Date(),
  db: PrismaClient = defaultDb,
): Promise<{ id: string; status: string; undo_until: Date | null }> {
  void now;
  const input = recordActionSchema.parse(raw);
  if (input.status !== 'proposed' || input.tool !== 'propose_handoff') throw bad(WORKER_RECORD_REFUSED, 'record_refused');
  if (!input.proposed_assignee_id) throw bad('A proposal needs someone to hand it to', 'bad_proposal');
  const conv = await db.bastChatConversation.findUnique({ where: { id: input.conversation_id }, select: { owner_id: true } });
  if (!conv || conv.owner_id !== ownerId) throw new ApiError('Chat not found', 404, 'not_found');

  const task = await db.task.findUnique({
    where: { id: input.target_id },
    select: { id: true, title: true, status: true, assignee_id: true, is_deleted: true, updated_at: true },
  });
  if (!task || task.is_deleted) throw bad('That task does not exist.', 'task_missing');
  const settings = await getSettings(db);
  const who = input.proposed_assignee_id;
  if (!settings.handoff_user_ids.includes(who)) throw bad('A task can only be handed to Bast.', 'bad_handoff_target');
  if (task.assignee_id !== ownerId) throw bad('Only a task that is yours can be proposed for a handoff.', 'bad_handoff_task');
  const name = await firstNameOf(db, who);
  if (!name) throw bad('That person is not available.', 'bad_handoff_target');

  // A proposal is one write on the daily cap, refused past it.
  await assertWriteAllowed(ownerId, settings, now, db);
  return db.$transaction(async (tx) => {
    const r = await tx.bastChatAction.create({
      data: {
        conversation_id: input.conversation_id,
        event_seq: input.event_seq ?? null,
        tool: 'propose_handoff',
        target_type: 'task',
        target_id: input.target_id,
        summary: handoffLine(task, `to ${name}`),
        before: handoffBefore(task),
        after: handoffAfter(task),
        proposed_assignee_id: who,
        status: 'proposed',
        undo_until: null,
      },
      select: { id: true, status: true, undo_until: true },
    });
    await bumpUsage(ownerId, { writes: 1 }, now, tx);
    return r;
  });
}

type TaskPicture = { title: string; status: string; updated_at: Date };
/** What the task was when the proposal was made: a tap goes through only if it still is exactly this. */
const handoffBefore = (t: TaskPicture) => ({ updated_at: t.updated_at.toISOString() }) as Prisma.InputJsonValue;
const handoffAfter = (t: TaskPicture) => ({ status: t.status, title: t.title }) as Prisma.InputJsonValue;
function handoffLine(t: TaskPicture, toWhom: string): string {
  const state = STATUS_WORDS[t.status] ?? 'in its current status';
  const tail = t.status === 'not_started' ? ', so Bast starts on it' : '';
  return cleanLine(`Proposed: hand ${quoted(t.title)} ${toWhom}. It is ${state}${tail}.`, 300);
}
function readPicture(a: BastChatAction): { status: string; title: string; updated_at: Date } | null {
  const af = a.after as { status?: unknown; title?: unknown } | null;
  const bf = a.before as { updated_at?: unknown } | null;
  if (!af || !bf || typeof af.status !== 'string' || typeof af.title !== 'string' || typeof bf.updated_at !== 'string') return null;
  const at = new Date(bf.updated_at);
  return Number.isNaN(at.getTime()) ? null : { status: af.status, title: af.title, updated_at: at };
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
    const takeBack = 'assignee_id' in restore;
    if (takeBack) {
      const later = await tx.bastChatAction.findFirst({
        where: { target_id: a.target_id, status: 'applied', id: { not: a.id }, created_at: { gt: a.created_at } },
        select: { id: true },
      });
      if (later) throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
    }
    // A take-back is never undone by writing the assignee: it becomes a proposal the owner taps, and only when
    // the previous assignee is a fixed handoff person.
    let handBack: string | null = null;
    let handBackName: string | null = null;
    if (takeBack) {
      const settings = await getSettings(tx);
      handBack = typeof backTo === 'string' && backTo !== actorId && settings.handoff_user_ids.includes(backTo) ? backTo : null;
      handBackName = handBack ? await firstNameOf(tx, handBack) : null;
      if (!handBack || !handBackName) throw new ApiError('Open the task to hand it back.', 409, 'handback_unavailable');
    }
    const data: TaskFields = takeBack ? direct : restore;
    // Compare and set in one statement: the task must still hold exactly the values the chat wrote, and must
    // still be the owner's (an undo never writes a task that has left them). A filed task also still carries from-chat.
    const where: Prisma.TaskWhereInput = {
      id: a.target_id,
      is_deleted: false,
      ...(after as Prisma.TaskWhereInput),
      assignee_id: actorId,
      ...(a.tool === 'create_task' ? { tags: { has: CHAT_TAG } } : {}),
    };
    if (Object.keys(data).length > 0) {
      const r = await tx.task.updateMany({ where, data: data as Prisma.TaskUncheckedUpdateManyInput });
      if (r.count !== 1) throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
    } else if ((await tx.task.count({ where })) !== 1) {
      throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
    }
    if (handBack) {
      const t = await tx.task.findUnique({ where: { id: a.target_id }, select: { title: true, status: true, updated_at: true } });
      if (!t) throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
      await tx.bastChatAction.create({
        data: {
          conversation_id: a.conversation_id,
          event_seq: a.event_seq,
          tool: 'propose_handoff',
          target_type: 'task',
          target_id: a.target_id,
          summary: handoffLine(t, `back to ${handBackName}`),
          before: handoffBefore(t),
          after: handoffAfter(t),
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
  const out = await db.$transaction(async (tx) => {
    const a = await loadOwned(actionId, actorId, tx);
    if (a.status !== 'proposed' || !a.proposed_assignee_id) throw new ApiError('That is not waiting for a decision.', 409, 'not_proposed');
    const settings = await getSettings(tx);
    if (!settings.handoff_user_ids.includes(a.proposed_assignee_id)) throw new ApiError('That person is not available.', 409, 'assignee_unavailable');
    const target = await tx.user.findUnique({ where: { id: a.proposed_assignee_id }, select: { id: true, is_active: true } });
    if (!target || !target.is_active) throw new ApiError('That person is not available.', 409, 'assignee_unavailable');
    const claim = await tx.bastChatAction.updateMany({ where: { id: a.id, status: 'proposed' }, data: { status: 'released', resolved_at: now, resolved_by_id: actorId } });
    if (claim.count !== 1) throw new ApiError('That is not waiting for a decision.', 409, 'not_proposed');
    // One compare and set: the task must still be the owner's and exactly as it was when proposed.
    const pic = readPicture(a);
    const moved = pic
      ? await tx.task.updateMany({
          where: { id: a.target_id, is_deleted: false, assignee_id: actorId, status: pic.status as Prisma.TaskWhereInput['status'], title: pic.title, updated_at: pic.updated_at },
          data: { assignee_id: a.proposed_assignee_id },
        })
      : { count: 0 };
    if (moved.count !== 1) {
      // Dead for good: the proposal cannot be tapped again (it is kept, marked failed, and the task is untouched).
      await tx.bastChatAction.update({ where: { id: a.id }, data: { status: 'failed', resolved_at: now, resolved_by_id: actorId } });
      return null;
    }
    const row = await tx.bastChatAction.findUniqueOrThrow({ where: { id: a.id } });
    return actionView(row, now);
  });
  if (!out) throw new ApiError(CHANGED_SINCE_TEXT, 409, 'changed_since');
  return out;
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
