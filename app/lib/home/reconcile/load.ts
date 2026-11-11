/**
 * Home Slice 9a: what Citadel reads to answer the machine (the GET context, the candidates) and to decide (task, client and
 * session facts). Read only: nothing here writes a row. The same functions feed the dry and the real POST, so both see the same facts.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { loadReachTask } from '@/lib/bast-chat/actions';
import { checkComment } from '@/lib/bast-chat/worker-reach';
import { zonedDateString, zonedToUtc } from '../act';
import { ownerOnHome } from '../keeper/run';
import { loadSessionAsksFor } from '../load';
import { basisFor, basisValid, tokens, type Basis } from './match';
import { LIVE_PROJECT_STATUSES } from './placement';
import { sessionSpanMinutes } from './estimate';
import type { TaskFacts } from './decide';
import type { CandidatesMessage } from './schema';

export const MIKE_ACCOUNTS = ['mike@becomeindelible.com', 'mike@whoismikedion.com'] as const;
export const PROTECTED_TAGS = ['security', 'security-report', 'lifeline'] as const;
export const OPEN_TASK_STATUSES = ['not_started', 'in_progress', 'blocked'] as const;
export const NOTES_PER_DAY = 20;
export const CARDS_PER_DAY = 10;
export const LOOKBACK_CARDS_TOTAL = 25;
export const PROCESSED_DAYS = 21;
const OPEN_WAIT = ['waiting', 'needs_human', 'blocked_by_switch'];
const OPEN_APPROVAL = ['draft', 'queued', 'sending', 'sent'] as const;
const DAY_MS = 24 * 3600 * 1000;

export const isProtected = (tags: readonly string[]): boolean => tags.some((t) => (PROTECTED_TAGS as readonly string[]).includes(t) || t.startsWith('job-watch'));

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
/** The drafter's normalize_body: CRLF to LF, trailing blanks off each line, blank lines trimmed at both ends. */
export function normalizeBody(text: string): string {
  const t = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return t
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Email addresses found in text, lowercase, each once. */
export function emailsIn(text: string): string[] {
  return [...new Set((text.match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase()))];
}

export function domainOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
    return h || null;
  } catch {
    return null;
  }
}

/** Start of the owner's calendar day. */
export function dayStartOf(now: Date, timezone: string): Date {
  const [y, m, d] = zonedDateString(now, timezone).split('-').map(Number);
  return zonedToUtc(y, m, d, 0, 0, timezone);
}

/** Open checklist items of a task (Task.requirements JSON, flat items or sections). */
export function openChecklist(requirements: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (!Array.isArray(v)) return;
    for (const r of v) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      if (Array.isArray(o.items)) walk(o.items);
      else if (typeof o.text === 'string' && o.text.trim() !== '' && o.completed !== true) out.push(o.text.replace(/\s+/g, ' ').trim());
    }
  };
  walk(requirements);
  return out;
}

// ============================================================================
// The GET context
// ============================================================================

export interface ReconcileContext {
  owner_ok: boolean;
  on: boolean;
  auto: false;
  caps: { notes_left: number; cards_left: number };
  processed: string[];
  holds: string[];
  bast_draft_hashes: string[];
  lookback_done: boolean;
}

export type ContextResult = ReconcileContext | { skipped: 'home_off'; owner_ok: false; on: false };

export async function reconcileOn(db: PrismaClient, ownerId: string): Promise<boolean> {
  const s = await db.homeKeeperSettings.findUnique({ where: { user_id: ownerId }, select: { reconcile_on: true } });
  return s?.reconcile_on === true;
}

export interface Counters {
  notes_today: number;
  cards_today: number;
  lookback_cards: number;
}

export async function loadCounters(db: PrismaClient, ownerId: string, now: Date, timezone: string): Promise<Counters> {
  const since = dayStartOf(now, timezone);
  const [notes, cards, look] = await Promise.all([
    db.homeReconcileChange.count({ where: { user_id: ownerId, mode: 'auto', kind: 'note', created_at: { gte: since } } }),
    db.homeReconcileChange.count({ where: { user_id: ownerId, mode: 'card', created_at: { gte: since }, message: { lookback: false } } }),
    db.homeReconcileChange.count({ where: { user_id: ownerId, mode: 'card', message: { lookback: true } } }),
  ]);
  return { notes_today: notes, cards_today: cards, lookback_cards: look };
}

