/**
 * Work stage E: the database side of sessions.
 *
 *   buildWorkIndex          GET /api/oracle/work-index: what the machine's session hooks cache (live projects with folders, sites with
 *                           repositories, client slugs, open tasks with links, the session links). Read only.
 *   saveSessionLink         POST /api/oracle/sessions/:id/links: attach the session to the work its folder belongs to (quietly when
 *                           clear), or make the ONE question. Never closes or deletes anything.
 *   recordSessionEvidence   POST /api/oracle/sessions/:id/evidence: match the session's commits and delivered files to the tasks of the
 *                           projects it worked in, write code-recorded proof, and decide card, note or nothing. Never closes anything.
 *   closeTaskFromSession    POST /api/oracle/sessions/:id/close-task: closes a task on the owner's yes, only when proof for that task is
 *                           recorded in this session, the task is not security-tagged, and no checklist item is unticked.
 *   loadSessionFinishedCards  the looks-done cards on the home screen, one per session. Read only.
 *
 * Owner only: with no home owner on the home view every function answers skipped and writes nothing.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { BAST_USER_ID } from '@/lib/bast-chat/gate-mirror';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { displayText } from '@/lib/home/copy';
import { ownerActor } from '@/lib/home/reconcile/actor';
import { appendHomeAction, type HomeDb } from '@/lib/home/state';
import type { HomeFinishedRow, RawSessionFinishedCard } from '@/lib/home/types';
import { patchTask } from '@/lib/services/task-patch';
import { attachOrPropose, type AttachOutcome } from './attach-store';
import { homeOwner, isSecurityTagged } from './ask-closure';
import { cleanPath } from './candidates';
import { OPEN_STATUSES, ONE_TAP_GROUPS, groupFor, hasUnticked, tickedByDefault, type EvidenceLine, type FinishedGroup } from './finished';
import { FINISHED_UNDO_HOURS, heldTasks, stageALines, type FinishedCloseRecord } from './finished-store';
import { evidenceLine } from './evidence';
import { LIVE_PROJECT_STATUSES } from './links';
import { clip } from './keys';
import { sessionCloseComment, partialNote, proofWords, CLOSE_MESSAGES } from './session-copy';
import {
  SESSION_CARD_DELAY_HOURS,
  inSegment,
  inWindow,
  matchItem,
  plainTaskText,
  proofLineOf,
  sessionCardKey,
  sessionRunKey,
  shortIdOf,
  type ProofStrength,
  type Segment,
  type SessionItem,
} from './sessions';
import { workHref } from './state';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const SESSION_EVIDENCE_SOURCE = 'session';
export const SESSION_EVIDENCE_SOURCE_WEAK = 'session_weak';

type Db = HomeDb | PrismaClient | Prisma.TransactionClient;
const asHome = (db: Db): HomeDb => db as unknown as HomeDb;

// ----------------------------------------------------------------------------
// GET /api/oracle/work-index
// ----------------------------------------------------------------------------

export interface WorkIndex {
  generated_at: string;
  projects: {
    id: string;
    target_key: string;
    name: string;
    status: string;
    href: string;
    client: { id: string; name: string; slug: string } | null;
    plan_folder: string | null;
    site_repo_url: string | null;
    open_tasks: number;
  }[];
  sites: { id: string; name: string; repo_url: string; client_id: string | null }[];
  clients: { id: string; name: string; slug: string }[];
  tasks: { id: string; short_id: string; target_key: string; title: string; status: string; href: string; project_id: string | null; client_id: string | null; security: boolean }[];
  session_links: { session_ref: string; target_key: string; label: string | null; basis: string | null; cwds: string[]; machine: string | null }[];
}

const PROJECTS_MAX = 300;
const TASKS_MAX = 600;
const LINKS_MAX = 500;
const LINK_RECENT_DAYS = 21;

const clientSlugOf = (name: string): string => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

export function cwdsOf(context: unknown): string[] {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return [];
  const c = (context as { cwds?: unknown }).cwds;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
}

export async function buildWorkIndex(db: Db, opts: { machine?: string | null; now?: Date } = {}): Promise<WorkIndex> {
  const now = opts.now ?? new Date();
  const projects = await db.project.findMany({
    where: { is_deleted: false, status: { in: [...LIVE_PROJECT_STATUSES] as never }, },
    select: { id: true, name: true, status: true, plan_folder: true, client: { select: { id: true, name: true } }, site: { select: { repo_url: true } }, _count: { select: { tasks: { where: { is_deleted: false, status: { in: OPEN_STATUSES as never[] } } } } } },
    orderBy: { updated_at: 'desc' },
    take: PROJECTS_MAX,
  });
  const clientIds = Array.from(new Set(projects.map((p) => p.client?.id).filter((x): x is string => !!x)));
  const sites = await db.site.findMany({ where: { is_deleted: false, repo_url: { not: null }, ...(clientIds.length ? { client_id: { in: clientIds } } : {}) }, select: { id: true, name: true, repo_url: true, client_id: true }, take: 500 });
  const clients = clientIds.length ? await db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [];
  const owner = await homeOwner(asHome(db));
  const tasks = await db.task.findMany({
    where: { is_deleted: false, status: { in: OPEN_STATUSES as never[] }, OR: [{ assignee_id: null }, { assignee_id: { in: [...(owner ? [owner.id] : []), ...BOT_USER_IDS] } }] },
    select: { id: true, title: true, status: true, project_id: true, client_id: true, tags: true },
    orderBy: { updated_at: 'desc' },
    take: TASKS_MAX,
  });
  const since = new Date(now.getTime() - LINK_RECENT_DAYS * DAY_MS);
  const links = await db.workLink.findMany({ where: { kind: 'session', state: 'active', last_seen_at: { gt: since } }, orderBy: { last_seen_at: 'desc' }, take: LINKS_MAX, select: { ref: true, target_key: true, label: true, basis: true, context: true } });
  const machineBy = new Map<string, string>();
  if (links.length) {
    const sess = await db.oracleSession.findMany({ where: { external_id: { in: links.map((l) => l.ref) } }, select: { external_id: true, machine: { select: { name: true } } } });
    for (const s of sess) machineBy.set(s.external_id, s.machine.name);
  }
  const wantMachine = opts.machine ?? null;
  return {
    generated_at: now.toISOString(),
    projects: projects.map((p) => ({
      id: p.id,
      target_key: `project:${p.id}`,
      name: displayText(p.name),
      status: p.status,
      href: workHref('project', p.id),
      client: p.client ? { id: p.client.id, name: displayText(p.client.name), slug: clientSlugOf(p.client.name) } : null,
      plan_folder: cleanPath(p.plan_folder),
      site_repo_url: p.site?.repo_url ?? null,
      open_tasks: p._count.tasks,
    })),
    sites: sites.flatMap((s) => (s.repo_url ? [{ id: s.id, name: displayText(s.name), repo_url: s.repo_url, client_id: s.client_id }] : [])),
    clients: clients.map((c) => ({ id: c.id, name: displayText(c.name), slug: clientSlugOf(c.name) })),
    tasks: tasks.map((t) => ({ id: t.id, short_id: shortIdOf(t.id), target_key: `task:${t.id}`, title: displayText(t.title), status: t.status, href: workHref('task', t.id), project_id: t.project_id, client_id: t.client_id, security: isSecurityTagged(t.tags) })),
    session_links: links
      .map((l) => ({ session_ref: l.ref, target_key: l.target_key, label: l.label, basis: l.basis, cwds: cwdsOf(l.context), machine: machineBy.get(l.ref) ?? null }))
      .filter((l) => !wantMachine || l.machine === wantMachine || l.machine === null),
  };
}

// ----------------------------------------------------------------------------
// POST /api/oracle/sessions/:id/links
// ----------------------------------------------------------------------------

export interface SessionLinkRequest {
  ref: string;
  target_key?: string | null;
  propose?: boolean;
  cwd?: string | null;
  basis?: string | null;
  repo_remote?: string | null;
  client_id?: string | null;
  label?: string | null;
  one_deliverable?: boolean;
  attached_by: 'auto' | 'mike' | 'bast' | 'intake';
  now?: Date;
}

/**
 * Attach the session to the work it ran in. A named target attaches there. propose works the folder out (a clear match attaches
 * quietly, anything else is the ONE question, there is one question row per session). A session that works in more than one project
 * gets one link per project: its folder is judged on its own, not by the project it already has. The folder is remembered on the link,
 * so the session's proof is matched to that project's tasks only.
 */
