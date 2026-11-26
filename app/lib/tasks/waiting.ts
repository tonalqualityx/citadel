/**
 * Waiting on someone (task 23cd54cf). Mike, 2026-11-26: "And yes, this needs to be marked waiting on someone and we need
 * to ensure that the Followup process works in a way that once Dan responds it unlocks my next steps."
 *
 * A card can be marked waiting on a named person (a client contact, a staff user, or a free-text name) with a follow-up
 * date. While the mark is set and the follow-up time has not passed, the card leaves Mike's waiting lists (the
 * waiting-on-me feed here, and the front session's "ready for you" list, which reads `waiting_on.active`). When the
 * person answers, whoever handles the answer closes the card or clears the mark; when the follow-up time passes, the card
 * comes back and the machine's follow-up job (~/.claude/tools/inbound/waiting_follow_up.py) sends one short ask on the
 * person's thread and stamps waiting_follow_up_sent_at.
 *
 * Fields on tasks: waiting_on_name (always set while marked: who, in words), waiting_on_contact_id or
 * waiting_on_user_id (at most one), waiting_since (PRESENCE is the mark), waiting_follow_up_at, waiting_thread
 * ("<account>:<gmail thread id>"), waiting_note (what we are waiting for, in words that fit "following up on ..."),
 * waiting_follow_up_sent_at.
 */
import { Prisma, TaskStatus, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';
import { zonedTimeToUtc } from '@/lib/waits/business-days';
import { formatWaiting, isActivelyWaiting, type WaitingFields } from '@/lib/tasks/waiting-format';

export { formatWaiting, isActivelyWaiting };

type Db = Pick<PrismaClient, 'task' | 'clientContact' | 'user'>;

const CLOSED: string[] = [TaskStatus.done, TaskStatus.abandoned];
const THREAD_RE = /^[^\s:@]+@[^\s:@]+\.[^\s:@]+:[A-Za-z0-9_-]{6,120}$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A follow-up given as a bare date means "once that day is over" in Indelible's zone (Eastern): "follow-up Dec 4" keeps
 * the card off Mike's list through Dec 4. A full ISO time is taken as given.
 */
export function parseFollowUp(value: string): Date {
  const m = DATE_ONLY_RE.exec(value.trim());
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new ApiError('follow_up_at is not a real date', 400, 'bad_follow_up');
    return zonedTimeToUtc(y, mo, d + 1, 0, 0);
  }
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) throw new ApiError('follow_up_at must be a date (YYYY-MM-DD) or an ISO time', 400, 'bad_follow_up');
  return t;
}

const followUpField = z.union([z.string().trim().min(1).max(40), z.null()]).optional();

export const setWaitingSchema = z
  .object({
    contact_id: z.string().uuid().optional().nullable(),
    user_id: z.string().uuid().optional().nullable(),
    name: z.string().trim().min(1).max(200).optional().nullable(),
    follow_up_at: followUpField,
    thread: z.string().trim().regex(THREAD_RE, 'thread is "<account>:<gmail thread id>"').optional().nullable(),
    note: z.string().trim().min(1).max(500).optional().nullable(),
  })
  .refine((b) => !(b.contact_id && b.user_id), { message: 'Name a contact or a user, not both' })
  .refine((b) => Boolean(b.contact_id || b.user_id || b.name), { message: 'Say who the card waits on: contact_id, user_id or name' });

export const patchWaitingSchema = z
  .object({
    follow_up_at: followUpField,
    thread: z.string().trim().regex(THREAD_RE, 'thread is "<account>:<gmail thread id>"').optional().nullable(),
    note: z.string().trim().min(1).max(500).optional().nullable(),
    follow_up_sent_at: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to change' });

export type SetWaitingInput = z.infer<typeof setWaitingSchema>;
export type PatchWaitingInput = z.infer<typeof patchWaitingSchema>;

/**
 * Prisma filter for the cards that belong on Mike's lists: not marked, or marked with the follow-up time reached.
 * Put it under AND, so it never collides with a caller's own OR.
 */
export function notActivelyWaitingWhere(now: Date = new Date()): Prisma.TaskWhereInput {
  return { OR: [{ waiting_since: null }, { waiting_follow_up_at: { lte: now } }] };
}

export const WAITING_SCALARS = {
  waiting_on_name: true,
  waiting_on_contact_id: true,
  waiting_on_user_id: true,
  waiting_since: true,
  waiting_follow_up_at: true,
  waiting_thread: true,
  waiting_note: true,
  waiting_follow_up_sent_at: true,
} as const;

async function loadOpenTask(db: Db, taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, status: true, is_deleted: true, ...WAITING_SCALARS },
  });
  if (!task || task.is_deleted) throw new ApiError('Task not found', 404);
  if (CLOSED.includes(task.status)) throw new ApiError('This task is done or abandoned, so it is not waiting on anyone.', 409, 'closed');
  return task;
}

function changes(before: WaitingFields, after: WaitingFields) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(WAITING_SCALARS) as (keyof WaitingFields)[]) {
    const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k] ?? null;
    const b = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k] ?? null;
    if (a !== b) out[k] = { from: a, to: b };
  }
  return out;
}