export async function activeHolds(db: PrismaClient, ownerId: string, now: Date): Promise<string[]> {
  const rows = await db.homeReconcileHold.findMany({ where: { user_id: ownerId, until: { gt: now } }, select: { target_key: true } });
  return rows.map((r) => r.target_key);
}

export async function bastDraftHashes(db: PrismaClient, ownerId: string, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - PROCESSED_DAYS * DAY_MS);
  const rows = await db.homeOwedThread.findMany({
    where: { user_id: ownerId, updated_at: { gte: since }, OR: [{ draft_hash: { not: null } }, { short_draft_hash: { not: null } }] },
    select: { draft_hash: true, short_draft_hash: true },
  });
  const out = new Set<string>();
  for (const r of rows) {
    if (r.draft_hash) out.add(r.draft_hash);
    if (r.short_draft_hash) out.add(r.short_draft_hash);
  }
  return [...out];
}

export async function lookbackDone(db: PrismaClient, ownerId: string): Promise<boolean> {
  const r = await db.homeKeeperRun.findFirst({ where: { user_id: ownerId, kind: 'reconcile_lookback' }, select: { id: true } });
  return !!r;
}

export async function loadContext(db: PrismaClient, ownerId: string, now: Date): Promise<ContextResult> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { skipped: 'home_off', owner_ok: false, on: false };
  const on = await reconcileOn(db, ownerId);
  const since = new Date(now.getTime() - PROCESSED_DAYS * DAY_MS);
  const [counters, processed, holds, hashes, done] = await Promise.all([
    loadCounters(db, ownerId, now, timezone),
    db.homeReconcileMessage.findMany({ where: { user_id: ownerId, created_at: { gte: since } }, select: { message_key: true } }),
    activeHolds(db, ownerId, now),
    bastDraftHashes(db, ownerId, now),
    lookbackDone(db, ownerId),
  ]);
  return {
    owner_ok: true,
    on,
    auto: false,
    caps: { notes_left: Math.max(0, NOTES_PER_DAY - counters.notes_today), cards_left: Math.max(0, CARDS_PER_DAY - counters.cards_today) },
    processed: processed.map((p) => p.message_key),
    holds,
    bast_draft_hashes: hashes,
    lookback_done: done,
  };
}

// ============================================================================
// Clients, contacts and sites
// ============================================================================

export interface ClientHit {
  id: string;
  name: string;
  retainer_hours: number | null;
}

export interface Recipients {
  /** email to a contact name, when the address is a ClientContact. */
  names: Map<string, string>;
  clients: ClientHit[];
}

/** The clients a message was sent to: by ClientContact address first, then by a site's domain. */
export async function resolveRecipients(db: PrismaClient, recipients: string[]): Promise<Recipients> {
  const emails = [...new Set(recipients.map((e) => e.toLowerCase()))];
  const names = new Map<string, string>();
  if (emails.length === 0) return { names, clients: [] };
  const contacts = await db.clientContact.findMany({
    where: { is_deleted: false, email: { in: emails, mode: 'insensitive' } },
    select: { email: true, name: true, client_id: true, client: { select: { id: true, name: true, retainer_hours: true } } },
  });
  const byId = new Map<string, ClientHit>();
  for (const c of contacts) {
    if (c.name) names.set(c.email.toLowerCase(), c.name);
    if (c.client) byId.set(c.client.id, { id: c.client.id, name: c.client.name, retainer_hours: c.client.retainer_hours === null ? null : Number(c.client.retainer_hours) });
  }
  if (byId.size === 0) {
    const domains = [...new Set(emails.map((e) => e.split('@')[1]).filter(Boolean))];
    if (domains.length > 0) {
      const sites = await db.site.findMany({
        where: { client_id: { not: null }, OR: domains.map((d) => ({ url: { contains: d, mode: 'insensitive' as const } })) },
        select: { url: true, client: { select: { id: true, name: true, retainer_hours: true } } },
      });
      for (const s of sites) {
        const dom = domainOfUrl(s.url);
        if (s.client && dom && domains.some((d) => d === dom || d.endsWith(`.${dom}`))) {
          byId.set(s.client.id, { id: s.client.id, name: s.client.name, retainer_hours: s.client.retainer_hours === null ? null : Number(s.client.retainer_hours) });
        }
      }
    }
  }
  return { names, clients: [...byId.values()] };
}

/** "Kue Chen", else the address. */
export function displayWho(emails: string[], names: Map<string, string>): string[] {
  return emails.map((e) => names.get(e.toLowerCase()) ?? e);
}

