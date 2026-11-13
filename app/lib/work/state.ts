/**
 * Work stage D: the one derived state of a piece of work, and the list of everything attached to it.
 *
 * deriveWorkState is pure. Order: done (the status) > looks_done (proof the work is finished, not closed) > waiting_them (an open wait
 * on a contact) > with_<assignee> (an open task with an owner) > open. workState reads the facts and calls it; every consumer (the home
 * screen, the drawer, the chat, the worker's spawn gate, Slack lines) reads this, nobody works the state out again.
 */

import { BAST_USER_ID } from '@/lib/bast-chat/gate-mirror';
import type { HomeDb } from '@/lib/home/state';
import { attachedItemLabel, stateLine } from './attach-copy';
import { loadEvidence } from './evidence';
import { FINISHED_PROJECT_STATUSES, FINISHED_TASK_STATUSES } from './links';
import { parseTargetKey } from './keys';

export type WorkStateName = 'done' | 'looks_done' | 'waiting_them' | 'open' | `with_${string}`;

export interface StateFacts {
  type: 'project' | 'task';
  /** True when the work is done (a done task, a done project). */
  finished: boolean;
  /** True when it ended without being done (an abandoned task, a cancelled project). */
  dropped: boolean;
  finished_at: Date | null;
  started_at: Date | null;
  looks_done: { line: string; at: Date | null } | null;
  open_wait: { who: string; since: Date } | null;
  /** Work stage E: a running or waiting session is attached to it (the worker keeps off). */
  live_session?: boolean;
  /** Owners of the open tasks (a task: its assignee; a project: its open tasks' assignees), with when each started. */
  owners: { name: string; user_id: string | null; since: Date | null }[];
}

