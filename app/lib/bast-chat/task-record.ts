import type { Prisma, PrismaClient } from '@prisma/client';
import type { NextResponse } from 'next/server';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { CHAT_LANE } from './task-filter';
import { UNDO_WINDOW_HOURS, TASK_RECORD_FIELDS, appliedSummary, shortTitle, type TaskFields } from './actions';
import { cleanLine } from './card-context';

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
 * immediately after in its own transaction, and the write was already reserved against the daily cap by `guardChatTaskBody`, before the write. A failure to write the record is logged
 * and the response goes out without the header: the change already happened and the route must not fail it.
 */
export const CHAT_ACTION_HEADER = 'X-Bast-Chat-Action';

type TaskShape = {
  id: string; title: string; status: string; arc_id: string | null; assignee_id: string | null;
  due_date?: Date | null; completed_at?: Date | null;
  /** The rest of `TASK_RECORD_FIELDS`, as the database holds them. `blocked_by` is `{id}` rows. */
  [key: string]: unknown;
};
type Db = PrismaClient;

const isChat = (auth: { lane?: string | null }) => auth.lane === CHAT_LANE;

async function ownerOf(db: Db): Promise<string | null> {
  const s = await db.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  return s?.owner_user_id ?? null;
}

async function writeRecord(
  db: Db,
  ownerId: string,
  conversation_id: string | null,
  row: { tool: string; target_id: string; summary: string; before?: TaskFields; after: TaskFields },
  now: Date,
): Promise<string | null> {
  if (!conversation_id) return null; // the column is required; the routes name the conversation before the write
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
    return r.id;
  });
}

const sortedJson = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
};
const sameSet = (a: readonly string[], b: readonly string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const blockerIds = (t: TaskShape): string[] | null =>
  Array.isArray(t.blocked_by) ? (t.blocked_by as { id: string }[]).map((x) => x.id).sort() : null;

/**
 * The value of one record field as the record stores it (plan 1.2 and amendment 14): dates as ISO strings,
 * description and notes as the stored text, `requirements` as stored, `tags` as the full list, `blocked_by_ids`
 * as the full sorted list of blocker ids. Null for a field the task row does not carry.
 */
function valueOf(t: TaskShape, k: (typeof TASK_RECORD_FIELDS)[number]): unknown {
  if (k === 'blocked_by_ids') return blockerIds(t);
  const v = t[k];
  if (v === undefined || v === null) return null;
  if (k === 'due_date') return v instanceof Date ? v.toISOString() : new Date(v as string).toISOString();
  if (k === 'tags') return [...(v as string[])];
  return v;
}

function changed(k: (typeof TASK_RECORD_FIELDS)[number], bv: unknown, av: unknown): boolean {
  if (k === 'tags' || k === 'blocked_by_ids') return !sameSet((bv as string[] | null) ?? [], (av as string[] | null) ?? []);
  if (k === 'requirements') return sortedJson(bv) !== sortedJson(av);
  return bv !== av;
}

/**
 * After a PATCH by the chat lane: one record with exactly the keys that changed, among every field in
 * `TASK_RECORD_FIELDS`, with the true before and after, so Undo can restore any of them. Side effects of the same
 * write (a client filled from the new project, a focus flag a status clears) are real changes and are recorded too.
 * `blocked_by_ids` is recorded only when the caller read the task's blockers into `before` (the chat-lane route does).
 */
export async function recordChatPatch(
  auth: { lane?: string | null },
  before: TaskShape,
  after: TaskShape,
  conversationId: string | null,
  now: Date = new Date(),
  db: Db = defaultDb,
): Promise<string | null> {
  if (!isChat(auth)) return null;
  try {
    const ownerId = await ownerOf(db);
    if (!ownerId) return null;
    const b: Record<string, unknown> = {};
    const a: Record<string, unknown> = {};
    for (const k of TASK_RECORD_FIELDS) {
      if (k === 'blocked_by_ids' && blockerIds(before) === null) continue;
      const bv = valueOf(before, k);
      const av = valueOf(after, k);
      if (changed(k, bv, av)) {
        b[k] = bv;
        a[k] = av;
      }
    }
    if (Object.keys(a).length === 0) return null;
    const bf = b as TaskFields;
    const af = a as TaskFields;
    const summary = await appliedSummary(db, { title: after.title }, bf, af, ownerId, now);
    if (!summary) return null;
    return await writeRecord(db, ownerId, conversationId, { tool: 'change_task', target_id: after.id, summary, before: bf, after: af }, now);
  } catch (e) {
    console.error('bast-chat: could not write the change record', e instanceof Error ? e.message : 'error');
    return null;
  }
}

/** After a POST by the chat lane: one record for the new task (`target_type: 'task'`, `after` holds its status and assignee). */
export async function recordChatCreate(
  auth: { lane?: string | null },
  task: TaskShape,
  conversationId: string | null,
  now: Date = new Date(),
  db: Db = defaultDb,
): Promise<string | null> {
  if (!isChat(auth)) return null;
  try {
    const ownerId = await ownerOf(db);
    if (!ownerId) return null;
    // The chat may file a task for any active person now; the record names whoever it is on.
    let summary = `Filed "${shortTitle(task.title)}".`;
    if (task.assignee_id && task.assignee_id !== ownerId) {
      const u = await db.user.findUnique({ where: { id: task.assignee_id }, select: { name: true } });
      const first = (u?.name ?? '').trim().split(/\s+/)[0];
      if (first) summary = `Filed "${shortTitle(task.title)}" for ${cleanLine(first, 40)}.`;
    }
    return await writeRecord(
      db,
      ownerId,
      conversationId,
      { tool: 'create_task', target_id: task.id, summary, after: { status: task.status as TaskFields['status'], assignee_id: task.assignee_id } },
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
