/**
 * Work stage A: linking the emails behind a task when a lane files the task from mail (POST /api/tasks with
 * source 'email'). Every ask whose message_id is the task's source_ref, or whose rfc_message_id is the optional
 * source_rfc, is linked to the new task, and so are the earlier open asks of the same conversation (the same
 * conversation_key, else the same account and thread). Each open ask goes to handled with closed_reason 'with_task' in
 * the same transaction as the task create.
 *
 * Two kinds of ask are linked but left open: an urgent one (it keeps its emergency path) and any ask of a
 * security-tagged task (never closed by inference). An ask that already belongs to another task is never moved.
 */

import type { HomeDb } from '@/lib/home/state';
import { isSecurityTagged } from './ask-closure';
import { notHeldByMike } from './decision';

/** An RFC Message-ID as stored: lowercased, no brackets, no surrounding space. Null when empty. */
export function normalizeRfc(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().replace(/^<+/, '').replace(/>+$/, '').trim().toLowerCase();
  return s === '' ? null : s;
}

export interface LinkResult {
  linked: string[];
  closed: string[];
  left_open: string[];
}

const EMPTY: LinkResult = { linked: [], closed: [], left_open: [] };

export async function linkAsksForNewTask(
  tx: HomeDb,
  task: { id: string; tags: readonly string[] },
  src: { source_ref?: string | null; source_rfc?: string | null },
  now: Date = new Date(),
): Promise<LinkResult> {
  const ref = (src.source_ref ?? '').trim();
  const rfc = normalizeRfc(src.source_rfc);
  const or: { message_id?: string; rfc_message_id?: string }[] = [];
  if (ref) or.push({ message_id: ref });
  if (rfc) or.push({ rfc_message_id: rfc });
  if (or.length === 0) return EMPTY;

  const matched = await tx.emailAsk.findMany({
    where: { OR: or },
    select: { id: true, task_id: true, account: true, thread_id: true, conversation_key: true, received_at: true },
  });
  if (matched.length === 0) return EMPTY;

  const ids = new Map<string, { openOnly: boolean }>();
  for (const m of matched) if (!m.task_id) ids.set(m.id, { openOnly: false });
  // Earlier open asks of the same conversation that no task has yet.
  for (const m of matched) {
    const conv = m.conversation_key
      ? { conversation_key: m.conversation_key }
      : m.thread_id
        ? { account: m.account, thread_id: m.thread_id }
        : null;
    if (!conv) continue;
    const earlier = await tx.emailAsk.findMany({
      where: { ...conv, task_id: null, state: 'open', received_at: { lte: m.received_at } },
      select: { id: true },
    });
    for (const e of earlier) if (!ids.has(e.id)) ids.set(e.id, { openOnly: true });
  }
  if (ids.size === 0) return EMPTY;

  const hold = isSecurityTagged(task.tags);
  const out: LinkResult = { linked: [], closed: [], left_open: [] };
  for (const id of ids.keys()) {
    const r = await tx.emailAsk.updateMany({ where: { id, task_id: null }, data: { task_id: task.id } });
    if (r.count !== 1) continue;
    out.linked.push(id);
    const close = hold
      ? { count: 0 }
      : await tx.emailAsk.updateMany({
          where: { id, task_id: task.id, state: 'open', is_urgent: false, ...notHeldByMike },
          data: { state: 'handled', closed_at: now, closed_reason: 'with_task', closed_by: 'intake', draft_started_at: null, draft_url: null },
        });
    if (close.count === 1) out.closed.push(id);
    else out.left_open.push(id);
  }
  return out;
}