export interface DerivedState {
  state: WorkStateName;
  since: Date | null;
  /** The person for with_<x> and waiting_them. */
  who: string | null;
  proof: string | null;
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

export function deriveWorkState(f: StateFacts): DerivedState {
  if (f.finished || f.dropped) return { state: 'done', since: f.finished_at, who: null, proof: null };
  if (f.looks_done) return { state: 'looks_done', since: f.looks_done.at, who: null, proof: f.looks_done.line };
  if (f.open_wait) return { state: 'waiting_them', since: f.open_wait.since, who: f.open_wait.who, proof: null };
  // Work stage E: an attached, running session means Mike has it right now; the worker keeps off (this replaces the cockpit-owned tag).
  if (f.live_session) return { state: 'with_mike_session', since: f.started_at, who: 'Mike', proof: null };
  if (f.owners.length > 0) {
    // The owner with the most open tasks; a tie goes to the one who started most recently.
    const tally = new Map<string, { name: string; user_id: string | null; n: number; since: Date | null }>();
    for (const o of f.owners) {
      const k = o.user_id ?? o.name;
      const cur = tally.get(k) ?? { name: o.name, user_id: o.user_id, n: 0, since: null };
      cur.n += 1;
      if (o.since && (!cur.since || o.since.getTime() > cur.since.getTime())) cur.since = o.since;
      tally.set(k, cur);
    }
    const best = [...tally.values()].sort((a, b) => b.n - a.n || (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0))[0];
    const key = best.user_id === BAST_USER_ID ? 'bast' : firstName(best.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
    return { state: `with_${key || 'someone'}` as WorkStateName, since: best.since, who: best.user_id === BAST_USER_ID ? 'Bast' : firstName(best.name), proof: null };
  }
  return { state: 'open', since: f.started_at, who: null, proof: null };
}

export interface AttachedItem {
  link_id: string;
  kind: string;
  ref: string;
  label: string;
  line: string;
  href: string | null;
  at: string;
  attached_by: string;
  target_key: string;
}

export interface StateReport {
  target_key: string;
  type: 'project' | 'task';
  id: string;
  name: string;
  href: string;
  status: string;
  state: WorkStateName;
  since: string | null;
  line: string;
  attached: AttachedItem[];
  evidence: { kind: string; at: string; line: string; href: string | null; source: string }[];
  /** True when a live (running) session is attached: the worker keeps off. */
  live_session: boolean;
}

const OPEN_WAIT = ['waiting', 'needs_human', 'blocked_by_switch'];
const OPEN_TASK = ['not_started', 'in_progress', 'review', 'blocked'];
const DEFAULT_ZONE = 'America/New_York';

export const workHref = (type: 'project' | 'task', id: string): string => (type === 'project' ? `/projects/${id}` : `/tasks/${id}`);

/** The links on a target (a project also lists the links on its tasks), with where each one opens. */
export async function listAttached(db: HomeDb, targetKey: string, zone: string = DEFAULT_ZONE): Promise<AttachedItem[]> {
  const p = parseTargetKey(targetKey);
  if (!p) return [];
  const where = p.type === 'project' ? { state: 'active', OR: [{ target_key: targetKey }, { project_id: p.id }] } : { state: 'active', target_key: targetKey };
  const links = await db.workLink.findMany({ where, orderBy: { last_seen_at: 'desc' }, take: 200 });
  if (links.length === 0) return [];

  // Where each opens: the newest email of a conversation, the session's own link, the outbox's task.
  const emailRefs = links.filter((l) => l.kind === 'email').map((l) => l.ref);
  const sessionRefs = links.filter((l) => l.kind === 'session').map((l) => l.ref);
  const asks = emailRefs.length
    ? await db.emailAsk.findMany({ where: { OR: [{ conversation_key: { in: emailRefs } }, { rfc_message_id: { in: emailRefs } }, { message_id: { in: emailRefs } }] }, select: { conversation_key: true, rfc_message_id: true, message_id: true, deep_link: true, received_at: true }, orderBy: { received_at: 'asc' } })
    : [];
  const emailHref = new Map<string, string>();
  for (const a of asks) for (const k of [a.conversation_key, a.rfc_message_id, a.message_id]) if (k && emailRefs.includes(k)) emailHref.set(k, a.deep_link);
  const sessions = sessionRefs.length ? await db.oracleSession.findMany({ where: { external_id: { in: sessionRefs } }, select: { external_id: true, remote_url: true } }) : [];
  const sessionHref = new Map(sessions.map((s) => [s.external_id, s.remote_url]));

  return links.map((l) => {
    const href = l.kind === 'email' ? emailHref.get(l.ref) ?? null : l.kind === 'session' ? sessionHref.get(l.ref) ?? null : null;
    const label = l.label ?? '';
    return { link_id: l.id, kind: l.kind, ref: l.ref, label, line: attachedItemLabel(l.kind, label, l.last_seen_at, zone), href, at: l.last_seen_at.toISOString(), attached_by: l.attached_by, target_key: l.target_key };
  });
}

/**
 * Which of these tasks have a live session, in one batch, by the same rule workState uses for a single task: a session link (kind session,
 * active) on the task itself or on its project, whose session is running or waiting and not archived. A live link on the project counts for
 * every task of it, exactly as it does in the single-task answer.
 */
export async function liveSessionTaskIds(db: HomeDb, tasks: { id: string; project_id: string | null }[]): Promise<Set<string>> {
  const live = new Set<string>();
  if (tasks.length === 0) return live;
  const keys = new Set<string>();
  for (const t of tasks) {
    keys.add(`task:${t.id}`);
    if (t.project_id) keys.add(`project:${t.project_id}`);
  }
  const links = await db.workLink.findMany({ where: { kind: 'session', state: 'active', target_key: { in: [...keys] } }, select: { ref: true, target_key: true }, take: 5000 });
  if (links.length === 0) return live;
  const running = await db.oracleSession.findMany({
    where: { external_id: { in: [...new Set(links.map((l) => l.ref))] }, archived_at: null, status: { in: ['running', 'waiting'] } },
    select: { external_id: true },
  });
  const runningRefs = new Set(running.map((r) => r.external_id));
  const liveKeys = new Set(links.filter((l) => runningRefs.has(l.ref)).map((l) => l.target_key));
  for (const t of tasks) if (liveKeys.has(`task:${t.id}`) || (t.project_id && liveKeys.has(`project:${t.project_id}`))) live.add(t.id);
  return live;
}

export async function workState(db: HomeDb, targetKey: string, opts: { zone?: string; evidenceLimit?: number } = {}): Promise<StateReport | null> {
  const p = parseTargetKey(targetKey);
  if (!p) return null;
  const zone = opts.zone ?? DEFAULT_ZONE;
  let name = '';
  let status = '';
  let facts: StateFacts;

  if (p.type === 'task') {
    const t = await db.task.findUnique({ where: { id: p.id }, select: { id: true, title: true, status: true, is_deleted: true, completed_at: true, updated_at: true, started_at: true, created_at: true, assignee_id: true, assignee: { select: { name: true } } } });
    if (!t || t.is_deleted) return null;
    name = t.title;
    status = t.status;
    const [fin, wait] = await Promise.all([
      db.workFinishedItem.findFirst({ where: { task_id: t.id, state: 'open' }, orderBy: { created_at: 'desc' }, select: { evidence: true, created_at: true } }),
      db.wait.findFirst({ where: { task_id: t.id, state: { in: OPEN_WAIT as never }, owner_contact_id: { not: null } }, orderBy: { started_at: 'asc' }, select: { started_at: true, owner_contact: { select: { name: true } } } }),
    ]);
    const live = await db.workEvidence.findFirst({ where: { target_key: targetKey, kind: 'live' }, orderBy: { at: 'desc' }, select: { line: true, at: true } });
    const first = Array.isArray(fin?.evidence) ? (fin?.evidence as { line?: unknown }[]).find((e) => typeof e?.line === 'string') : undefined;
    facts = {
      type: 'task',
      finished: t.status === 'done',
      dropped: t.status === 'abandoned',
      finished_at: (FINISHED_TASK_STATUSES as readonly string[]).includes(t.status) ? (t.completed_at ?? t.updated_at) : null,
      started_at: t.started_at ?? t.created_at,
      looks_done: first ? { line: first.line as string, at: fin?.created_at ?? null } : live ? { line: live.line, at: live.at } : null,
      open_wait: wait ? { who: wait.owner_contact?.name ?? 'them', since: wait.started_at } : null,
      owners: OPEN_TASK.includes(t.status) && t.assignee ? [{ name: t.assignee.name, user_id: t.assignee_id, since: t.started_at ?? t.created_at }] : [],
    };
  } else {
    const pr = await db.project.findUnique({ where: { id: p.id }, select: { id: true, name: true, status: true, is_deleted: true, completed_date: true, updated_at: true, created_at: true } });
    if (!pr || pr.is_deleted) return null;
    name = pr.name;
    status = pr.status;
    const [tasks, wait, live] = await Promise.all([
      db.task.findMany({ where: { project_id: pr.id, is_deleted: false, status: { in: OPEN_TASK as never } }, select: { started_at: true, created_at: true, assignee_id: true, assignee: { select: { name: true } } }, take: 300 }),
      db.wait.findFirst({ where: { OR: [{ project_id: pr.id }, { task: { project_id: pr.id } }], state: { in: OPEN_WAIT as never }, owner_contact_id: { not: null } }, orderBy: { started_at: 'asc' }, select: { started_at: true, owner_contact: { select: { name: true } } } }),
      db.workEvidence.findFirst({ where: { project_id: pr.id, kind: 'live' }, orderBy: { at: 'desc' }, select: { line: true, at: true } }),
    ]);
    facts = {
      type: 'project',
      finished: pr.status === 'done',
      dropped: pr.status === 'cancelled',
      finished_at: (FINISHED_PROJECT_STATUSES as readonly string[]).includes(pr.status) ? pr.completed_date ?? pr.updated_at : null,
      started_at: pr.created_at,
      looks_done: live ? { line: live.line, at: live.at } : null,
      open_wait: wait ? { who: wait.owner_contact?.name ?? 'them', since: wait.started_at } : null,
      owners: tasks.flatMap((t) => (t.assignee ? [{ name: t.assignee.name, user_id: t.assignee_id, since: t.started_at ?? t.created_at }] : [])),
    };
  }

  // A session link whose session is running and not archived: a live session has this. A task also reads the links on its project.
  const taskProjectId = p.type === 'task' ? (await db.task.findUnique({ where: { id: p.id }, select: { project_id: true } }))?.project_id ?? null : null;
  const sessionLinks = await db.workLink.findMany({
    where: { kind: 'session', state: 'active', OR: [{ target_key: targetKey }, ...(p.type === 'project' ? [{ project_id: p.id }] : taskProjectId ? [{ target_key: `project:${taskProjectId}` }] : [])] },
    select: { ref: true },
    take: 50,
  });
  const running = sessionLinks.length
    ? await db.oracleSession.count({ where: { external_id: { in: sessionLinks.map((s) => s.ref) }, archived_at: null, status: { in: ['running', 'waiting'] } } })
    : 0;
  facts.live_session = running > 0;
  const d = deriveWorkState(facts);
  const line = facts.dropped && d.state === 'done' ? `Dropped${d.since ? ` ${stateLine('done', { since: d.since, zone }).replace(/^Done /, '')}` : ''}` : stateLine(d.state, { since: d.since, zone, who: d.who, proof: d.proof });
  const [attached, evidence] = await Promise.all([listAttached(db, targetKey, zone), loadEvidence(db, targetKey, opts.evidenceLimit ?? 30)]);
  return {
    target_key: targetKey,
    type: p.type,
    id: p.id,
    name,
    href: workHref(p.type, p.id),
    status,
    state: d.state,
    since: d.since ? d.since.toISOString() : null,
    line,
    attached,
    evidence: evidence.map((e) => ({ kind: e.kind, at: e.at.toISOString(), line: e.line, href: e.href, source: e.source })),
    live_session: running > 0,
  };
}
