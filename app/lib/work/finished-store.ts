/**
 * Work stage G: the database side of the one-time looks-finished sweep.
 *
 *   runSweep           reads open tasks and the evidence around them and (unless dry) writes WorkFinishedItem rows. It never
 *                      closes, changes or comments on a task, and sends and drafts nothing.
 *   loadFinishedCard   what the home screen shows: the open rows whose tasks still look as they did. Read only.
 *   finishedClose      his tap on "Close the ticked ones": main and orphan rows only, through patchTask (so Stage A's closure runs).
 *   finishedCloseOne   his tap on one security or portal row.
 *   finishedKeep       "Not finished": the row leaves the card and is not offered again for 90 days.
 *   undoFinishedClose  Undo: puts back exactly the tasks still done and unchanged since, and reopens the emails Stage A closed.
 *
 * Owner only: with no home owner on the home view every function answers skipped and writes nothing.
 */

import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { patchTask } from '@/lib/services/task-patch';
import { ownerActor } from '@/lib/home/reconcile/actor';
import { appendHomeAction, markHomeActionUndone, type HomeDb } from '@/lib/home/state';
import { parseItemKey } from '@/lib/home/item-key';
import type { HomeActResponse, HomeFinishedRow, RawFinishedCard } from '@/lib/home/types';
import { homeOwner, readWorkCloseRecord, undoWorkClose, type WorkCloseRecord } from './ask-closure';
import { closeComment, closedLine, closedOneLine, FINISHED_MESSAGES, skippedLine } from './finished-copy';
import {
  BATCH_GROUPS,
  EDIT_QUIET_HOURS,
  KEEP_DAYS,
  MACHINE_KINDS,
  ONE_TAP_GROUPS,
  OPEN_STATUSES,
  eligibility,
  groupFor,
  judge,
  tickedByDefault,
  type EvidenceLine,
  type FinishedGroup,
  type MachineKind,
  type Signals,
  type TaskFacts,
} from './finished';

export const FINISHED_ACTION = 'finished_close';
export const FINISHED_KEEP_ACTION = 'finished_keep';
export const FINISHED_UNDO_HOURS = 72;
export const KEEP_UNDO_HOURS = 24;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const CHUNK = 500;
const TASK_TAKE = 5000;
const BATCH_MAX = 100;
const SAMPLE = 10;

type Db = PrismaClient | Prisma.TransactionClient;

// ----------------------------------------------------------------------------
// The route body
// ----------------------------------------------------------------------------

export const machineEvidenceSchema = z
  .object({
    task_id: z.string().uuid(),
    kind: z.enum(MACHINE_KINDS),
    ref: z.string().min(1).max(200),
    at: z.string().datetime({ offset: true }),
  })
  .strict();

export const finishedBodySchema = z
  .object({
    dry: z.boolean(),
    machine_evidence: z.array(machineEvidenceSchema).max(5000).default([]),
  })
  .strict();
export type FinishedBody = z.infer<typeof finishedBodySchema>;
export const FINISHED_BODY_BYTES = 1024 * 1024;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function chunks<T>(xs: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function runKeyFor(now: Date, zone: string): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return `sweep-${d}`;
}

function evidenceJson(v: unknown): EvidenceLine[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is EvidenceLine => !!e && typeof e === 'object' && typeof (e as EvidenceLine).line === 'string');
}

/** Tasks the owner said are not finished (or undid) within 90 days: never offered again. */
export async function heldTasks(db: Db, userId: string, now: Date): Promise<Set<string>> {
  const rows = await db.workFinishedItem.findMany({
    where: { user_id: userId, state: { in: ['kept', 'undone'] }, resolved_at: { gt: new Date(now.getTime() - KEEP_DAYS * DAY_MS) } },
    select: { task_id: true },
  });
  return new Set(rows.map((r) => r.task_id));
}

// ----------------------------------------------------------------------------
// The sweep
// ----------------------------------------------------------------------------

export interface GroupCount {
  strong: number;
  medium: number;
}

export interface SweepResult {
  dry: boolean;
  skipped?: 'home_off';
  already_open?: boolean;
  run_key?: string;
  total: number;
  counts: Record<FinishedGroup, GroupCount>;
  /** Tasks assigned to other people that look finished (counted, never listed or closed). */
  others: { name: string; count: number }[];
  sample: string[];
  created: number;
}

