/**
 * Work stage D: the guard applied to the home screen's own reads. The home loader calls these three, and select.ts drops the same keys
 * again, so no row source can show a second to-do for work that open work already carries.
 *
 *   guardThreads       mail: an ask whose conversation is attached to open work is left out (the thread row goes when none is left)
 *   guardSessionAsks   a session's question to him: left out only when the work is a task of HIS, whose card then lists the question
 *                      (a question for a project, or a task of someone else, has no row of his to appear in, so it stays visible)
 *   guardTrackCards    a Track it card whose conversation was attached to open work meanwhile
 * An urgent ask, a client_blocking or launch_blocking session ask and a security-tagged task's source are never touched (guard.ts).
 *
 * Also: the other sources attached to each of his tasks, for its card.
 */

import type { HomeDb } from '@/lib/home/state';
import { handledElsewhereMany } from './guard';
import { attachedItemLabel } from './attach-copy';
import { emailRefOfAsk, sourceKeyOf } from './keys';
import { workState } from './state';
import { emailSourcesFor } from './tracked';

export interface GuardedAsk {
  id: string;
  conversation_key: string | null;
  rfc_message_id: string | null;
  message_id: string;
}

/** The refs of these asks the guard says are carried elsewhere. */
export async function handledAskIds(db: HomeDb, asks: readonly GuardedAsk[]): Promise<{ ids: Set<string>; sources: number }> {
  if (asks.length === 0) return { ids: new Set(), sources: 0 };
  const refOf = new Map(asks.map((a) => [a.id, emailRefOfAsk(a)]));
  const handled = await handledElsewhereMany(db, [...new Set(refOf.values())].map((ref) => ({ kind: 'email' as const, ref })));
  const ids = new Set<string>();
  const seen = new Set<string>();
  for (const [id, ref] of refOf) {
    if (handled.has(sourceKeyOf('email', ref))) {
      ids.add(id);
      seen.add(ref);
    }
  }
  return { ids, sources: seen.size };
}

export interface SessionAskFacts {
  external_id: string;
  waiting_on: string;
  title: string | null;
  remote_url: string | null;
  asked_at: Date;
  ask_severity: string | null;
}

/** The session asks to leave out, and the question text to list on each owner's task card (by task id). */
export async function guardSessionAsks(db: HomeDb, ownerId: string, asks: readonly SessionAskFacts[]): Promise<{ hidden: Set<string>; onTask: Map<string, { label: string; href: string | null }[]> }> {
  const hidden = new Set<string>();
  const onTask = new Map<string, { label: string; href: string | null }[]>();
  if (asks.length === 0) return { hidden, onTask };
  const handled = await handledElsewhereMany(
    db,
    asks.map((a) => ({ kind: 'session' as const, ref: a.external_id, latest_at: a.asked_at, urgent: a.ask_severity === 'client_blocking' || a.ask_severity === 'launch_blocking' })),
  );
  const taskIds = [...new Set([...handled.values()].filter((h) => h.type === 'task').map((h) => h.id))];
  const mine = taskIds.length ? new Set((await db.task.findMany({ where: { id: { in: taskIds }, assignee_id: ownerId, is_deleted: false }, select: { id: true } })).map((t) => t.id)) : new Set<string>();
  for (const a of asks) {
    const h = handled.get(sourceKeyOf('session', a.external_id));
    if (!h || h.type !== 'task' || !mine.has(h.id) || h.state !== 'open') continue;
    hidden.add(a.external_id);
    const list = onTask.get(h.id) ?? [];
    list.push({ label: `Session asks: ${a.waiting_on.replace(/\s+/g, ' ').trim().slice(0, 200)}`, href: a.remote_url });
    onTask.set(h.id, list);
  }
  return { hidden, onTask };
}

/** The Track it cards whose conversation open work now carries. */
export async function attachedTrackCardIds(db: HomeDb, cards: readonly { id: string; kind: string; plan: Record<string, unknown> }[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const c of cards) {
    if (c.kind !== 'track') continue;
    const thread = typeof c.plan.thread_id === 'string' ? c.plan.thread_id : '';
    if (!thread) continue;
    const sources = await emailSourcesFor(db as never, { thread_id: thread });
    if (sources.length === 0) continue;
    const h = await handledElsewhereMany(db, sources);
    if (h.size > 0) out.add(c.id);
  }
  return out;
}

/** The sources (other than mail the task card already lists) attached to each of his tasks, newest first, at most 4 each, plus one state line. */
export async function loadTaskAttachments(db: HomeDb, taskIds: readonly string[], zone: string, extra: Map<string, { label: string; href: string | null }[]>): Promise<Map<string, { attached: { label: string; href: string | null }[]; work_line: string | null }>> {
  const out = new Map<string, { attached: { label: string; href: string | null }[]; work_line: string | null }>();
  if (taskIds.length === 0) return out;
  const links = await db.workLink.findMany({ where: { task_id: { in: [...taskIds] }, state: 'active' }, orderBy: { last_seen_at: 'desc' }, take: 500 });
  const sessionRefs = links.filter((l) => l.kind === 'session').map((l) => l.ref);
  const sessions = sessionRefs.length ? await db.oracleSession.findMany({ where: { external_id: { in: sessionRefs } }, select: { external_id: true, remote_url: true } }) : [];
  const urlOf = new Map(sessions.map((s) => [s.external_id, s.remote_url]));
  const withLinks = new Set<string>();
  for (const l of links) {
    const tid = l.task_id as string;
    withLinks.add(tid);
    if (l.kind === 'email') continue; // mail is listed from the asks themselves (Stage A)
    const cur = out.get(tid) ?? { attached: [], work_line: null };
    if (cur.attached.length < 4) cur.attached.push({ label: attachedItemLabel(l.kind, l.label, l.last_seen_at, zone), href: l.kind === 'session' ? urlOf.get(l.ref) ?? null : null });
    out.set(tid, cur);
  }
  for (const [tid, lines] of extra) {
    const cur = out.get(tid) ?? { attached: [], work_line: null };
    cur.attached.unshift(...lines);
    out.set(tid, cur);
    withLinks.add(tid);
  }
  // One state line for the tasks that have something attached (at most 25: each reads a few rows).
  for (const tid of [...withLinks].slice(0, 25)) {
    const st = await workState(db, `task:${tid}`, { zone, evidenceLimit: 1 });
    const cur = out.get(tid) ?? { attached: [], work_line: null };
    cur.work_line = st?.line ?? null;
    out.set(tid, cur);
  }
  return out;
}

/** The measures line's number: how many sources the guard keeps off the owner's list right now (open mail conversations and session questions). */
export async function keptOffNow(db: HomeDb): Promise<number> {
  const asks = await db.emailAsk.findMany({ where: { state: 'open', is_urgent: false }, select: { id: true, conversation_key: true, rfc_message_id: true, message_id: true }, take: 2000 });
  const mail = await handledAskIds(db, asks);
  const sessions = await db.oracleSession.findMany({ where: { waiting_on: { not: null }, archived_at: null }, select: { external_id: true, last_event_at: true, ask_severity: true }, take: 500 });
  const handled = sessions.length
    ? await handledElsewhereMany(db, sessions.map((s) => ({ kind: 'session' as const, ref: s.external_id, latest_at: s.last_event_at, urgent: s.ask_severity === 'client_blocking' || s.ask_severity === 'launch_blocking' })))
    : new Map();
  return mail.sources + handled.size;
}