export async function saveSessionLink(db: HomeDb, req: SessionLinkRequest): Promise<AttachOutcome & { cwd?: string | null }> {
  const now = req.now ?? new Date();
  const out = await attachOrPropose(db, {
    kind: 'session',
    ref: req.ref,
    label: req.label ?? null,
    target_key: req.target_key ?? null,
    propose: req.propose === true,
    cwd: req.cwd ?? null,
    repo_remote: req.repo_remote ?? null,
    client_id: req.client_id ?? null,
    one_deliverable: req.one_deliverable === true,
    ignore_existing: req.propose === true,
    attached_by: req.attached_by,
    now,
  });
  if (out.result === 'attached' || out.result === 'already') {
    const cwd = cleanPath(req.cwd);
    if (cwd) {
      const link = await db.workLink.findUnique({ where: { id: out.link_id }, select: { context: true } });
      const cwds = Array.from(new Set([cwd, ...cwdsOf(link?.context)])).slice(0, 8);
      await db.workLink.update({ where: { id: out.link_id }, data: { context: { cwds } as never } });
    }
  }
  if (out.result !== 'skipped') await db.oracleSession.updateMany({ where: { external_id: req.ref }, data: { work_checked_at: now } });
  return out;
}

// ----------------------------------------------------------------------------
// POST /api/oracle/sessions/:id/evidence
// ----------------------------------------------------------------------------