const emptyCounts = (): Record<FinishedGroup, GroupCount> => ({
  main: { strong: 0, medium: 0 },
  security: { strong: 0, medium: 0 },
  portal: { strong: 0, medium: 0 },
  unticked: { strong: 0, medium: 0 },
  orphan: { strong: 0, medium: 0 },
});

/** Gather every signal for these tasks, in bulk. Reads only. */
async function gatherSignals(db: Db, ownerId: string, tasks: TaskFacts[], requesters: Map<string, string | null>, machine: FinishedBody['machine_evidence'], now: Date): Promise<Map<string, Signals>> {
  const ids = tasks.map((t) => t.id);
  const out = new Map<string, Signals>(ids.map((id) => [id, { receipts: [], machine: [], reconcile: [], calendar: [], contact_emails: [], contact_names: [], asks: [], outbox_sent: [], later_done: [] }]));
  const get = (id: string) => out.get(id) as Signals;

  for (const m of machine) {
    const s = out.get(m.task_id);
    if (s) s.machine.push({ kind: m.kind as MachineKind, ref: m.ref, at: new Date(m.at) });
  }

  const threadsByTask = new Map<string, Set<string>>();
  for (const part of chunks(ids)) {
    const receipts = await db.taskReceipt.findMany({
      where: { task_id: { in: part }, OR: [{ step: 'live' }, { live_url: { not: null } }] },
      select: { task_id: true, step: true, live_url: true, created_at: true },
    });
    for (const r of receipts) get(r.task_id).receipts.push({ step: r.step, live_url: r.live_url, created_at: r.created_at });

    const rec = await db.homeReconcileChange.findMany({
      where: { user_id: ownerId, target_key: { in: part.map((i) => `task:${i}`) }, kind: { in: ['done', 'note'] }, quote: { not: null } },
      select: { target_key: true, kind: true, mode: true, state: true, quote: true, quote_to: true, quote_at: true, link: true },
    });
    for (const r of rec) {
      const id = (r.target_key ?? '').slice(5);
      if (out.has(id)) get(id).reconcile.push({ kind: r.kind, mode: r.mode, state: r.state, quote: r.quote, quote_to: r.quote_to, quote_at: r.quote_at, link: r.link });
    }

    const asks = await db.emailAsk.findMany({ where: { task_id: { in: part } }, select: { task_id: true, state: true, closed_reason: true, received_at: true, thread_id: true } });
    for (const a of asks) {
      if (!a.task_id) continue;
      get(a.task_id).asks.push({ state: a.state, closed_reason: a.closed_reason, received_at: a.received_at });
      if (a.thread_id) {
        if (!threadsByTask.has(a.task_id)) threadsByTask.set(a.task_id, new Set());
        (threadsByTask.get(a.task_id) as Set<string>).add(a.thread_id);
      }
    }
  }

  // Our side's sent mail: rows for the task, or in one of its threads.
  const allThreads = Array.from(new Set(Array.from(threadsByTask.values()).flatMap((s) => Array.from(s))));
  const withAsks = ids.filter((id) => get(id).asks.length > 0);
  for (const part of chunks(withAsks)) {
    const sent = await db.emailOutbox.findMany({ where: { sent_at: { not: null }, task_id: { in: part } }, select: { task_id: true, sent_at: true } });
    for (const o of sent) if (o.task_id && o.sent_at) get(o.task_id).outbox_sent.push(o.sent_at);
  }
  for (const part of chunks(allThreads)) {
    const sent = await db.emailOutbox.findMany({ where: { sent_at: { not: null }, gmail_thread_id: { in: part } }, select: { gmail_thread_id: true, sent_at: true } });
    for (const o of sent) {
      if (!o.sent_at || !o.gmail_thread_id) continue;
      for (const [taskId, set] of threadsByTask) if (set.has(o.gmail_thread_id)) get(taskId).outbox_sent.push(o.sent_at);
    }
  }

  // Meetings: the contacts of the task's client and its requester, and the events that have ended.
  const meetingTasks = tasks.filter((t) => /\b(call|meeting|meet|zoom|interview|walkthrough|kickoff)\b/i.test(`${t.title} ${t.tags.join(' ')}`));
  if (meetingTasks.length > 0) {
    const clientIds = Array.from(new Set(meetingTasks.map((t) => t.client_id).filter((x): x is string => !!x)));
    const contactIds = Array.from(new Set(meetingTasks.map((t) => requesters.get(t.id)).filter((x): x is string => !!x)));
    const contacts = await db.clientContact.findMany({
      where: { is_deleted: false, OR: [{ client_id: { in: clientIds } }, { id: { in: contactIds } }] },
      select: { id: true, client_id: true, email: true, name: true },
    });
    const oldest = new Date(Math.min(...meetingTasks.map((t) => t.created_at.getTime())));
    const events = await db.calendarEvent.findMany({ where: { ends_at: { lte: now, gt: oldest } }, select: { title: true, ends_at: true, attendees: true }, orderBy: { ends_at: 'desc' }, take: 3000 });
    const evs = events.map((e) => {
      const list = Array.isArray(e.attendees) ? (e.attendees as { email?: unknown; display_name?: unknown; self?: unknown }[]) : [];
      const guests = list.filter((a) => a && a.self !== true);
      return {
        title: e.title,
        ends_at: e.ends_at,
        attendee_emails: guests.map((a) => (typeof a.email === 'string' ? a.email.toLowerCase() : '')).filter(Boolean),
        attendee_names: guests.map((a) => (typeof a.display_name === 'string' ? a.display_name : '')),
      };
    });
    for (const t of meetingTasks) {
      const s = get(t.id);
      const mine = contacts.filter((c) => (t.client_id && c.client_id === t.client_id) || c.id === requesters.get(t.id));
      s.contact_emails = mine.map((c) => c.email).filter((e): e is string => !!e);
      s.contact_names = mine.map((c) => c.name).filter((n): n is string => !!n);
      s.calendar = evs;
    }
  }

  // Later done tasks of the same client.
  const clientIds = Array.from(new Set(tasks.map((t) => t.client_id).filter((x): x is string => !!x)));
  if (clientIds.length > 0) {
    const oldest = new Date(Math.min(...tasks.map((t) => t.created_at.getTime())));
    const done = await db.task.findMany({
      where: { client_id: { in: clientIds }, is_deleted: false, status: 'done', completed_at: { gt: oldest } },
      select: { id: true, title: true, client_id: true, completed_at: true },
      take: 20000,
    });
    const byClient = new Map<string, { id: string; title: string; completed_at: Date }[]>();
    for (const d of done) {
      if (!d.client_id || !d.completed_at) continue;
      if (!byClient.has(d.client_id)) byClient.set(d.client_id, []);
      (byClient.get(d.client_id) as { id: string; title: string; completed_at: Date }[]).push({ id: d.id, title: d.title, completed_at: d.completed_at });
    }
    for (const t of tasks) if (t.client_id) get(t.id).later_done = byClient.get(t.client_id) ?? [];
  }
  return out;
}