/** Mark the card waiting on someone. Re-marking the same person keeps the original waiting_since. */
export async function setWaiting(actorId: string, taskId: string, input: SetWaitingInput, db: Db = defaultDb, now: Date = new Date()) {
  const task = await loadOpenTask(db, taskId);
  let name = input.name ?? null;
  if (input.contact_id) {
    const c = await db.clientContact.findUnique({ where: { id: input.contact_id }, select: { name: true, email: true } });
    if (!c) throw new ApiError('Contact not found', 404, 'contact_not_found');
    name = name ?? c.name ?? c.email;
  } else if (input.user_id) {
    const u = await db.user.findUnique({ where: { id: input.user_id }, select: { name: true } });
    if (!u) throw new ApiError('User not found', 404, 'user_not_found');
    name = name ?? u.name;
  }
  const followUp = input.follow_up_at ? parseFollowUp(input.follow_up_at) : null;
  const samePerson =
    Boolean(task.waiting_since) &&
    (task.waiting_on_contact_id ?? null) === (input.contact_id ?? null) &&
    (task.waiting_on_user_id ?? null) === (input.user_id ?? null) &&
    (input.contact_id || input.user_id ? true : task.waiting_on_name === name);
  const keepSent =
    samePerson && task.waiting_follow_up_at?.getTime() === followUp?.getTime() ? task.waiting_follow_up_sent_at : null;
  const data = {
    waiting_on_name: name,
    waiting_on_contact_id: input.contact_id ?? null,
    waiting_on_user_id: input.user_id ?? null,
    waiting_since: samePerson ? task.waiting_since : now,
    waiting_follow_up_at: followUp,
    waiting_thread: input.thread ?? null,
    waiting_note: input.note ?? null,
    waiting_follow_up_sent_at: keepSent ?? null,
  };
  const updated = await db.task.update({ where: { id: taskId }, data, select: { id: true, status: true, ...WAITING_SCALARS } });
  await logUpdate(actorId, 'task', taskId, task.title, changes(task, updated));
  return updated;
}

/** Change the follow-up date, thread or note, or record that the follow-up went out. The card must already be marked. */
export async function patchWaiting(actorId: string, taskId: string, input: PatchWaitingInput, db: Db = defaultDb) {
  const task = await loadOpenTask(db, taskId);
  if (!task.waiting_since) throw new ApiError('This task is not marked waiting on anyone.', 409, 'not_waiting');
  const data: Prisma.TaskUpdateInput = {};
  if (input.follow_up_at !== undefined) {
    const next = input.follow_up_at ? parseFollowUp(input.follow_up_at) : null;
    data.waiting_follow_up_at = next;
    // A new date is a new follow-up: the one already sent was for the old date.
    if (next?.getTime() !== task.waiting_follow_up_at?.getTime()) data.waiting_follow_up_sent_at = null;
  }
  if (input.thread !== undefined) data.waiting_thread = input.thread;
  if (input.note !== undefined) data.waiting_note = input.note;
  if (input.follow_up_sent_at !== undefined) {
    data.waiting_follow_up_sent_at = input.follow_up_sent_at ? new Date(input.follow_up_sent_at) : null;
  }
  const updated = await db.task.update({ where: { id: taskId }, data, select: { id: true, status: true, ...WAITING_SCALARS } });
  await logUpdate(actorId, 'task', taskId, task.title, changes(task, updated));
  return updated;
}

/** Take the mark off (the person answered, or it was set by mistake). Clearing an unmarked card is a no-op. */
export async function clearWaiting(actorId: string, taskId: string, db: Db = defaultDb) {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, title: true, status: true, is_deleted: true, ...WAITING_SCALARS } });
  if (!task || task.is_deleted) throw new ApiError('Task not found', 404);
  if (!task.waiting_since) return task;
  const data = Object.fromEntries(Object.keys(WAITING_SCALARS).map((k) => [k, null])) as Prisma.TaskUpdateInput;
  const updated = await db.task.update({ where: { id: taskId }, data, select: { id: true, status: true, ...WAITING_SCALARS } });
  await logUpdate(actorId, 'task', taskId, task.title, changes(task, updated));
  return updated;
}

/**
 * Open cards that carry a mark, soonest follow-up first (no date last). `due` keeps only those whose follow-up time has
 * passed and whose follow-up has not been sent yet: the follow-up job's list.
 */
export async function listWaiting(opts: { due?: boolean; limit?: number; now?: Date } = {}, db: Pick<PrismaClient, 'task'> = defaultDb) {
  const now = opts.now ?? new Date();
  const where: Prisma.TaskWhereInput = {
    is_deleted: false,
    status: { notIn: CLOSED as TaskStatus[] },
    waiting_since: { not: null },
    ...(opts.due ? { waiting_follow_up_at: { lte: now }, waiting_follow_up_sent_at: null } : {}),
  };
  const rows = await db.task.findMany({
    where,
    orderBy: [{ waiting_follow_up_at: { sort: 'asc', nulls: 'last' } }, { waiting_since: 'asc' }],
    take: Math.min(Math.max(opts.limit ?? 200, 1), 500),
    select: {
      id: true,
      title: true,
      status: true,
      assignee_id: true,
      project_id: true,
      tags: true,
      project: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      waiting_on_contact: { select: { id: true, name: true, email: true } },
      waiting_on_user: { select: { id: true, name: true, email: true } },
      ...WAITING_SCALARS,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    assignee_id: r.assignee_id,
    tags: r.tags ?? [],
    project: r.project,
    client: r.client,
    contact: r.waiting_on_contact,
    user: r.waiting_on_user,
    waiting_on: formatWaiting(r, now),
  }));
}
