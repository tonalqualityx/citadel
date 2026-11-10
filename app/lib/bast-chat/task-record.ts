import type { Prisma, PrismaClient } from '@prisma/client';
import type { NextResponse } from 'next/server';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { CHAT_LANE } from './task-filter';
import { UNDO_WINDOW_HOURS, TASK_FIELDS, appliedSummary, shortTitle, type TaskFields } from './actions';
import { cleanLine } from './card-context';
import { bumpUsage } from './usage';

/**
 * Bast chat: the server writes the record of every change the chat key makes.
 *
 * The two task routes call `recordChatPatch` / `recordChatCreate` right after a successful write, only when the
 * caller's lane is `bast-chat`. The record carries the real before and after (the task as it was and as it is),
 * the line is composed here, and the id goes back to the chat in the `X-Bast-Chat-Action` header. The worker
 * cannot post such a record (POST /worker/actions takes proposals only), so Undo can only reverse a change that
 * really happened. Any other caller: nothing runs, nothing is read, no header.
 *
 * The task routes write with a plain `prisma.task.update`/`create` (no transaction), so the record is written
 * immediately after, with today's write count, in its own transaction. A failure to write the record is logged
 * and the response goes out without the header: the change already happened and the route must not fail it.
 */
export const CHAT_ACTION_HEADER = 'X-Bast-Chat-Action';

type TaskShape = { id: string; title: string; status: string; arc_id: string | null; assignee_id: string | null };
type Db = PrismaClient;

const isChat = (auth: { lane?: string | null }) => auth.lane === CHAT_LANE;

/** The conversation a record belongs to: the owner's open one, else their newest (the column is required). */
async function conversationFor(ownerId: string, db: Db): Promise<string | null> {
  const open = await db.bastChatConversation.findFirst({
    where: { owner_id: ownerId, status: { not: 'closed' } },
    orderBy: { created_at: 'desc' },
    select: { id: true },
  });
  if (open) return open.id;
  const newest = await db.bastChatConversation.findFirst({ where: { owner_id: ownerId }, orderBy: { created_at: 'desc' }, select: { id: true } });
  return newest?.id ?? null;
}

async function ownerOf(db: Db): Promise<string | null> {
  const s = await db.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  return s?.owner_user_id ?? null;
}

async function writeRecord(
  db: Db,
  ownerId: string,
  row: { tool: string; target_id: string; summary: string; before?: TaskFields; after: TaskFields },
  now: Date,
): Promise<string | null> {
  const conversation_id = await conversationFor(ownerId, db);
  if (!conversation_id) return null; // no conversation exists at all: the column is required, so nothing can be written
  return db.$transaction(async (tx) => {
    const r = await tx.bastChatAction.create({
      data: {
        conversation_id,
        tool: row.tool,
        target_type: 'task',
        target_id: row.target_id,
        summary: cleanLine(row.summary, 300),
        before: (row.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: row.after as Prisma.InputJsonValue,
        status: 'applied',
        undo_until: new Date(now.getTime() + UNDO_WINDOW_HOURS * 3600 * 1000),
      },
      select: { id: true },
    });
    await bumpUsage(ownerId, { writes: 1 }, now, tx);
    return r.id;
  });
}

/** After a PATCH by the chat lane: one record for exactly the fields that changed among status, title, arc and assignee. */
export async function recordChatPatch(
  auth: { lane?: string | null },
  before: TaskShape,
  after: TaskShape,
  now: Date = new Date(),
  db: Db = defaultDb,
): Promise<string | null> {
  if (!isChat(auth)) return null;
  try {
    const b: Record<string, unknown> = {};
    const a: Record<string, unknown> = {};
    for (const k of TASK_FIELDS) {
      if (before[k] !== after[k]) {
        b[k] = before[k] ?? null;
        a[k] = after[k] ?? null;
      }
    }
    if (Object.keys(a).length === 0) return null;
    const ownerId = await ownerOf(db);
    if (!ownerId) return null;
    const bf = b as TaskFields;
    const af = a as TaskFields;
    const summary = await appliedSummary(db, { title: after.title }, bf, af, ownerId);
    if (!summary) return null;
    const onlyArc = Object.keys(af).length === 1 && 'arc_id' in af;
    const tool = onlyArc ? (af.arc_id ? 'add_to_arc' : 'remove_from_arc') : 'update_task';
    return await writeRecord(db, ownerId, { tool, target_id: after.id, summary, before: bf, after: af }, now);
  } catch (e) {
    console.error('bast-chat: could not write the change record', e instanceof Error ? e.message : 'error');
    return null;
  }
}

/** After a POST by the chat lane: one record for the new task. */
export async function recordChatCreate(
  auth: { lane?: string | null },
  task: TaskShape,
  now: Date = new Date(),
  db: Db = defaultDb,
): Promise<string | null> {
  if (!isChat(auth)) return null;
  try {
    const ownerId = await ownerOf(db);
    if (!ownerId || task.assignee_id !== ownerId) return null;
    return await writeRecord(
      db,
      ownerId,
      { tool: 'create_task', target_id: task.id, summary: `Filed "${shortTitle(task.title)}".`, after: { status: task.status as TaskFields['status'], assignee_id: ownerId } },
      now,
    );
  } catch (e) {
    console.error('bast-chat: could not write the change record', e instanceof Error ? e.message : 'error');
    return null;
  }
}

/** Put the new record's id on the response, when there is one. Returns the same response object. */
export function withChatAction<T extends NextResponse>(res: T, actionId: string | null): T {
  if (actionId) res.headers.set(CHAT_ACTION_HEADER, actionId);
  return res;
}