/**
 * The sweep. `dry` reads and counts and writes nothing. Without `dry` it makes the rows once; while open rows exist it answers
 * already_open and writes nothing. It never changes a task.
 */
export async function runSweep(db: PrismaClient, body: FinishedBody, now: Date): Promise<SweepResult> {
  const empty: SweepResult = { dry: body.dry, total: 0, counts: emptyCounts(), others: [], sample: [], created: 0 };
  const owner = await homeOwner(db);
  if (!owner) return { ...empty, skipped: 'home_off' };

  // Work stage E: a session's own looks-done rows are not the sweep's list.
  const open = await db.workFinishedItem.count({ where: { user_id: owner.id, state: 'open', NOT: { run_key: { startsWith: 'session:' } } } });
  if (open > 0 && !body.dry) return { ...empty, already_open: true };

  const held = await heldTasks(db, owner.id, now);
  const cutoff = new Date(now.getTime() - EDIT_QUIET_HOURS * HOUR_MS);
  const rows = await db.task.findMany({
    where: { is_deleted: false, status: { in: OPEN_STATUSES as never[] }, updated_at: { lt: cutoff }, ...(held.size > 0 ? { id: { notIn: Array.from(held) } } : {}) },
    select: {
      id: true,
      title: true,
      status: true,
      tags: true,
      client_visible: true,
      assignee_id: true,
      created_at: true,
      updated_at: true,
      is_deleted: true,
      requirements: true,
      review_requirements: true,
      client_id: true,
      requested_by_contact_id: true,
      project: { select: { id: true, name: true, status: true } },
      assignee: { select: { name: true } },
    },
    orderBy: { updated_at: 'asc' },
    take: TASK_TAKE,
  });
  const facts: TaskFacts[] = [];
  const requesters = new Map<string, string | null>();
  const assigneeName = new Map<string, string>();
  const eligible = new Map<string, 'ok' | 'other_user'>();
  for (const r of rows) {
    const f: TaskFacts = { id: r.id, title: r.title, status: r.status, tags: r.tags, client_visible: r.client_visible, assignee_id: r.assignee_id, created_at: r.created_at, updated_at: r.updated_at, is_deleted: r.is_deleted, requirements: r.requirements, review_requirements: r.review_requirements, project: r.project, client_id: r.client_id };
    const e = eligibility(f, owner.id, BOT_USER_IDS, now);
    if (e === 'skip') continue;
    facts.push(f);
    eligible.set(f.id, e);
    requesters.set(f.id, r.requested_by_contact_id);
    if (r.assignee?.name) assigneeName.set(f.id, r.assignee.name);
  }

  const signals = await gatherSignals(db, owner.id, facts, requesters, body.machine_evidence, now);
  const counts = emptyCounts();
  const others = new Map<string, number>();
  const run_key = runKeyFor(now, owner.timezone);
  const toMake: Prisma.WorkFinishedItemCreateManyInput[] = [];
  const titles: string[] = [];
  for (const f of facts) {
    const verdict = judge(f, signals.get(f.id) as Signals, now, owner.timezone);
    if (!verdict) continue;
    if (eligible.get(f.id) === 'other_user') {
      const n = assigneeName.get(f.id) ?? 'another person';
      others.set(n, (others.get(n) ?? 0) + 1);
      toMake.push({ user_id: owner.id, run_key, task_id: f.id, grp: 'others', strength: verdict.strength, evidence: verdict.evidence as never });
      continue;
    }
    counts[verdict.group][verdict.strength] += 1;
    if (titles.length < SAMPLE) titles.push(f.title);
    toMake.push({ user_id: owner.id, run_key, task_id: f.id, grp: verdict.group, strength: verdict.strength, evidence: verdict.evidence as never });
  }
  const total = Object.values(counts).reduce((n, c) => n + c.strong + c.medium, 0);
  const othersList = Array.from(others, ([name, count]) => ({ name, count }));
  let created = 0;
  if (!body.dry && toMake.length > 0) {
    for (const part of chunks(toMake, 200)) created += (await db.workFinishedItem.createMany({ data: part, skipDuplicates: true })).count;
  }
  return { dry: body.dry, run_key, total, counts, others: othersList, sample: titles, created };
}