export interface SessionEvidenceBody {
  window: { from: Date; to: Date };
  items: SessionItem[];
}

export interface SessionProof {
  task_id: string;
  short_id: string;
  title: string;
  href: string;
  strength: ProofStrength;
  /** card: a looks-done card was made or updated. note: only a note on the task. security: shown with proof, closed by hand. */
  decision: 'card' | 'note';
  security: boolean;
  lines: string[];
}

export type SessionEvidenceResult =
  | { skipped: 'home_off' }
  | {
      skipped?: undefined;
      written: number;
      duplicates: number;
      outside_window: number;
      unmatched: number;
      unlinked: boolean;
      proofs: SessionProof[];
    };

interface TaskRow {
  id: string;
  title: string;
  status: string;
  tags: string[];
  client_visible: boolean;
  assignee_id: string | null;
  project_id: string | null;
  description: unknown;
  requirements: unknown;
  review_requirements: unknown;
  created_at: Date;
  updated_at: Date;
}

const TASK_SELECT = { id: true, title: true, status: true, tags: true, client_visible: true, assignee_id: true, project_id: true, description: true, requirements: true, review_requirements: true, created_at: true, updated_at: true } as const;

/** The segments of a session: one per active link, with the folders and repository of the work it is attached to. */
export async function loadSegments(db: Db, ref: string): Promise<(Segment & { tasks: TaskRow[] })[]> {
  const links = await db.workLink.findMany({ where: { kind: 'session', ref, state: 'active' }, orderBy: { created_at: 'asc' } });
  const out: (Segment & { tasks: TaskRow[] })[] = [];
  for (const l of links) {
    let projectId = l.project_id;
    let tasks: TaskRow[] = [];
    if (l.task_id) {
      const t = await db.task.findFirst({ where: { id: l.task_id, is_deleted: false }, select: TASK_SELECT });
      if (t) {
        tasks = [t as TaskRow];
        projectId = projectId ?? t.project_id;
      }
    } else if (l.project_id) {
      tasks = (await db.task.findMany({ where: { project_id: l.project_id, is_deleted: false, status: { in: OPEN_STATUSES as never[] } }, select: TASK_SELECT, take: 400 })) as TaskRow[];
    }
    const project = projectId ? await db.project.findFirst({ where: { id: projectId, is_deleted: false }, select: { plan_folder: true, site: { select: { repo_url: true } } } }) : null;
    const folders = [cleanPath(project?.plan_folder), ...cwdsOf(l.context).map(cleanPath)].filter((x): x is string => !!x);
    out.push({ link_id: l.id, target_key: l.target_key, project_id: projectId, task_id: l.task_id, folders, repos: project?.site?.repo_url ? [project.site.repo_url] : [], tasks });
  }
  return out;
}