// ============================================================================
// The thread: asks and RFC ids Citadel itself holds
// ============================================================================

export interface ThreadFacts {
  thread_ids: string[];
  rfc_ids: string[];
  /** Tasks an EmailAsk on the thread points at. */
  ask_task_ids: Set<string>;
}

export async function loadThread(db: PrismaClient, threadIds: string[], extraRfc: string[]): Promise<ThreadFacts> {
  const ids = [...new Set(threadIds.filter(Boolean))];
  const asks = ids.length
    ? await db.emailAsk.findMany({
        where: { OR: [{ thread_id: { in: ids } }, { message_id: { in: ids } }] },
        select: { message_id: true, task_id: true },
        take: 200,
      })
    : [];
  const rfc = new Set(extraRfc.map((x) => x.trim().replace(/^<|>$/g, '').toLowerCase()));
  const ask_task_ids = new Set<string>();
  for (const a of asks) {
    rfc.add(a.message_id.trim().replace(/^<|>$/g, '').toLowerCase());
    if (a.task_id) ask_task_ids.add(a.task_id);
  }
  return { thread_ids: ids, rfc_ids: [...rfc], ask_task_ids };
}

// ============================================================================
// Task facts
// ============================================================================

export interface MessageForFacts {
  message_key: string;
  thread_ids: string[];
  recipients: string[];
  subject: string;
  /** New words; '' for the candidates route (the request carries none). */
  new_part: string;
  sent_at: Date;
}

export interface LoadedTask {
  id: string;
  title: string;
  status: string;
  tags: string[];
  mine: boolean;
  assignee_name: string | null;
  client_id: string | null;
  client_name: string | null;
  project_id: string | null;
  project_name: string | null;
  open_items: string[];
  basis: Basis[];
  has_time: boolean;
  estimated_minutes: number | null;
  updated_at: Date;
  facts: TaskFacts;
  free_to_change: boolean;
}

export async function loadTasks(
  db: PrismaClient,
  ownerId: string,
  taskIds: string[],
  msg: MessageForFacts,
  thread: ThreadFacts,
  holds: Set<string>,
  now: Date
): Promise<Map<string, LoadedTask>> {
  const out = new Map<string, LoadedTask>();
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return out;
  const rows = await db.task.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      status: true,
      tags: true,
      assignee_id: true,
      assignee: { select: { name: true } },
      is_deleted: true,
      created_at: true,
      updated_at: true,
      client_visible: true,
      source: true,
      source_ref: true,
      origin_url: true,
      client_id: true,
      client: { select: { name: true } },
      site: { select: { url: true } },
      project_id: true,
      project: { select: { name: true } },
      requirements: true,
      estimated_minutes: true,
      blocking: { where: { is_deleted: false, status: { notIn: ['done', 'abandoned'] } }, select: { id: true }, take: 1 },
    },
  });
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter((x): x is string => !!x))];
  const [contacts, sites, waits, approvals, times] = await Promise.all([
    clientIds.length ? db.clientContact.findMany({ where: { client_id: { in: clientIds }, is_deleted: false }, select: { client_id: true, email: true } }) : Promise.resolve([]),
    clientIds.length ? db.site.findMany({ where: { client_id: { in: clientIds } }, select: { client_id: true, url: true } }) : Promise.resolve([]),
    db.wait.findMany({ where: { task_id: { in: ids }, state: { in: OPEN_WAIT as never } }, select: { task_id: true } }),
    db.approvalRequest.findMany({ where: { task_id: { in: ids }, status: { in: [...OPEN_APPROVAL] } }, select: { task_id: true } }),
    db.timeEntry.groupBy({ by: ['task_id'], where: { task_id: { in: ids }, is_deleted: false }, _count: { _all: true } }),
  ]);
  const waitTasks = new Set(waits.map((w) => w.task_id));
  const approvalTasks = new Set(approvals.map((a) => a.task_id));
  const timeTasks = new Set(times.map((t) => t.task_id));

  for (const r of rows) {
    const contactEmails = contacts.filter((c) => c.client_id === r.client_id).map((c) => c.email.toLowerCase());
    const domains = new Set<string>();
    for (const s of sites) if (s.client_id === r.client_id) {
      const d = domainOfUrl(s.url);
      if (d) domains.add(d);
    }
    const own = domainOfUrl(r.site?.url);
    if (own) domains.add(own);
    const basis = basisFor(
      {
        title: r.title,
        source_ref: r.source_ref,
        origin_url: r.origin_url,
        ask_on_thread: thread.ask_task_ids.has(r.id),
        site_domains: [...domains],
        client_contact_emails: contactEmails,
      },
      { thread_ids: thread.thread_ids, rfc_ids: [...thread.rfc_ids, msg.message_key.toLowerCase()], recipients: msg.recipients, subject: msg.subject, new_part: msg.new_part }
    );
    const mine = r.assignee_id === ownerId;
    let reachTap = false;
    if (mine && !r.is_deleted) {
      const loaded = await loadReachTask(db, r.id);
      if (loaded) reachTap = checkComment({ task: loaded.reach, action: 'add', added_author: 'bot', now, origin: 'chat' }).needs_tap;
      else reachTap = true;
    }
    const facts: TaskFacts = {
      candidate: basisValid(basis),
      mine,
      open: (OPEN_TASK_STATUSES as readonly string[]).includes(r.status),
      deleted: r.is_deleted,
      created_before_sent: r.created_at.getTime() <= msg.sent_at.getTime(),
      held: holds.has(`task:${r.id}`),
      protected_tag: isProtected(r.tags),
      client_visible: r.client_visible,
      portal: r.source === 'portal',
      approval_open: approvalTasks.has(r.id),
      tied: r.blocking.length > 0 || waitTasks.has(r.id),
      reach_tap: reachTap,
    };
    const free = facts.mine && facts.open && !facts.deleted && !facts.held && !facts.protected_tag && !facts.client_visible && !facts.portal && !facts.approval_open && !facts.tied && !facts.reach_tap;
    out.set(r.id, {
      id: r.id,
      title: r.title,
      status: r.status,
      tags: r.tags,
      mine,
      assignee_name: r.assignee?.name ?? null,
      client_id: r.client_id,
      client_name: r.client?.name ?? null,
      project_id: r.project_id,
      project_name: r.project?.name ?? null,
      open_items: openChecklist(r.requirements),
      basis,
      has_time: timeTasks.has(r.id),
      estimated_minutes: r.estimated_minutes,
      updated_at: r.updated_at,
      facts,
      free_to_change: free,
    });
  }
  return out;
}