// ----------------------------------------------------------------------------
// What the home screen shows
// ----------------------------------------------------------------------------

/**
 * The owner's open rows. A row whose task was closed, deleted, reassigned to another person, or edited since the list was made
 * is left out of the view (the row itself is untouched: this is a read). Null when there is nothing to show.
 */
export async function loadFinishedCard(db: Db, userId: string): Promise<RawFinishedCard | null> {
  const items = await db.workFinishedItem.findMany({ where: { user_id: userId, state: 'open', NOT: { run_key: { startsWith: 'session:' } } }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }], take: 2000 });
  if (items.length === 0) return null;
  const tasks = await db.task.findMany({
    where: { id: { in: items.map((i) => i.task_id) } },
    select: { id: true, title: true, status: true, is_deleted: true, updated_at: true, assignee_id: true, assignee: { select: { name: true } } },
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows: HomeFinishedRow[] = [];
  const others = new Map<string, number>();
  let since = items[0].created_at;
  for (const it of items) {
    const t = byId.get(it.task_id);
    if (!t || t.is_deleted || !OPEN_STATUSES.includes(t.status) || t.updated_at.getTime() > it.created_at.getTime()) continue;
    if (it.grp === 'others') {
      const n = t.assignee?.name ?? 'another person';
      others.set(n, (others.get(n) ?? 0) + 1);
      continue;
    }
    if (it.created_at.getTime() > since.getTime()) since = it.created_at;
    const ev = evidenceJson(it.evidence);
    rows.push({
      key: `finished:${it.id}`,
      task_id: t.id,
      title: t.title,
      href: `/tasks/${t.id}`,
      group: it.grp as HomeFinishedRow['group'],
      strength: it.strength as HomeFinishedRow['strength'],
      ticked: tickedByDefault(it.grp, it.strength),
      evidence: ev.map((e) => ({ line: e.line, href: e.href ?? null })),
    });
  }
  if (rows.length === 0) return null;
  return { rows, others: Array.from(others, ([name, count]) => ({ name, count })), since: items[0].created_at };
}

// ----------------------------------------------------------------------------
// The taps
// ----------------------------------------------------------------------------

/** The record the close line stores, so Undo can put back exactly what this tap did. */
export interface FinishedCloseRecord {
  kind: 'finished_close';
  started_at: string;
  items: { item_id: string; task_id: string; status_before: string; updated_after: string }[];
  /** Stage A's own work_close lines this close caused. Undo reopens their emails and marks them undone. */
  ask_action_ids: string[];
}

export function readFinishedRecord(v: unknown): FinishedCloseRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = (v as { finished?: unknown }).finished as Partial<FinishedCloseRecord> | undefined;
  if (!r || r.kind !== 'finished_close' || !Array.isArray(r.items)) return null;
  return { ...(r as FinishedCloseRecord), ask_action_ids: Array.isArray(r.ask_action_ids) ? r.ask_action_ids : [] };
}

