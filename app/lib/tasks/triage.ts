/**
 * Triage (operating model S3): the database side of the Triage section on Mike's home screen.
 *
 *   loadTriage    what the section shows: the tasks in status `triage`, grouped by `triage-pass:` tag when they carry one, else by project.
 *                 Only Mike gets anything; every other user gets null.
 *   release       tasks to not_started, one tap. A task on a quote project stays (the project is still a quote).
 *   releasePlan   every triage task in a group in one action. A queue project becomes ready with its plan; a quote project is
 *                 left alone and the tap says so. Dependencies hold the order as they always do (the gate parks a task whose
 *                 blocker is not done); nothing here touches them.
 *   drop          tasks to abandoned.
 *   undoTriage    puts back exactly the tasks still as the tap left them (compare-and-set), for 72 hours.
 *
 * Open questions (lib/tasks/questions.ts) never block a release. Each open question follows its if_nobody_action: `go_with_recommendation`
 * becomes `defaulted` (released without an answer, never his words); `wait` puts `held-for-questions` and `needs-mike` on the card.
 * The tap records which questions and which tags it changed, so Undo restores exactly those.
 *
 * Every task write goes through patchTask (lib/services/task-patch.ts), the one patch path. Its server check (only Mike's own
 * session, or the enforced Bast chat lane, may take a task out of triage) is what authorizes the write; nothing here steps around
 * it. The actor is built with ownerActor, from the user row, and only after this module has checked the caller is Mike.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { patchTask } from '@/lib/services/task-patch';
import { ownerActor } from '@/lib/home/reconcile/actor';
import { appendHomeAction, type HomeDb } from '@/lib/home/state';
import type { HomeActResponse, HomeTriage, HomeTriageGroup, HomeTriageTask } from '@/lib/home/types';
import { TRIAGE_MESSAGES, TRIAGE_UNDO_HOURS, droppedLine, questionsLine, releasedLine, releasedPlanLine } from './triage-copy';
import { HELD_TAG, NEEDS_MIKE_TAG, openQuestionCounts } from './questions';

export const TRIAGE_PASS_PREFIX = 'triage-pass:';
export const TRIAGE_ACTIONS = ['triage_release', 'triage_release_plan', 'triage_drop'] as const;
export type TriageAction = (typeof TRIAGE_ACTIONS)[number];
const HOUR_MS = 3600 * 1000;
const TITLES_SHOWN = 3;
const MAX_IDS = 1000;

export function isTriageOwner(userId: string): boolean {
  return userId === MIKE_USER_ID;
}

function requireOwner(userId: string): void {
  if (!isTriageOwner(userId)) throw new ApiError(TRIAGE_MESSAGES.notYours, 404, 'not_found');
}

const ROW_SELECT = {
  id: true,
  title: true,
  tags: true,
  updated_at: true,
  project_id: true,
  project: { select: { id: true, name: true, status: true } },
} satisfies Prisma.TaskSelect;
type Row = Prisma.TaskGetPayload<{ select: typeof ROW_SELECT }>;

function passTag(tags: string[]): string | null {
  return tags.find((t) => t.startsWith(TRIAGE_PASS_PREFIX) && t.length > TRIAGE_PASS_PREFIX.length) ?? null;
}

function groupKeyFor(r: Row): string {
  const pass = passTag(r.tags);
  if (pass) return `pass:${pass}`;
  return r.project_id ? `project:${r.project_id}` : 'none';
}

function passLabel(tag: string): string {
  return tag.slice(TRIAGE_PASS_PREFIX.length).replace(/:/g, ' · ');
}

/** The where clause of one group key, or null for a key that is not one of ours. */
function whereForGroup(key: string): Prisma.TaskWhereInput | null {
  if (key === 'none') return { project_id: null };
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const rest = key.slice(i + 1);
  if (kind === 'project' && /^[0-9a-f-]{36}$/i.test(rest)) return { project_id: rest };
  if (kind === 'pass' && rest.startsWith(TRIAGE_PASS_PREFIX)) return { tags: { has: rest } };
  return null;
}

