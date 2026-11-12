/**
 * Work stage D: the one guard, handledElsewhere. It stops an email, a session question or a card from becoming a second to-do while
 * something attached to the same work is already handling it.
 *
 * A source is handled elsewhere when it is attached (an active work_link, or for mail the task an ask already points at) to
 *   - an open task (not_started, in_progress, review, blocked),
 *   - a live project (ready, in_progress, review),
 *   - a DONE task or project whose completion came after the source's latest activity (the work finished covering all of it).
 * An abandoned task, a cancelled project, a project on quote, queue or suspended, and a done one with newer activity after it do NOT
 * handle the source: it needs a new decision.
 *
 * Never hidden by the guard: an urgent source (mail with an open urgent ask, a session asking client_blocking or launch_blocking),
 * and any source whose work is a security-tagged task. They keep their own path.
 *
 * Callers (guard.test.ts enumerates them and fails on a task-create path that does not call checkTracked or is not named exempt):
 * home load and select (thread rows, session waiting-on cards, proposal cards), POST /api/tasks, POST /api/session-tasks,
 * POST /api/email-asks/:id/create-task, the chat's start_project, Track it (reconcile/track.ts and its card source), the attach
 * answers. A create path that finds an attachment answers 200 {already_tracked: true, ...} and creates nothing. An explicit owner
 * override (`create_anyway`, honoured only for the owner's own screen and the chat that speaks for him) skips the check.
 */

import { hasSecurityTag } from '@/lib/home/rules';
import type { HomeDb } from '@/lib/home/state';
import { displayText } from '@/lib/home/copy';
import { LIVE_PROJECT_STATUSES, emailAskWhere } from './links';
import { evidenceLine, recordEvidence } from './evidence';
import { parseTargetKey, sourceKeyOf, targetKeyOf, type WorkKind } from './keys';
import { workHref } from './state';

export interface SourceRef {
  kind: WorkKind;
  ref: string;
  /** The source's latest activity (a done target only handles it when it finished after this). Mail: read from its asks when absent. */
  latest_at?: Date | null;
  /** The caller already knows this source is urgent (a session asking client_blocking or launch_blocking). */
  urgent?: boolean;
}

export interface Handled {
  source_key: string;
  target_key: string;
  type: 'project' | 'task';
  id: string;
  name: string;
  href: string;
  /** open: the work is open; done: it finished after the source's latest activity. */
  state: 'open' | 'done';
  link_id: string | null;
  /** link: an active work_link; ask_task: Stage A's task_id on an email ask. */
  via: 'link' | 'ask_task';
}

const OPEN_TASK = ['not_started', 'in_progress', 'review', 'blocked'];

interface TaskRow { id: string; title: string; status: string; is_deleted: boolean; completed_at: Date | null; updated_at: Date; tags: string[] }
interface ProjectRow { id: string; name: string; status: string; is_deleted: boolean; completed_date: Date | null; updated_at: Date }

interface Cand { target_key: string; type: 'project' | 'task'; id: string; link_id: string | null; via: 'link' | 'ask_task'; seen: number }

/** Pure: does this target handle a source whose latest activity was `latest`? */
export function targetHandles(t: { type: 'task'; row: TaskRow } | { type: 'project'; row: ProjectRow }, latest: Date | null): 'open' | 'done' | 'security' | null {
  if (t.type === 'task') {
    const r = t.row;
    if (r.is_deleted) return null;
    if (hasSecurityTag(r.tags)) return 'security';
    if ((OPEN_TASK as string[]).includes(r.status)) return 'open';
    if (r.status === 'done') return !latest || (r.completed_at ?? r.updated_at).getTime() > latest.getTime() ? 'done' : null;
    return null; // abandoned
  }
  const r = t.row;
  if (r.is_deleted) return null;
  if ((LIVE_PROJECT_STATUSES as readonly string[]).includes(r.status)) return 'open';
  if (r.status === 'done') return !latest || (r.completed_date ?? r.updated_at).getTime() > latest.getTime() ? 'done' : null;
  return null; // quote, queue, suspended, cancelled
}