function keyToItemId(key: string): string | null {
  const p = parseItemKey(key);
  return p && p.kind === 'finished' && p.id ? p.id : null;
}

type ItemRow = Awaited<ReturnType<typeof loadItems>>[number];

async function loadItems(db: Db, userId: string, ids: string[]) {
  return db.workFinishedItem.findMany({ where: { id: { in: ids }, user_id: userId } });
}

/** Close one item through patchTask. Returns the task's new updated_at, or why it was left open. */
async function closeOneTask(db: PrismaClient, userId: string, it: ItemRow, mode: 'batch' | 'one'): Promise<{ ok: true; updated_after: Date; status_before: string; line: string } | { ok: false }> {
  if (it.state !== 'open') return { ok: false };
  if (mode === 'batch' && !BATCH_GROUPS.includes(it.grp)) return { ok: false };
  if (mode === 'one' && !ONE_TAP_GROUPS.includes(it.grp)) return { ok: false };
  // Work stage E: a security task a session found proof for is closed by the owner on its own task page, never from the card.
  if (it.run_key.startsWith('session:') && it.grp === 'security') return { ok: false };
  const t = await db.task.findUnique({
    where: { id: it.task_id },
    select: { id: true, status: true, is_deleted: true, updated_at: true, assignee_id: true, tags: true, client_visible: true, requirements: true, review_requirements: true, title: true, created_at: true, client_id: true, project: { select: { id: true, name: true, status: true } } },
  });
  if (!t || t.is_deleted || !OPEN_STATUSES.includes(t.status)) return { ok: false };
  if (t.updated_at.getTime() > it.created_at.getTime()) return { ok: false };
  if (t.assignee_id && t.assignee_id !== userId && !BOT_USER_IDS.includes(t.assignee_id)) return { ok: false };
  // Re-check the group now: a task that turned security-tagged, portal-visible or unticked since the list was made is not closed in a batch,
  // and an unticked task is never closed by this path.
  const nowGroup = groupFor(t);
  if (nowGroup === 'unticked') return { ok: false };
  if (mode === 'batch' && (nowGroup === 'security' || nowGroup === 'portal')) return { ok: false };
  if (mode === 'one' && nowGroup !== it.grp && nowGroup !== 'security' && nowGroup !== 'portal') return { ok: false };
  const ev = evidenceJson(it.evidence);
  const actor = await ownerActor(db, userId);
  let res: Awaited<ReturnType<typeof patchTask>>;
  try {
    res = await patchTask({ actor, id: t.id, body: { status: 'done' }, expect: { status: t.status as never, updated_at: t.updated_at, assignee_id: t.assignee_id } });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false };
  await db.comment.create({ data: { task_id: t.id, user_id: userId, content: closeComment(ev[0]?.line ?? 'it looked finished'), is_internal: true } });
  const after = await db.task.findUnique({ where: { id: t.id }, select: { updated_at: true } });
  return { ok: true, updated_after: after?.updated_at ?? new Date(), status_before: t.status, line: ev[0]?.line ?? '' };
}