async function openTriageRows(db: HomeDb, where: Prisma.TaskWhereInput = {}): Promise<Row[]> {
  return db.task.findMany({
    where: { AND: [{ status: 'triage', is_deleted: false }, where] },
    select: ROW_SELECT,
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
}

/** Rows of one group key, re-read now and re-grouped, so a pass tag that outranks a project never splits a group. */
async function rowsOfGroup(db: HomeDb, key: string): Promise<Row[]> {
  const where = whereForGroup(key);
  if (!where) return [];
  const rows = await openTriageRows(db, where);
  return rows.filter((r) => groupKeyFor(r) === key);
}

/** The Triage section. Null for anyone but Mike, and null when nothing waits. */
export async function loadTriage(db: HomeDb, userId: string): Promise<HomeTriage | null> {
  if (!isTriageOwner(userId)) return null;
  const rows = await openTriageRows(db);
  if (rows.length === 0) return null;
  const groups = new Map<string, { kind: HomeTriageGroup['kind']; label: string; project_id: string | null; rows: Row[] }>();
  for (const r of rows) {
    const key = groupKeyFor(r);
    let g = groups.get(key);
    if (!g) {
      const pass = passTag(r.tags);
      g = pass
        ? { kind: 'pass', label: passLabel(pass), project_id: null, rows: [] }
        : r.project
          ? { kind: 'project', label: r.project.name, project_id: r.project.id, rows: [] }
          : { kind: 'none', label: 'No project', project_id: null, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  const qCounts = await openQuestionCounts(db, rows.map((r) => r.id));
  const out: HomeTriageGroup[] = [...groups.entries()].map(([key, g]) => {
    const tasks: HomeTriageTask[] = g.rows.map((r) => ({
      task_id: r.id,
      title: r.title,
      href: `/tasks/${r.id}`,
      project_name: r.project?.name ?? null,
      open_questions: qCounts.get(r.id) ?? 0,
    }));
    const withProject = g.rows.filter((r) => r.project);
    return {
      key,
      kind: g.kind,
      label: g.label,
      count: g.rows.length,
      titles: tasks.slice(0, TITLES_SHOWN).map((t) => t.title),
      tasks,
      open_questions: tasks.reduce((a, t) => a + t.open_questions, 0),
      project_id: g.project_id,
      still_quote: withProject.length > 0 && withProject.every((r) => r.project?.status === 'quote'),
    };
  });
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { count: rows.length, open_questions: out.reduce((a, g) => a + g.open_questions, 0), groups: out };
}

// ----------------------------------------------------------------------------
// Taps
// ----------------------------------------------------------------------------

/** The record a tap stores, so Undo can put back exactly what it did. */
export interface TriageRecord {
  kind: 'triage';
  mode: 'release' | 'drop';
  started_at: string;
  items: {
    task_id: string;
    project_id: string | null;
    updated_after: string;
    /** Questions this tap turned from open to defaulted (released without an answer). Undo opens them again. */
    defaulted_question_ids?: string[];
    /** Tags this tap added (held-for-questions, needs-mike). Undo takes exactly these off. */
    tags_added?: string[];
  }[];
  projects: { project_id: string; from: 'queue'; to: 'ready'; updated_after: string }[];
}

export function readTriageRecord(v: unknown): TriageRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = (v as { triage?: unknown }).triage as Partial<TriageRecord> | undefined;
  if (!r || r.kind !== 'triage' || !Array.isArray(r.items)) return null;
  return { ...(r as TriageRecord), projects: Array.isArray(r.projects) ? r.projects : [] };
}

function uniqueIds(ids: string[]): string[] {
  if (ids.length > MAX_IDS) throw new ApiError('Too many at once.', 400, 'too_many');
  return Array.from(new Set(ids));
}

async function moveOne(db: PrismaClient, userId: string, row: Row, to: 'not_started' | 'abandoned', addTags: string[] = []): Promise<Date | null> {
  const actor = await ownerActor(db, userId);
  try {
    const res = await patchTask({ actor, id: row.id, body: { status: to, ...(addTags.length > 0 ? { tags: [...row.tags, ...addTags] } : {}) }, expect: { status: 'triage', updated_at: row.updated_at } });
    if (!res.ok) return null;
  } catch (e) {
    // The server's own refusals (not Mike, a transition it does not allow) must not look like a quiet skip.
    if (e instanceof ApiError && e.code === 'triage_exit_forbidden') throw e;
    return null;
  }
  const after = await db.task.findUnique({ where: { id: row.id }, select: { updated_at: true } });
  return after?.updated_at ?? new Date();
}

async function writeLine(db: PrismaClient, userId: string, action: TriageAction, rec: TriageRecord, line: string, details: string[], now: Date): Promise<HomeActResponse> {
  const undoUntil = new Date(now.getTime() + TRIAGE_UNDO_HOURS * HOUR_MS);
  const row = await appendHomeAction(db, userId, {
    item_key: null,
    action,
    source: 'keeper',
    before: { states: [], triage: rec },
    after: { states: [], triage: rec, line, details, href: null },
    undo_until: undoUntil,
  });
  return { ok: true as const, action_id: row.id, undo_until: undoUntil.toISOString(), item_key: null, message: line };
}

function changedErr(): ApiError {
  return new ApiError(TRIAGE_MESSAGES.nothingChanged, 409, 'changed_since');
}
function quoteErr(): ApiError {
  return new ApiError(TRIAGE_MESSAGES.stillQuote, 409, 'still_a_quote');
}

/** Move the rows (all in triage when read) and write the one Handled line. `plan` also readies queue projects. */
async function run(db: PrismaClient, userId: string, action: TriageAction, mode: 'release' | 'drop', rows: Row[], plan: boolean, now: Date): Promise<HomeActResponse> {
  const target = mode === 'release' ? 'not_started' : 'abandoned';
  const rec: TriageRecord = { kind: 'triage', mode, started_at: now.toISOString(), items: [], projects: [] };
  const details: string[] = [];
  let skipped = 0;
  let quoteSkipped = 0;
  let qDefaulted = 0;
  let qWaiting = 0;
  for (const row of rows) {
    // A task on a quote project is never released: nothing in the worker checks project status, so a release would start it.
    if (mode === 'release' && row.project?.status === 'quote') {
      quoteSkipped += 1;
      continue;
    }
    // Open questions never block him: each follows its own if_nobody_action (see the header).
    const open = mode === 'release' ? await db.taskQuestion.findMany({ where: { task_id: row.id, state: 'open' }, select: { id: true, if_nobody_action: true } }) : [];
    const goIds = open.filter((q) => q.if_nobody_action === 'go_with_recommendation').map((q) => q.id);
    const waitCount = open.length - goIds.length;
    const addTags = waitCount > 0 ? [HELD_TAG, NEEDS_MIKE_TAG].filter((t) => !row.tags.includes(t)) : [];
    const after = await moveOne(db, userId, row, target, addTags);
    if (!after) {
      skipped += 1;
      continue;
    }
    let defaulted: string[] = [];
    if (goIds.length > 0) {
      await db.taskQuestion.updateMany({ where: { id: { in: goIds }, state: 'open' }, data: { state: 'defaulted', defaulted_at: now } });
      defaulted = goIds;
    }
    qDefaulted += defaulted.length;
    qWaiting += waitCount;
    rec.items.push({
      task_id: row.id,
      project_id: row.project_id,
      updated_after: after.toISOString(),
      ...(defaulted.length > 0 ? { defaulted_question_ids: defaulted } : {}),
      ...(addTags.length > 0 ? { tags_added: addTags } : {}),
    });
    details.push(`${row.title} /tasks/${row.id}`);
  }
  if (rec.items.length === 0) throw quoteSkipped > 0 && skipped === 0 ? quoteErr() : changedErr();

  const madeReady: string[] = [];
  if (plan) {
    const queued = new Map<string, string>();
    for (const row of rows) if (row.project?.status === 'queue' && rec.items.some((i) => i.task_id === row.id)) queued.set(row.project.id, row.project.name);
    for (const [projectId, name] of queued) {
      const r = await db.project.updateMany({ where: { id: projectId, status: 'queue' }, data: { status: 'ready' } });
      if (r.count !== 1) continue;
      const p = await db.project.findUnique({ where: { id: projectId }, select: { updated_at: true } });
      rec.projects.push({ project_id: projectId, from: 'queue', to: 'ready', updated_after: (p?.updated_at ?? new Date()).toISOString() });
      madeReady.push(name);
    }
  }

  const names = Array.from(new Set(rows.filter((r) => rec.items.some((i) => i.task_id === r.id)).map((r) => r.project?.name).filter((x): x is string => !!x)));
  const line =
    mode === 'drop' ? droppedLine(rec.items.length) : plan ? releasedPlanLine(rec.items.length, names, madeReady) : releasedLine(rec.items.length, skipped + quoteSkipped);
  const tail = plan && (skipped > 0 || quoteSkipped > 0) ? ` ${skipped + quoteSkipped} left alone.` : '';
  const qLine = questionsLine(qDefaulted, qWaiting);
  return writeLine(db, userId, action, rec, `${line}${tail}${qLine ? ` ${qLine}` : ''}`, details, now);
}

async function rowsById(db: PrismaClient, ids: string[]): Promise<Row[]> {
  return openTriageRows(db, { id: { in: ids } });
}

/** Release: the named tasks to not_started. */
export async function release(db: PrismaClient, userId: string, taskIds: string[], now: Date): Promise<HomeActResponse> {
  requireOwner(userId);
  const rows = await rowsById(db, uniqueIds(taskIds));
  if (rows.length === 0) throw changedErr();
  return run(db, userId, 'triage_release', 'release', rows, false, now);
}

/**
 * Release plan: every triage task in the group, in one action. A queue project also becomes ready. A group whose projects are all
 * quotes answers that it is still a quote and changes nothing; a mixed group releases the rest and leaves the quote ones.
 */
export async function releasePlan(db: PrismaClient, userId: string, groupKey: string, now: Date): Promise<HomeActResponse> {
  requireOwner(userId);
  const rows = await rowsOfGroup(db, groupKey);
  if (rows.length === 0) throw new ApiError(TRIAGE_MESSAGES.gone, 404, 'not_found');
  return run(db, userId, 'triage_release_plan', 'release', rows, true, now);
}

/** Drop: the named tasks to abandoned. */
export async function drop(db: PrismaClient, userId: string, taskIds: string[], now: Date): Promise<HomeActResponse> {
  requireOwner(userId);
  const rows = await rowsById(db, uniqueIds(taskIds));
  if (rows.length === 0) throw changedErr();
  return run(db, userId, 'triage_drop', 'drop', rows, false, now);
}

// ----------------------------------------------------------------------------
// Undo (called from runHomeUndo inside its transaction)
// ----------------------------------------------------------------------------

/**
 * Undo of a release, release plan or drop. Each task goes back to triage only while it is still as the tap left it (compare-and-set
 * through patchTask); a task that changed since stays where it is. A dropped task comes back through not_started because the status
 * table has no abandoned to triage step. A project the plan made ready goes back to queue only when every one of its tasks came back
 * and the project itself is unchanged.
 */
export async function undoTriage(db: HomeDb, userId: string, rec: TriageRecord, now: Date): Promise<{ restored: string[] }> {
  void now;
  requireOwner(userId);
  const prisma = db as unknown as PrismaClient;
  const actor = await ownerActor(prisma, userId);
  const restored: string[] = [];
  const from = rec.mode === 'release' ? 'not_started' : 'abandoned';
  for (const it of rec.items) {
    try {
      let current: { status: 'not_started' | 'abandoned'; updated_at: Date | string } = { status: from, updated_at: it.updated_after };
      if (rec.mode === 'drop') {
        const a = await patchTask({ actor, id: it.task_id, body: { status: 'not_started' }, expect: current });
        if (!a.ok) continue;
        const t = await prisma.task.findUnique({ where: { id: it.task_id }, select: { updated_at: true } });
        if (!t) continue;
        current = { status: 'not_started', updated_at: t.updated_at };
      }
      // Tags: take off exactly the ones the tap added. The compare-and-set below fails if anything changed the card since, so the list is still as the tap left it.
      let tagBody: { tags?: string[] } = {};
      if (it.tags_added && it.tags_added.length > 0) {
        const t = await prisma.task.findUnique({ where: { id: it.task_id }, select: { tags: true } });
        if (t) tagBody = { tags: t.tags.filter((x) => !it.tags_added!.includes(x)) };
      }
      const res = await patchTask({ actor, id: it.task_id, body: { status: 'triage', ...tagBody }, expect: current });
      if (res.ok) {
        restored.push(it.task_id);
        if (it.defaulted_question_ids && it.defaulted_question_ids.length > 0) {
          await prisma.taskQuestion.updateMany({ where: { id: { in: it.defaulted_question_ids }, task_id: it.task_id, state: 'defaulted' }, data: { state: 'open', defaulted_at: null } });
        }
      }
    } catch {
      // changed since: it stays as it is
    }
  }
  for (const p of rec.projects) {
    const mine = rec.items.filter((i) => i.project_id === p.project_id);
    if (!mine.every((i) => restored.includes(i.task_id))) continue;
    await prisma.project.updateMany({ where: { id: p.project_id, status: 'ready', updated_at: new Date(p.updated_after) }, data: { status: 'queue' } });
  }
  return { restored };
}