const mayBeOffered = (t: TaskRow, ownerId: string): boolean => OPEN_STATUSES.includes(t.status) && (!t.assignee_id || t.assignee_id === ownerId || BOT_USER_IDS.includes(t.assignee_id));

export async function recordSessionEvidence(db: PrismaClient, ref: string, body: SessionEvidenceBody, now: Date): Promise<SessionEvidenceResult> {
  const owner = await homeOwner(db);
  if (!owner) return { skipped: 'home_off' };
  const result = { written: 0, duplicates: 0, outside_window: 0, unmatched: 0, unlinked: false, proofs: [] as SessionProof[] };

  const segments = await loadSegments(db, ref);
  if (segments.length === 0) {
    result.unlinked = true;
    result.unmatched = body.items.length;
    await db.oracleSession.updateMany({ where: { external_id: ref }, data: { close_pass_at: now } });
    return result;
  }

  // task id -> its matches in this report
  const matches = new Map<string, { task: TaskRow; link_id: string; hits: { item: SessionItem; strength: ProofStrength }[] }>();
  for (const item of body.items) {
    if (!inWindow(item.at, body.window)) {
      result.outside_window += 1;
      continue;
    }
    let matched = false;
    for (const seg of segments) {
      if (!inSegment(item, seg)) continue;
      for (const task of seg.tasks) {
        const strength = matchItem(item, { id: task.id, title: task.title, text: plainTaskText(task.description, task.requirements, task.review_requirements) });
        if (!strength) continue;
        const m = matches.get(task.id) ?? { task, link_id: seg.link_id, hits: [] };
        if (!m.hits.some((h) => h.item.kind === item.kind && h.item.ref === item.ref)) m.hits.push({ item, strength });
        matches.set(task.id, m);
        matched = true;
      }
    }
    if (!matched) result.unmatched += 1;
  }

  const held = await heldTasks(db, owner.id, now);
  const runKey = sessionRunKey(ref);
  for (const m of matches.values()) {
    const t = m.task;
    const key = `task:${t.id}`;
    for (const h of m.hits) {
      const line = evidenceLine(proofLineOf(h.item, h.strength));
      const r = await db.workEvidence.createMany({
        data: [{
          target_key: key,
          project_id: t.project_id,
          task_id: t.id,
          link_id: m.link_id,
          kind: h.item.kind,
          ref: clip(h.item.ref, 300),
          at: h.item.at,
          line,
          href: null,
          source: h.strength === 'strong' ? SESSION_EVIDENCE_SOURCE : SESSION_EVIDENCE_SOURCE_WEAK,
          session_id: clip(ref, 255),
          dedupe_key: clip(`${key}|${h.item.kind}|${h.item.ref}|${h.item.at.toISOString()}|s:${ref}`, 400),
        }],
        skipDuplicates: true,
      });
      if (r.count === 1) result.written += 1;
      else result.duplicates += 1;
    }
    if (held.has(t.id) || !mayBeOffered(t, owner.id)) continue;
    const strong = m.hits.some((h) => h.strength === 'strong');
    const lines = m.hits.map((h) => evidenceLine(proofLineOf(h.item, h.strength)));
    const security = isSecurityTagged(t.tags);
    const proof: SessionProof = { task_id: t.id, short_id: shortIdOf(t.id), title: displayText(t.title), href: workHref('task', t.id), strength: strong ? 'strong' : 'medium', decision: strong ? 'card' : 'note', security, lines };
    if (strong) {
      await upsertSessionItem(db, owner.id, runKey, t, m.hits, now);
    } else {
      await writePartialNote(db, t.id, lines[0] ?? '', owner.id);
    }
    result.proofs.push(proof);
  }
  await db.oracleSession.updateMany({ where: { external_id: ref }, data: { close_pass_at: now } });
  return result;
}