/** Stage A's Handled lines the closes just wrote (emails closed with those tasks), so Undo can reopen them. */
export async function stageALines(db: Db, userId: string, taskIds: readonly string[], since: Date): Promise<string[]> {
  const rows = await db.homeAction.findMany({ where: { user_id: userId, action: 'work_close', source: 'keeper', undone_at: null, created_at: { gte: since } }, select: { id: true, before: true } });
  const want = new Set(taskIds);
  const out: string[] = [];
  for (const r of rows) {
    const rec = readWorkCloseRecord(r.before);
    if (rec && rec.task_ids.length > 0 && rec.task_ids.every((id) => want.has(id))) out.push(r.id);
  }
  return out;
}

async function writeLine(db: PrismaClient, userId: string, rec: FinishedCloseRecord, line: string, details: string[], itemKey: string | null, now: Date): Promise<HomeActResponse & { undo_until: string }> {
  const undoUntil = new Date(now.getTime() + FINISHED_UNDO_HOURS * HOUR_MS);
  const row = await appendHomeAction(db, userId, {
    item_key: itemKey,
    action: FINISHED_ACTION,
    source: 'keeper',
    before: { states: [], finished: rec },
    after: { states: [], finished: rec, line, details, href: null },
    undo_until: undoUntil,
  });
  await db.workFinishedItem.updateMany({ where: { id: { in: rec.items.map((i) => i.item_id) }, user_id: userId }, data: { home_action_id: row.id } });
  return { ok: true as const, action_id: row.id, undo_until: undoUntil.toISOString(), item_key: itemKey, message: line };
}

function finishedErr(message: string, status = 409, code = 'changed_since'): ApiError {
  return new ApiError(message, status, code);
}

/** The owner's ticked list. Main and orphan rows only: a security, portal or unticked row in it is refused and stays open. */
export async function finishedClose(db: PrismaClient, userId: string, itemKeys: string[], now: Date): Promise<HomeActResponse> {
  if (itemKeys.length > BATCH_MAX) throw finishedErr('Too many at once.', 400, 'too_many');
  const ids = Array.from(new Set(itemKeys.map(keyToItemId))).filter((x): x is string => !!x);
  if (ids.length === 0) throw finishedErr(FINISHED_MESSAGES.gone, 404, 'not_found');
  const items = await loadItems(db, userId, ids);
  if (items.length === 0) throw finishedErr(FINISHED_MESSAGES.gone, 404, 'not_found');
  const rec: FinishedCloseRecord = { kind: 'finished_close', started_at: now.toISOString(), items: [], ask_action_ids: [] };
  const details: string[] = [];
  let skipped = 0;
  const closedAt = new Date();
  for (const it of items) {
    const r = await closeOneTask(db, userId, it, 'batch');
    if (!r.ok) {
      skipped += 1;
      continue;
    }
    rec.items.push({ item_id: it.id, task_id: it.task_id, status_before: r.status_before, updated_after: r.updated_after.toISOString() });
    details.push(`${r.line || 'It looked finished.'} /tasks/${it.task_id}`);
  }
  if (rec.items.length === 0) throw finishedErr(FINISHED_MESSAGES.nothingClosed);
  await db.workFinishedItem.updateMany({ where: { id: { in: rec.items.map((i) => i.item_id) }, user_id: userId, state: 'open' }, data: { state: 'closed', resolved_at: closedAt } });
  rec.ask_action_ids = await stageALines(db, userId, rec.items.map((i) => i.task_id), now);
  const line = closedLine(rec.items.length) + (skipped > 0 ? ` ${skippedLine(skipped)}` : '');
  return writeLine(db, userId, rec, line, details, null, now);
}