// ============================================================================
// Candidates for the machine
// ============================================================================

const POOL_TAKE = 60;
const TASKS_MAX = 8;

export interface CandidateReply {
  message_key: string;
  client: { id: string; name: string } | null;
  tasks: {
    id: string;
    title: string;
    mine: boolean;
    status: string;
    tags: string[];
    protected: boolean;
    client: string | null;
    project: string | null;
    open_items: string[];
    basis: Basis[];
    free_to_change: boolean;
  }[];
  sessions: Record<string, unknown>[];
  waits: { id: string; title: string; state: string }[];
  projects: { id: string; name: string; type: string; status: string; is_retainer: boolean; open_tasks: string[] }[];
  retainer: { hours: number } | null;
  tracked_hint: { state: string; kind: string; title: string } | null;
}

export async function candidatesFor(db: PrismaClient, ownerId: string, m: CandidatesMessage, now: Date): Promise<CandidateReply> {
  const recipients = [...m.to, ...m.cc].map((a) => a.email.toLowerCase());
  const [{ clients }, holdKeys] = await Promise.all([resolveRecipients(db, recipients), activeHolds(db, ownerId, now)]);
  const thread = await loadThread(db, [m.thread_id], m.thread_rfc_ids);
  const sent = new Date(m.sent_at);
  const msg: MessageForFacts = { message_key: m.message_key, thread_ids: thread.thread_ids, recipients, subject: m.subject, new_part: '', sent_at: sent };

  // The pool: tasks tied to the thread, then open tasks of the clients named.
  const pool = new Set<string>(thread.ask_task_ids);
  // A task's source_ref may hold the id with or without its angle brackets.
  const refs = thread.rfc_ids.flatMap((r) => [r, `<${r}>`]);
  const [byRef, byOrigin, byClient] = await Promise.all([
    refs.length ? db.task.findMany({ where: { source_ref: { in: refs }, is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } }, select: { id: true }, take: POOL_TAKE }) : Promise.resolve([]),
    m.thread_id.length >= 8 ? db.task.findMany({ where: { origin_url: { contains: m.thread_id }, is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } }, select: { id: true }, take: POOL_TAKE }) : Promise.resolve([]),
    clients.length
      ? db.task.findMany({ where: { client_id: { in: clients.map((c) => c.id) }, is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } }, select: { id: true }, orderBy: { updated_at: 'desc' }, take: POOL_TAKE })
      : Promise.resolve([]),
  ]);
  for (const t of [...byRef, ...byOrigin, ...byClient]) pool.add(t.id);
  const loaded = await loadTasks(db, ownerId, [...pool], msg, thread, new Set(holdKeys), now);
  const tasks = [...loaded.values()]
    .filter((t) => t.facts.candidate && t.facts.open && !t.facts.deleted && t.facts.created_before_sent)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.basis.includes('thread')) - Number(a.basis.includes('thread')) || b.updated_at.getTime() - a.updated_at.getTime())
    .slice(0, TASKS_MAX)
    .map((t) => ({
      id: t.id,
      title: t.title,
      mine: t.mine,
      status: t.status,
      tags: t.tags,
      protected: t.facts.protected_tag,
      client: t.client_name,
      project: t.project_name,
      open_items: t.open_items.slice(0, 6),
      basis: t.basis,
      free_to_change: t.free_to_change,
    }));

  const client = clients.length > 0 ? { id: clients[0].id, name: clients[0].name } : null;
  const clientId = client?.id ?? null;

  // Waits open on the thread.
  const waits = await db.wait.findMany({
    where: { email_thread_id: { in: thread.thread_ids }, state: { in: OPEN_WAIT as never } },
    select: { id: true, title: true, state: true },
    take: 10,
  });

  // The client's live projects (with a few open task titles each).
  const projects = clientId
    ? await db.project.findMany({
        where: { client_id: clientId, is_deleted: false, status: { in: LIVE_PROJECT_STATUSES as never } },
        select: { id: true, name: true, type: true, status: true, is_retainer: true, tasks: { where: { is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } }, select: { title: true }, take: 5 } },
        orderBy: { name: 'asc' },
        take: 12,
      })
    : [];

  // Sessions: asks parked on him that bear on this mail, and sessions that ran in the work window for the client.
  const asks = await loadSessionAsksFor(db, ownerId);
  const subjTokens = new Set(tokens(`${m.subject}`));
  const relevantAsks = asks
    .filter((a) => (clientId && a.client?.id === clientId) || tokens(`${a.title ?? ''}`).some((t) => subjTokens.has(t)))
    .slice(0, 6)
    .map((a) => ({
      session_key: a.external_id,
      kind: 'ask',
      title: (a.title ?? '').slice(0, 120),
      text: a.waiting_on.slice(0, 600),
      asked_at: a.asked_at.toISOString(),
    }));
  const windowFrom = new Date(sent.getTime() - 3 * DAY_MS);
  const work = clientId
    ? await db.oracleSession.findMany({
        where: { archived_at: null, arc: { client_id: clientId }, last_event_at: { gte: windowFrom, lte: new Date(sent.getTime() + 3600_000) } },
        select: { external_id: true, title: true, started_at: true, last_event_at: true },
        orderBy: { last_event_at: 'desc' },
        take: 6,
      })
    : [];
  const sessions: Record<string, unknown>[] = [
    ...relevantAsks,
    ...work.map((s) => ({
      key: s.external_id,
      kind: 'work',
      title: (s.title ?? '').slice(0, 120),
      started_at: s.started_at?.toISOString() ?? null,
      last_event_at: s.last_event_at?.toISOString() ?? null,
      span_minutes: sessionSpanMinutes(s.started_at, s.last_event_at),
    })),
  ];

  // A work card already open or dismissed for this thread or client.
  const hint = await db.homeReconcileChange.findFirst({
    where: {
      user_id: ownerId,
      kind: 'track',
      state: { in: ['open', 'dismissed'] },
      OR: [{ message: { thread_id: m.thread_id } }, ...(clientId ? [{ dedupe_key: { startsWith: `work:${clientId}:` } }] : [])],
    },
    select: { state: true, kind: true, title: true },
    orderBy: { created_at: 'desc' },
  });

  return {
    message_key: m.message_key,
    client,
    tasks,
    sessions,
    waits: waits.map((w) => ({ id: w.id, title: w.title, state: w.state })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, type: p.type, status: p.status, is_retainer: p.is_retainer, open_tasks: p.tasks.map((t) => t.title) })),
    retainer: clients[0]?.retainer_hours ? { hours: clients[0].retainer_hours } : null,
    tracked_hint: hint ? { state: hint.state, kind: hint.kind, title: hint.title } : null,
  };
}