async function upsertSessionItem(db: PrismaClient, userId: string, runKey: string, t: TaskRow, hits: { item: SessionItem; strength: ProofStrength }[], now: Date): Promise<void> {
  const grp = groupFor({ id: t.id, title: t.title, tags: t.tags, client_visible: t.client_visible, requirements: t.requirements, review_requirements: t.review_requirements });
  const evidence: EvidenceLine[] = hits.map((h) => ({ kind: h.item.kind, line: evidenceLine(proofLineOf(h.item, h.strength)), href: `/tasks/${t.id}`, at: h.item.at.toISOString() }));
  // The ref rides in the line; the kind is what proofWords reads.
  const existing = await db.workFinishedItem.findUnique({ where: { user_id_run_key_task_id: { user_id: userId, run_key: runKey, task_id: t.id } } });
  if (!existing) {
    await db.workFinishedItem.create({ data: { user_id: userId, run_key: runKey, task_id: t.id, grp, strength: 'strong', evidence: evidence as never, created_at: now } });
    return;
  }
  if (existing.state !== 'open') return;
  const old = Array.isArray(existing.evidence) ? (existing.evidence as unknown as EvidenceLine[]) : [];
  const have = new Set(old.map((e) => e.line));
  const merged = [...old, ...evidence.filter((e) => !have.has(e.line))].slice(0, 12);
  await db.workFinishedItem.update({ where: { id: existing.id }, data: { grp, evidence: merged as never } });
}

async function writePartialNote(db: PrismaClient, taskId: string, line: string, ownerId: string): Promise<void> {
  const content = partialNote(line);
  // The note is Bast's. A database with no Bast user (a scratch copy) takes the owner as its author.
  const bast = await db.user.findUnique({ where: { id: BAST_USER_ID }, select: { id: true } });
  const authorId = bast ? BAST_USER_ID : ownerId;
  const have = await db.comment.findFirst({ where: { task_id: taskId, user_id: authorId, is_internal: true, content }, select: { id: true } });
  if (have) return;
  await db.comment.create({ data: { task_id: taskId, user_id: authorId, content, is_internal: true } });
}

// ----------------------------------------------------------------------------
// POST /api/oracle/sessions/:id/close-task
// ----------------------------------------------------------------------------

export type CloseRefusal = 'no_proof' | 'security' | 'unticked' | 'not_linked';

export class SessionCloseRefused extends ApiError {
  constructor(public readonly reason: CloseRefusal) {
    super(CLOSE_MESSAGES[reason], 409, reason);
  }
}

export type SessionCloseResult =
  | { skipped: 'home_off' }
  | { skipped?: undefined; closed: boolean; already_done?: boolean; task_id: string; action_id: string | null; message: string };

/**
 * Close one task on the owner's yes, said in the session. The order of the refusals is fixed: a security task first (always), then
 * "this session is not linked to it", then an unticked checklist item, then no proof. Proof is a code-recorded commit or delivered
 * file for THIS task in THIS session; the session's word that it is done is never proof. The close goes through patchTask (so Stage A
 * closes the linked emails), writes one Handled line with Undo, and marks the task's looks-done rows closed.
 */