/** One tap on one security or portal row. Its own Handled line and Undo. */
export async function finishedCloseOne(db: PrismaClient, userId: string, itemKey: string, now: Date): Promise<HomeActResponse> {
  const id = keyToItemId(itemKey);
  if (!id) throw finishedErr(FINISHED_MESSAGES.gone, 404, 'not_found');
  const [it] = await loadItems(db, userId, [id]);
  if (!it || it.state !== 'open') throw finishedErr(FINISHED_MESSAGES.gone, 404, 'not_found');
  if (!ONE_TAP_GROUPS.includes(it.grp)) throw finishedErr(FINISHED_MESSAGES.notOneTap, 409, 'not_one_tap');
  const task = await db.task.findUnique({ where: { id: it.task_id }, select: { title: true } });
  const r = await closeOneTask(db, userId, it, 'one');
  if (!r.ok) throw finishedErr(FINISHED_MESSAGES.nothingClosed);
  await db.workFinishedItem.updateMany({ where: { id: it.id, user_id: userId, state: 'open' }, data: { state: 'closed', resolved_at: new Date() } });
  const rec: FinishedCloseRecord = {
    kind: 'finished_close',
    started_at: now.toISOString(),
    items: [{ item_id: it.id, task_id: it.task_id, status_before: r.status_before, updated_after: r.updated_after.toISOString() }],
    ask_action_ids: await stageALines(db, userId, [it.task_id], now),
  };
  return writeLine(db, userId, rec, closedOneLine(task?.title ?? ''), [`${r.line || 'It looked finished.'} /tasks/${it.task_id}`], itemKey, now);
}

/** "Not finished": the row leaves the card, and the sweep does not offer the task again for 90 days. */
export async function finishedKeep(db: PrismaClient, userId: string, itemKey: string, now: Date): Promise<HomeActResponse> {
  const id = keyToItemId(itemKey);
  if (!id) throw finishedErr(FINISHED_MESSAGES.gone, 404, 'not_found');
  return db.$transaction(async (tx) => {
    const r = await tx.workFinishedItem.updateMany({ where: { id, user_id: userId, state: 'open', grp: { not: 'others' } }, data: { state: 'kept', resolved_at: now } });
    if (r.count !== 1) throw finishedErr(FINISHED_MESSAGES.gone, 404, 'not_found');
    const undoUntil = new Date(now.getTime() + KEEP_UNDO_HOURS * HOUR_MS);
    const row = await appendHomeAction(tx, userId, {
      item_key: itemKey,
      action: FINISHED_KEEP_ACTION,
      before: { states: [], finished_keep: { item_id: id } },
      after: { states: [], finished_keep: { item_id: id } },
      undo_until: undoUntil,
    });
    return { ok: true as const, action_id: row.id, undo_until: undoUntil.toISOString(), item_key: itemKey, message: FINISHED_MESSAGES.kept };
  });
}

// ----------------------------------------------------------------------------
// Undo (called from runHomeUndo inside its transaction)
// ----------------------------------------------------------------------------

/**
 * Undo of a close line. Each task goes back to its old status only while it is still done and unchanged since the close
 * (compare-and-set through patchTask); the emails Stage A closed with it reopen through Stage A's own undo. A task that changed
 * since stays as it is. Every restored row is marked undone, and the sweep does not offer that task again for 90 days.
 */
export async function undoFinishedClose(db: HomeDb, userId: string, rec: FinishedCloseRecord, now: Date): Promise<{ restored: string[] }> {
  const restored: string[] = [];
  const actor = await ownerActor(db as unknown as PrismaClient, userId);
  for (const it of rec.items) {
    let ok = false;
    try {
      const res = await patchTask({ actor, id: it.task_id, body: { status: it.status_before }, expect: { status: 'done', updated_at: it.updated_after } });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) continue;
    restored.push(it.task_id);
    await db.workFinishedItem.updateMany({ where: { id: it.item_id, user_id: userId }, data: { state: 'undone', resolved_at: now } });
  }
  for (const actionId of rec.ask_action_ids) {
    const row = await db.homeAction.findFirst({ where: { id: actionId, user_id: userId }, select: { before: true } });
    const wc: WorkCloseRecord | null = readWorkCloseRecord(row?.before);
    if (wc && (await markHomeActionUndone(db, userId, actionId, now))) await undoWorkClose(db, userId, wc, now);
  }
  return { restored };
}

/** Undo of "Not finished": the row is on the card again, only while it is still kept. */
export async function undoFinishedKeep(db: HomeDb, userId: string, itemId: string): Promise<void> {
  await db.workFinishedItem.updateMany({ where: { id: itemId, user_id: userId, state: 'kept' }, data: { state: 'open', resolved_at: null } });
}