/** Which of these sources are handled elsewhere, by source key (`kind:ref`). A source with no entry is not handled. */
export async function handledElsewhereMany(db: HomeDb, sources: readonly SourceRef[]): Promise<Map<string, Handled>> {
  const out = new Map<string, Handled>();
  if (sources.length === 0) return out;
  const uniq = new Map(sources.map((s) => [sourceKeyOf(s.kind, s.ref), s]));
  const list = [...uniq.values()];

  const links = await db.workLink.findMany({
    where: { state: 'active', OR: list.map((s) => ({ kind: s.kind, ref: s.ref })) },
    select: { id: true, kind: true, ref: true, target_key: true, last_seen_at: true },
  });

  // Mail: the conversation's asks give the newest activity, an urgent flag, and the legacy task_id.
  const emailRefs = list.filter((s) => s.kind === 'email').map((s) => s.ref);
  const asks = emailRefs.length
    ? await db.emailAsk.findMany({
        where: { OR: emailRefs.map((r) => emailAskWhere(r)) },
        select: { conversation_key: true, rfc_message_id: true, message_id: true, received_at: true, is_urgent: true, state: true, task_id: true },
      })
    : [];
  const byRef = new Map<string, { latest: Date | null; urgent: boolean; tasks: string[] }>();
  for (const r of emailRefs) byRef.set(r, { latest: null, urgent: false, tasks: [] });
  for (const a of asks) {
    for (const k of new Set([a.conversation_key, a.rfc_message_id, a.message_id])) {
      const e = k ? byRef.get(k) : undefined;
      if (!e) continue;
      if (!e.latest || a.received_at > e.latest) e.latest = a.received_at;
      if (a.is_urgent && a.state === 'open') e.urgent = true;
      if (a.task_id && !e.tasks.includes(a.task_id)) e.tasks.push(a.task_id);
    }
  }

  const cands = new Map<string, Cand[]>();
  const add = (sk: string, c: Cand) => {
    const l = cands.get(sk) ?? [];
    if (!l.some((x) => x.target_key === c.target_key)) l.push(c);
    cands.set(sk, l);
  };
  for (const l of links) {
    const p = parseTargetKey(l.target_key);
    if (p) add(sourceKeyOf(l.kind as WorkKind, l.ref), { target_key: targetKeyOf(p.type, p.id), type: p.type, id: p.id, link_id: l.id, via: 'link', seen: l.last_seen_at.getTime() });
  }
  for (const s of list) {
    if (s.kind !== 'email') continue;
    for (const t of byRef.get(s.ref)?.tasks ?? []) add(sourceKeyOf('email', s.ref), { target_key: targetKeyOf('task', t), type: 'task', id: t, link_id: null, via: 'ask_task', seen: 0 });
  }

  const taskIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const l of cands.values()) for (const c of l) (c.type === 'task' ? taskIds : projectIds).add(c.id);
  const [tasks, projects] = await Promise.all([
    taskIds.size ? db.task.findMany({ where: { id: { in: [...taskIds] } }, select: { id: true, title: true, status: true, is_deleted: true, completed_at: true, updated_at: true, tags: true } }) : Promise.resolve([] as TaskRow[]),
    projectIds.size ? db.project.findMany({ where: { id: { in: [...projectIds] } }, select: { id: true, name: true, status: true, is_deleted: true, completed_date: true, updated_at: true } }) : Promise.resolve([] as ProjectRow[]),
  ]);
  const taskById = new Map(tasks.map((t) => [t.id, t as TaskRow]));
  const projectById = new Map(projects.map((p) => [p.id, p as ProjectRow]));

  for (const s of list) {
    const sk = sourceKeyOf(s.kind, s.ref);
    const mail = s.kind === 'email' ? byRef.get(s.ref) : undefined;
    if (s.urgent || mail?.urgent) continue; // urgent: never hidden
    const cl = cands.get(sk);
    if (!cl || cl.length === 0) continue;
    const latest = s.latest_at ?? mail?.latest ?? (links.find((l) => sourceKeyOf(l.kind as WorkKind, l.ref) === sk)?.last_seen_at ?? null);
    let best: { c: Cand; verdict: 'open' | 'done'; name: string } | null = null;
    let security = false;
    for (const c of cl) {
      const verdict = c.type === 'task'
        ? (taskById.get(c.id) ? targetHandles({ type: 'task', row: taskById.get(c.id) as TaskRow }, latest) : null)
        : (projectById.get(c.id) ? targetHandles({ type: 'project', row: projectById.get(c.id) as ProjectRow }, latest) : null);
      if (verdict === 'security') { security = true; continue; }
      if (!verdict) continue;
      const name = c.type === 'task' ? (taskById.get(c.id) as TaskRow).title : (projectById.get(c.id) as ProjectRow).name;
      const better = !best || (verdict === 'open' && best.verdict === 'done') || (verdict === best.verdict && (c.type === 'task' && best.c.type === 'project' || (c.type === best.c.type && c.seen > best.c.seen)));
      if (better) best = { c, verdict, name };
    }
    if (security || !best) continue; // a security-tagged task never hides its source
    out.set(sk, { source_key: sk, target_key: best.c.target_key, type: best.c.type, id: best.c.id, name: displayText(best.name), href: workHref(best.c.type, best.c.id), state: best.verdict, link_id: best.c.link_id, via: best.c.via });
  }
  return out;
}