export async function closeTaskFromSession(db: PrismaClient, ref: string, taskId: string, now: Date): Promise<SessionCloseResult> {
  const owner = await homeOwner(db);
  if (!owner) return { skipped: 'home_off' };
  const t = await db.task.findFirst({ where: { id: taskId, is_deleted: false }, select: { id: true, title: true, status: true, tags: true, client_visible: true, assignee_id: true, project_id: true, requirements: true, review_requirements: true, updated_at: true } });
  if (!t) throw new ApiError('That task does not exist.', 404, 'not_found');
  if (isSecurityTagged(t.tags)) throw new SessionCloseRefused('security');
  if (t.status === 'done') return { closed: false, already_done: true, task_id: t.id, action_id: null, message: 'It is already done.' };
  if (!OPEN_STATUSES.includes(t.status)) throw new SessionCloseRefused('not_linked');
  if (t.assignee_id && t.assignee_id !== owner.id && !BOT_USER_IDS.includes(t.assignee_id)) throw new SessionCloseRefused('not_linked');

  const links = await db.workLink.findMany({ where: { kind: 'session', ref, state: 'active', OR: [{ target_key: `task:${t.id}` }, ...(t.project_id ? [{ target_key: `project:${t.project_id}` }] : [])] }, select: { id: true } });
  if (links.length === 0) throw new SessionCloseRefused('not_linked');
  if (hasUnticked(t)) throw new SessionCloseRefused('unticked');
  // Strong proof only: a title overlap is a note on the task, never enough to close it.
  const proof = await db.workEvidence.findMany({ where: { session_id: ref, task_id: t.id, kind: { in: ['commit', 'delivered_file'] }, source: SESSION_EVIDENCE_SOURCE }, orderBy: { at: 'desc' }, take: 10, select: { kind: true, ref: true, line: true } });
  if (proof.length === 0) throw new SessionCloseRefused('no_proof');

  const actor = await ownerActor(db, owner.id);
  let res: Awaited<ReturnType<typeof patchTask>>;
  try {
    res = await patchTask({ actor, id: t.id, body: { status: 'done' }, expect: { status: t.status as never, updated_at: t.updated_at, assignee_id: t.assignee_id } });
  } catch {
    throw new ApiError('That task changed while it was being closed. It stays open.', 409, 'changed_since');
  }
  if (!res.ok) throw new ApiError('That task changed while it was being closed. It stays open.', 409, 'changed_since');
  const line = proof[0].line;
  await db.comment.create({ data: { task_id: t.id, user_id: owner.id, content: sessionCloseComment(line), is_internal: true } });
  const after = await db.task.findUnique({ where: { id: t.id }, select: { updated_at: true } });

  const runKey = sessionRunKey(ref);
  const grp = groupFor(t);
  const ev: EvidenceLine[] = proof.map((p) => ({ kind: p.kind === 'commit' ? ('commit' as const) : ('delivered_file' as const), line: p.line, href: `/tasks/${t.id}`, at: null }));
  const item = await db.workFinishedItem.upsert({
    where: { user_id_run_key_task_id: { user_id: owner.id, run_key: runKey, task_id: t.id } },
    create: { user_id: owner.id, run_key: runKey, task_id: t.id, grp, strength: 'strong', evidence: ev as never, state: 'closed', resolved_at: now },
    update: { state: 'closed', resolved_at: now },
  });
  // Any other open row for this task (another session's card) is answered too.
  await db.workFinishedItem.updateMany({ where: { user_id: owner.id, task_id: t.id, state: 'open' }, data: { state: 'closed', resolved_at: now } });

  const rec: FinishedCloseRecord = {
    kind: 'finished_close',
    started_at: now.toISOString(),
    items: [{ item_id: item.id, task_id: t.id, status_before: t.status, updated_after: (after?.updated_at ?? new Date()).toISOString() }],
    ask_action_ids: await stageALines(db, owner.id, [t.id], now),
  };
  const message = `Closed "${displayText(t.title) || 'a task'}" from a session.`;
  const undoUntil = new Date(now.getTime() + FINISHED_UNDO_HOURS * HOUR_MS);
  const row = await appendHomeAction(db, owner.id, {
    item_key: null,
    action: 'finished_close',
    source: 'keeper',
    before: { states: [], finished: rec },
    after: { states: [], finished: rec, line: message, details: [`${displayText(line)} /tasks/${t.id}`], href: null },
    undo_until: undoUntil,
  });
  await db.workFinishedItem.update({ where: { id: item.id }, data: { home_action_id: row.id } });
  return { closed: true, task_id: t.id, action_id: row.id, message };
}

// ----------------------------------------------------------------------------
// What the home screen shows: one looks-done card per session
// ----------------------------------------------------------------------------

/**
 * The owner's open session rows, grouped by session (run key). A card waits SESSION_CARD_DELAY_HOURS for an in-session answer while its
 * session is still open; a session that has ended, gone stale or is not known shows its card at once. A row whose task was closed,
 * deleted, reassigned or turned into something a session may not offer is left out (the row itself is untouched: this is a read).
 * A security row is shown with its proof and never closable from here.
 */
export async function loadSessionFinishedCards(db: Db, userId: string, now: Date): Promise<RawSessionFinishedCard[]> {
  const items = await db.workFinishedItem.findMany({ where: { user_id: userId, state: 'open', run_key: { startsWith: 'session:' } }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }], take: 500 });
  if (items.length === 0) return [];
  const tasks = await db.task.findMany({ where: { id: { in: Array.from(new Set(items.map((i) => i.task_id))) } }, select: { id: true, title: true, status: true, is_deleted: true, assignee_id: true, tags: true, client_visible: true, requirements: true, review_requirements: true } });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const byRun = new Map<string, typeof items>();
  for (const it of items) byRun.set(it.run_key, [...(byRun.get(it.run_key) ?? []), it]);

  // The sessions behind the run keys: a run key `session:<id>` names the external id (a long id is hashed, and is then always shown).
  const refs = Array.from(byRun.keys()).filter((k) => !k.startsWith('session:h-')).map((k) => k.slice('session:'.length));
  const sessions = refs.length ? await db.oracleSession.findMany({ where: { external_id: { in: refs } }, select: { external_id: true, status: true, archived_at: true } }) : [];
  const live = new Set(sessions.filter((s) => !s.archived_at && ['running', 'waiting', 'idle'].includes(s.status)).map((s) => s.external_id));
  const cutoff = new Date(now.getTime() - SESSION_CARD_DELAY_HOURS * HOUR_MS);

  const cards: RawSessionFinishedCard[] = [];
  for (const [runKey, list] of byRun) {
    const ref = runKey.slice('session:'.length);
    const waiting = live.has(ref) && list.every((i) => i.created_at.getTime() > cutoff.getTime());
    if (waiting) continue;
    const rows: HomeFinishedRow[] = [];
    const summary: { title: string; proof: string }[] = [];
    for (const it of list) {
      const t = byId.get(it.task_id);
      if (!t || t.is_deleted || !OPEN_STATUSES.includes(t.status)) continue;
      if (t.assignee_id && t.assignee_id !== userId && !BOT_USER_IDS.includes(t.assignee_id)) continue;
      const ev = Array.isArray(it.evidence) ? (it.evidence as unknown as EvidenceLine[]) : [];
      const group = groupFor(t) as FinishedGroup;
      rows.push({
        key: `finished:${it.id}`,
        task_id: t.id,
        title: t.title,
        href: `/tasks/${t.id}`,
        group,
        strength: it.strength as HomeFinishedRow['strength'],
        ticked: tickedByDefault(group, it.strength),
        evidence: ev.map((e) => ({ line: e.line, href: e.href ?? null })),
        ...(group === 'security' ? { close_on_task_page: true } : {}),
      });
      summary.push({ title: t.title, proof: proofWords(ev.map((e) => ({ kind: e.kind, ref: e.line.replace(/^Commit ([0-9a-f]+).*/i, '$1') }))) });
    }
    if (rows.length === 0) continue;
    cards.push({ key: sessionCardKey(runKey), rows, others: [], since: list[0].created_at, summary });
  }
  cards.sort((a, b) => a.since.getTime() - b.since.getTime() || a.key.localeCompare(b.key));
  return cards;
}

/** True for a group a single tap may close from the session card (security rows never are). */
export const sessionRowClosableByTap = (group: string): boolean => ONE_TAP_GROUPS.includes(group) && group !== 'security';