/** The first of these sources that is handled elsewhere, or null. */
export async function handledElsewhere(db: HomeDb, source: SourceRef | readonly SourceRef[]): Promise<Handled | null> {
  const list = Array.isArray(source) ? (source as readonly SourceRef[]) : [source as SourceRef];
  const m = await handledElsewhereMany(db, list);
  for (const s of list) {
    const h = m.get(sourceKeyOf(s.kind, s.ref));
    if (h) return h;
  }
  return null;
}

/**
 * The check every task-create path makes. `override` is the owner's explicit "create it anyway" (never set by a machine lane), and
 * `urgent` marks a source that must keep its own path. Returns the work that already carries the source, or null to go on creating.
 */
export async function checkTracked(db: HomeDb, sources: readonly SourceRef[], opts: { override?: boolean; urgent?: boolean } = {}): Promise<Handled | null> {
  if (opts.override || sources.length === 0) return null;
  return handledElsewhere(db, opts.urgent ? sources.map((s) => ({ ...s, urgent: true })) : sources);
}

/** The body of a create path that found an attachment: 200, nothing created. */
export function trackedBody(h: Handled, task: unknown | null): Record<string, unknown> {
  return {
    already_tracked: true,
    task,
    project: h.type === 'project' ? { id: h.id, name: h.name, href: h.href } : null,
    target_key: h.target_key,
    name: h.name,
    href: h.href,
    state: h.state,
  };
}

/** The sentence a chat op says when it refuses to start a second piece of work: names the work and carries its link. */
export function trackedSentence(h: Handled): string {
  return `That is already carried by "${h.name}" (${h.href}). Add to it, or say to start a new one anyway.`;
}

/**
 * A create path found an attachment: touch the link so it stays fresh and, for mail, record that another email arrived on it. Never
 * writes a task or changes a link's target. Best effort: a failure here must not turn the answer into an error.
 */
export async function noteTracked(db: HomeDb, h: Handled, src: { kind: WorkKind; ref: string }, now: Date = new Date()): Promise<void> {
  try {
    if (h.link_id) await db.workLink.updateMany({ where: { id: h.link_id, state: 'active' }, data: { last_seen_at: now } });
    if (src.kind === 'email') {
      await recordEvidence(db, [{ kind: 'their_message', ref: src.ref, at: new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000), line: evidenceLine('Asked for a new task from this email. It is already tracked here.'), source: 'guard', target_key: h.target_key }]);
    }
  } catch (e) {
    console.error('noteTracked failed', e);
  }
}
