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
 *   closeDone     "Close as done": a card an agent marked (or Mike says) is already finished goes straight to done. Owner only.
 *   notDone       "Not done": takes the looks-done mark off and leaves the card in Triage, with an internal comment.
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
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { patchTask } from '@/lib/services/task-patch';
import { ownerActor } from '@/lib/home/reconcile/actor';
import { appendHomeAction, type HomeDb } from '@/lib/home/state';
import type { HomeActResponse, HomeTriage, HomeTriageGroup, HomeTriageLooksDone, HomeTriageTask } from '@/lib/home/types';
import { CLOSE_UNDONE_COMMENT, NOT_DONE_COMMENT, TRIAGE_MESSAGES, TRIAGE_UNDO_HOURS, closedDoneComment, closedDoneLine, droppedLine, notDoneLine, questionsLine, releasedLine, releasedPlanLine } from './triage-copy';
import { askedAfterRelease, clientTextTaskIds, evidenceFor, loadCards, openQuestionRows, questionSplit, summariesFor } from './triage-card';
import { CARD_CHANGED_MESSAGE, releaseVersion } from './triage-version';
import { recentChanges, whatChanged } from './triage-rev';
import { LOOKS_DONE_TAG } from './looks-done';
import { markHomeActionUndone } from '@/lib/home/state';
import { readWorkCloseRecord, undoWorkClose, type WorkCloseRecord } from '@/lib/work/ask-closure';
import { stageALines } from '@/lib/work/finished-store';
import { RELEASE_REFUSALS, planRelease, pmReleaseHold, type ReleasePlan, type TriageKindName } from './triage-kind';
import { HELD_NEEDS_MIKE_MARK, HELD_TAG, NEEDS_MIKE_TAG, openQuestionCounts } from './questions';

export const TRIAGE_PASS_PREFIX = 'triage-pass:';
export const TRIAGE_ACTIONS = ['triage_release', 'triage_release_card', 'triage_release_plan', 'triage_drop', 'triage_close_done', 'triage_not_done'] as const;
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
  created_at: true,
  project_id: true,
  triage_kind: true,
  triage_rev: true,
  assignee_id: true,
  assignee: { select: { name: true } },
  site_id: true,
  client_id: true,
  site: { select: { id: true, name: true } },
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
  // A looks-done card is drawn in its group too (the live UI only draws groups), so Release plan takes it along like any other card.
  return rows.filter((r) => groupKeyFor(r) === key);
}

/** The Triage section. Null for anyone but Mike; for Mike an empty one when nothing waits. */
export async function loadTriage(db: HomeDb, userId: string): Promise<HomeTriage | null> {
  if (!isTriageOwner(userId)) return null;
  const rows = await openTriageRows(db);
  const asked = await askedAfterRelease(db);
  // Mike with nothing waiting still gets the (empty) section, so the Triage tab shows at zero; everyone else gets null above.
  if (rows.length === 0) return { count: 0, open_questions: 0, groups: [], cards: [], asked_after_release: asked };
  const marked = rows.filter((r) => r.tags.includes(LOOKS_DONE_TAG));
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
  const cards = await loadCards(db, rows.map((r) => r.id));
  const evidence = new Map(cards.map((c) => [c.task_id, c.looks_done?.evidence ?? '']));
  const summaries = await summariesFor(db, rows.map((r) => r.id));
  const looksDone: HomeTriageLooksDone[] = marked.map((r) => ({
    task_id: r.id,
    title: r.title,
    href: `/tasks/${r.id}`,
    project_name: r.project?.name ?? null,
    evidence: evidence.get(r.id) ?? '',
    open_questions: qCounts.get(r.id) ?? 0,
    summary: summaries.get(r.id) ?? '',
    created_at: r.created_at.toISOString(),
  }));
  const out: HomeTriageGroup[] = [...groups.entries()].map(([key, g]) => {
    const tasks: HomeTriageTask[] = g.rows.map((r) => ({
      task_id: r.id,
      title: r.title,
      href: `/tasks/${r.id}`,
      project_name: r.project?.name ?? null,
      open_questions: qCounts.get(r.id) ?? 0,
      summary: summaries.get(r.id) ?? '',
      created_at: r.created_at.toISOString(),
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
  return {
    count: rows.length,
    looks_done: looksDone,
    cards,
    asked_after_release: asked,
    open_questions: out.reduce((a, g) => a + g.open_questions, 0),
    groups: out,
  };
}

// ----------------------------------------------------------------------------
// Taps
// ----------------------------------------------------------------------------

/** The record a tap stores, so Undo can put back exactly what it did. */
export interface TriageRecord {
  kind: 'triage';
  mode: 'release' | 'drop' | 'close_done' | 'not_done';
  started_at: string;
  items: {
    task_id: string;
    project_id: string | null;
    updated_after: string;
    /** Questions this tap turned from open to defaulted (released without an answer). Undo opens them again. */
    defaulted_question_ids?: string[];
    /** Tags this tap added (held-for-questions, needs-mike). Undo takes exactly these off. */
    tags_added?: string[];
    /** close_done and not_done: the looks-done mark this tap took off. Undo puts it back. */
    tag_removed?: boolean;
    /** release by kind: the assignee before Bast was set (null = nobody). Present only when the release changed the assignee. Undo puts it back. */
    assignee_before?: string | null;
    /** release by kind: the card was closed as done (question_only). Undo goes done -> not_started -> triage. */
    was_closed?: boolean;
    /** close_done: the Looks done comment the close relied on, and the comment the close wrote. */
    evidence_comment_id?: string | null;
    close_comment_id?: string;
  }[];
  /** close_done: the work_close lines the close caused (its emails closed with it). Undo reopens them. */
  ask_action_ids?: string[];
  projects: { project_id: string; from: 'queue'; to: 'ready'; updated_after: string }[];
}

export function readTriageRecord(v: unknown): TriageRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = (v as { triage?: unknown }).triage as Partial<TriageRecord> | undefined;
  if (!r || r.kind !== 'triage' || !Array.isArray(r.items)) return null;
  return { ...(r as TriageRecord), projects: Array.isArray(r.projects) ? r.projects : [], ask_action_ids: Array.isArray(r.ask_action_ids) ? r.ask_action_ids : [] };
}

function uniqueIds(ids: string[]): string[] {
  if (ids.length > MAX_IDS) throw new ApiError('Too many at once.', 400, 'too_many');
  return Array.from(new Set(ids));
}

async function moveOne(
  db: PrismaClient,
  userId: string,
  row: Row,
  to: 'not_started' | 'abandoned' | 'done',
  extra: { tags?: string[]; assignee_id?: string } = {},
): Promise<Date | null> {
  const actor = await ownerActor(db, userId);
  try {
    const res = await patchTask({
      actor,
      id: row.id,
      body: { status: to, ...(extra.tags ? { tags: extra.tags } : {}), ...(extra.assignee_id ? { assignee_id: extra.assignee_id } : {}) },
      expect: { status: 'triage', updated_at: row.updated_at },
    });
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

/** What Release will do to one row. Null = the legacy path (an unsorted card tapped from the old group UI): move to not_started, nothing else. */
function releasePlanOf(row: Row, requireKind: boolean, open: { if_nobody_action: string }[] = []): ReleasePlan | null {
  if (row.triage_kind === null && !requireKind) return null;
  const split = questionSplit(open);
  return planRelease({
    site: row.site ? { id: row.site.id, name: row.site.name } : null,
    open_go: split.go,
    open_wait: split.wait,
    pm_hold: pmReleaseHold(),
    kind: row.triage_kind as TriageKindName | null,
    assignee_id: row.assignee_id,
    assignee_name: row.assignee?.name ?? null,
    project: row.project ? { id: row.project.id, name: row.project.name, status: row.project.status } : null,
    bast_id: BAST_USER_ID,
  });
}

/** Move the rows (all in triage when read) and write the one Handled line. `plan` also readies queue projects. */
async function run(
  db: PrismaClient,
  userId: string,
  action: TriageAction,
  mode: 'release' | 'drop',
  rows: Row[],
  plan: boolean,
  now: Date,
  opts: { requireKind?: boolean; expectVersion?: string } = {},
): Promise<HomeActResponse> {
  const rec: TriageRecord = { kind: 'triage', mode, started_at: now.toISOString(), items: [], projects: [], ask_action_ids: [] };
  const details: string[] = [];
  let skipped = 0;
  let quoteSkipped = 0;
  let qDefaulted = 0;
  let qWaiting = 0;
  const blocks: ReleasePlan['block'][] = [];
  const toReady = new Map<string, string>();
  const closedIds: string[] = [];
  const openByTask = mode === 'release' ? await openQuestionRows(db, rows.map((r) => r.id)) : new Map<string, { id: string; if_nobody_action: string }[]>();
  if (opts.expectVersion !== undefined) {
    // The card must still be what the owner read: everything Release depends on is hashed and compared before anything moves.
    const row = rows[0];
    const now_ = releaseVersion({
      kind: row.triage_kind,
      assignee_id: row.assignee_id,
      project_id: row.project?.id ?? null,
      project_status: row.project?.status ?? null,
      site_id: row.site_id,
      client_id: row.client_id,
      questions: openByTask.get(row.id) ?? [],
      triage_rev: row.triage_rev,
    });
    if (now_ !== opts.expectVersion) {
      // Say what moved: the last change lines of this card ("Plan: Billing model updated by the chat").
      const lines = (await recentChanges(db, [row.id])).get(row.id) ?? [];
      throw new ApiError(CARD_CHANGED_MESSAGE, 409, 'card_changed', undefined, { what_changed: whatChanged(lines), changes: lines.map((l) => l.line), triage_rev: row.triage_rev });
    }
  }
  for (const row of rows) {
    const openRows = openByTask.get(row.id) ?? [];
    const rp = mode === 'release' ? releasePlanOf(row, opts.requireKind === true, openRows) : null;
    if (mode === 'release') {
      if (rp && !rp.ready) {
        blocks.push(rp.block);
        continue;
      }
      // A task on a quote project is never released: nothing in the worker checks project status, so a release would start it.
      if (!rp && row.project?.status === 'quote') {
        quoteSkipped += 1;
        continue;
      }
    }
    const fx = rp?.effects ?? null;
    const target = fx ? fx.to_status : mode === 'release' ? 'not_started' : 'abandoned';
    // Open questions never block him: each follows its own if_nobody_action. A card closed as done has nothing to hold, so its questions are left as they are.
    const open = mode === 'release' && target !== 'done' ? openRows : [];
    const goIds = open.filter((q) => q.if_nobody_action === 'go_with_recommendation').map((q) => q.id);
    const waitCount = open.length - goIds.length;
    // When release itself adds needs-mike it also adds the second marker, so answering removes only what release added.
    const addNeeds = waitCount > 0 && !row.tags.includes(NEEDS_MIKE_TAG);
    const questionTags = waitCount > 0 ? [...(row.tags.includes(HELD_TAG) ? [] : [HELD_TAG]), ...(addNeeds ? [NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK] : [])] : [];
    const kindTags = (fx?.add_tags ?? []).filter((t) => !row.tags.includes(t));
    const addTags = [...kindTags, ...questionTags];
    const setBast = !!fx && fx.assign_bast && row.assignee_id !== BAST_USER_ID;
    const after = await moveOne(db, userId, row, target, {
      ...(addTags.length > 0 ? { tags: [...row.tags, ...addTags] } : {}),
      ...(setBast ? { assignee_id: BAST_USER_ID } : {}),
    });
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
    if (fx?.project_to_ready && row.project) toReady.set(row.project.id, row.project.name);
    if (target === 'done') closedIds.push(row.id);
    rec.items.push({
      task_id: row.id,
      project_id: row.project_id,
      updated_after: after.toISOString(),
      ...(defaulted.length > 0 ? { defaulted_question_ids: defaulted } : {}),
      ...(addTags.length > 0 ? { tags_added: addTags } : {}),
      ...(setBast ? { assignee_before: row.assignee_id } : {}),
      ...(target === 'done' ? { was_closed: true } : {}),
    });
    details.push(`${row.title} /tasks/${row.id}`);
  }
  if (rec.items.length === 0) {
    if (blocks.length > 0 && skipped === 0) {
      const r = RELEASE_REFUSALS[blocks[0] as keyof typeof RELEASE_REFUSALS];
      throw new ApiError(r.message, r.status, r.code);
    }
    throw quoteSkipped > 0 && skipped === 0 ? quoteErr() : changedErr();
  }
  if (closedIds.length > 0) rec.ask_action_ids = await stageALines(db, userId, closedIds, now);

  const madeReady: string[] = [];
  const queued = new Map<string, string>(toReady);
  if (plan) {
    for (const row of rows) if (row.project?.status === 'queue' && rec.items.some((i) => i.task_id === row.id)) queued.set(row.project.id, row.project.name);
  }
  for (const [projectId, name] of queued) {
    const r = await db.project.updateMany({ where: { id: projectId, status: 'queue' }, data: { status: 'ready' } });
    if (r.count !== 1) continue;
    const p = await db.project.findUnique({ where: { id: projectId }, select: { updated_at: true } });
    rec.projects.push({ project_id: projectId, from: 'queue', to: 'ready', updated_after: (p?.updated_at ?? new Date()).toISOString() });
    madeReady.push(name);
  }

  const names = Array.from(new Set(rows.filter((r) => rec.items.some((i) => i.task_id === r.id)).map((r) => r.project?.name).filter((x): x is string => !!x)));
  const left = skipped + quoteSkipped + blocks.length;
  const line =
    mode === 'drop' ? droppedLine(rec.items.length) : plan ? releasedPlanLine(rec.items.length, names, madeReady) : releasedLine(rec.items.length, left);
  const tail = plan && left > 0 ? ` ${left} left alone.` : '';
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
 * Release one card by its kind (the Triage tab's Release). Same effects as the card's `release_line` (see triage-kind.ts), and a card
 * with no kind is refused with a 409 (not_sorted): the line says "Not sorted yet". `version` is the card's release_version as the owner
 * read it; if anything Release depends on changed since, the answer is 409 card_changed and nothing moves.
 */
export async function releaseCard(db: PrismaClient, userId: string, taskId: string, version: string, now: Date): Promise<HomeActResponse> {
  requireOwner(userId);
  const rows = await rowsById(db, [taskId]);
  if (rows.length === 0) throw changedErr();
  return run(db, userId, 'triage_release_card', 'release', rows, false, now, { requireKind: true, expectVersion: version });
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

/**
 * For the chat's reach check (lib/bast-chat/ops/home.ts): of the cards a release request would release, the ones that END assigned to
 * Bast with a worker-eligible status, and whether each carries text a client may have written. Read-only. Same rules as run():
 * an unsorted card on the legacy path keeps its assignee, a closed (question_only) card never starts anything.
 */
export async function releaseBastCards(
  db: PrismaClient,
  req: { action: 'triage_release' | 'triage_release_card' | 'triage_release_plan'; task_ids?: string[]; group_key?: string },
): Promise<{ task_id: string; client_text: boolean }[]> {
  const rows = req.action === 'triage_release_plan' ? await rowsOfGroup(db, req.group_key ?? '') : await rowsById(db, Array.from(new Set(req.task_ids ?? [])));
  const ending: Row[] = [];
  for (const row of rows) {
    const rp = releasePlanOf(row, req.action === 'triage_release_card');
    if (rp) {
      if (!rp.ready || !rp.effects || rp.effects.to_status === 'done') continue;
      if (rp.effects.assign_bast || row.assignee_id === BAST_USER_ID) ending.push(row);
    } else if (row.assignee_id === BAST_USER_ID && row.project?.status !== 'quote') ending.push(row);
  }
  const clientText = await clientTextTaskIds(db, ending.map((r) => r.id));
  return ending.map((r) => ({ task_id: r.id, client_text: clientText.has(r.id) }));
}

/** Drop: the named tasks to abandoned. */
export async function drop(db: PrismaClient, userId: string, taskIds: string[], now: Date): Promise<HomeActResponse> {
  requireOwner(userId);
  const rows = await rowsById(db, uniqueIds(taskIds));
  if (rows.length === 0) throw changedErr();
  return run(db, userId, 'triage_drop', 'drop', rows, false, now);
}

/**
 * Close as done. A card that is "already done elsewhere" goes straight from Triage to done (owner only: patchTask's own triage-exit
 * check is the authority, and the status table now allows triage to done). The close needs no Looks done mark, because Mike can say
 * "that one is done" in the chat; when a mark and evidence are there, the comment references them.
 *
 * The done-guards, honestly handled. patchTask has no hard guard on done: the checklist ("Done when") and the review flags are not
 * checked for a status write, and a normal close from the task page or the looks-finished list ticks and approves nothing either.
 * So the close does not tick the checklist and does not set `approved`. Why: an idea Mike closes as done elsewhere was never
 * reviewed here, and `approved` is what lets an approval-gated dependent start (lib/services/dependencies.ts); setting it would
 * start other work on an agent's say-so. A dependent on an approval-gated project therefore stays blocked until someone approves,
 * exactly as it does for any done task. The comment records the evidence and who closed it, which is the honest paper trail.
 * Done also closes the emails linked to the task (Stage A), as every other close does; Undo reopens them.
 */
export async function closeDone(db: PrismaClient, userId: string, taskIds: string[], now: Date): Promise<HomeActResponse> {
  requireOwner(userId);
  const rows = await rowsById(db, uniqueIds(taskIds));
  if (rows.length === 0) throw changedErr();
  const evidence = await evidenceFor(db, rows.map((r) => r.id));
  const actor = await ownerActor(db, userId);
  const rec: TriageRecord = { kind: 'triage', mode: 'close_done', started_at: now.toISOString(), items: [], projects: [], ask_action_ids: [] };
  const details: string[] = [];
  for (const row of rows) {
    const marked = row.tags.includes(LOOKS_DONE_TAG);
    try {
      const res = await patchTask({
        actor,
        id: row.id,
        body: { status: 'done', ...(marked ? { tags: row.tags.filter((t) => t !== LOOKS_DONE_TAG) } : {}) },
        expect: { status: 'triage', updated_at: row.updated_at },
      });
      if (!res.ok) continue;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'triage_exit_forbidden') throw e;
      continue;
    }
    const ev = evidence.get(row.id) ?? null;
    const comment = await db.comment.create({
      data: { task_id: row.id, user_id: userId, content: closedDoneComment(ev?.id ?? null, ev?.evidence ?? null), is_internal: true, client_visible: false },
      select: { id: true },
    });
    const after = await db.task.findUnique({ where: { id: row.id }, select: { updated_at: true } });
    rec.items.push({
      task_id: row.id,
      project_id: row.project_id,
      updated_after: (after?.updated_at ?? new Date()).toISOString(),
      tag_removed: marked,
      evidence_comment_id: ev?.id ?? null,
      close_comment_id: comment.id,
    });
    details.push(`${row.title} /tasks/${row.id}`);
  }
  if (rec.items.length === 0) throw changedErr();
  rec.ask_action_ids = await stageALines(db, userId, rec.items.map((i) => i.task_id), now);
  return writeLine(db, userId, 'triage_close_done', rec, closedDoneLine(rec.items.length), details, now);
}

/** Not done: the looks-done mark comes off and the card stays in Triage, with an internal comment. Only a marked card in Triage. */
export async function notDone(db: PrismaClient, userId: string, taskIds: string[], now: Date): Promise<HomeActResponse> {
  requireOwner(userId);
  const rows = (await rowsById(db, uniqueIds(taskIds))).filter((r) => r.tags.includes(LOOKS_DONE_TAG));
  if (rows.length === 0) throw changedErr();
  const actor = await ownerActor(db, userId);
  const rec: TriageRecord = { kind: 'triage', mode: 'not_done', started_at: now.toISOString(), items: [], projects: [] };
  const details: string[] = [];
  for (const row of rows) {
    try {
      const res = await patchTask({ actor, id: row.id, body: { tags: row.tags.filter((t) => t !== LOOKS_DONE_TAG) }, expect: { status: 'triage', updated_at: row.updated_at } });
      if (!res.ok) continue;
    } catch {
      continue;
    }
    await db.comment.create({ data: { task_id: row.id, user_id: userId, content: NOT_DONE_COMMENT, is_internal: true, client_visible: false } });
    const after = await db.task.findUnique({ where: { id: row.id }, select: { updated_at: true } });
    rec.items.push({ task_id: row.id, project_id: row.project_id, updated_after: (after?.updated_at ?? new Date()).toISOString(), tag_removed: true });
    details.push(`${row.title} /tasks/${row.id}`);
  }
  if (rec.items.length === 0) throw changedErr();
  return writeLine(db, userId, 'triage_not_done', rec, notDoneLine(rec.items.length), details, now);
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
  requireOwner(userId);
  const prisma = db as unknown as PrismaClient;
  const actor = await ownerActor(prisma, userId);
  if (rec.mode === 'close_done' || rec.mode === 'not_done') return undoLooksDone(prisma, db, userId, actor, rec, now);
  const restored: string[] = [];
  for (const it of rec.items) {
    try {
      // A dropped card and a card closed as done both come back through not_started (the status table has no abandoned or done to triage step).
      const via = rec.mode === 'drop' || it.was_closed === true;
      let current: { status: 'not_started' | 'abandoned' | 'done'; updated_at: Date | string } = {
        status: rec.mode === 'drop' ? 'abandoned' : it.was_closed ? 'done' : 'not_started',
        updated_at: it.updated_after,
      };
      if (via) {
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
      const assigneeBody = 'assignee_before' in it ? { assignee_id: it.assignee_before ?? null } : {};
      const res = await patchTask({ actor, id: it.task_id, body: { status: 'triage', ...tagBody, ...assigneeBody }, expect: current });
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
  for (const actionId of rec.ask_action_ids ?? []) {
    const row = await db.homeAction.findFirst({ where: { id: actionId, user_id: userId }, select: { before: true } });
    const wc: WorkCloseRecord | null = readWorkCloseRecord(row?.before);
    if (wc && (await markHomeActionUndone(db, userId, actionId, now))) await undoWorkClose(db, userId, wc, now);
  }
  for (const p of rec.projects) {
    const mine = rec.items.filter((i) => i.project_id === p.project_id);
    if (!mine.every((i) => restored.includes(i.task_id))) continue;
    await prisma.project.updateMany({ where: { id: p.project_id, status: 'ready', updated_at: new Date(p.updated_after) }, data: { status: 'queue' } });
  }
  return { restored };
}


/**
 * Undo of Close as done or Not done. Each card goes back only while it is still as the tap left it (compare-and-set through patchTask).
 * A done card returns through not_started (the status table has no done to triage step) and the looks-done mark is put back; the
 * emails the close closed reopen through Stage A's own undo. A card that changed since stays where it is.
 */
async function undoLooksDone(prisma: PrismaClient, db: HomeDb, userId: string, actor: Awaited<ReturnType<typeof ownerActor>>, rec: TriageRecord, now: Date): Promise<{ restored: string[] }> {
  const restored: string[] = [];
  for (const it of rec.items) {
    try {
      let current: { status: 'done' | 'not_started' | 'triage'; updated_at: Date | string } = { status: rec.mode === 'close_done' ? 'done' : 'triage', updated_at: it.updated_after };
      if (rec.mode === 'close_done') {
        const a = await patchTask({ actor, id: it.task_id, body: { status: 'not_started' }, expect: current });
        if (!a.ok) continue;
        const t = await prisma.task.findUnique({ where: { id: it.task_id }, select: { updated_at: true } });
        if (!t) continue;
        current = { status: 'not_started', updated_at: t.updated_at };
      }
      const t = await prisma.task.findUnique({ where: { id: it.task_id }, select: { tags: true } });
      const tags = t && it.tag_removed && !t.tags.includes(LOOKS_DONE_TAG) ? [...t.tags, LOOKS_DONE_TAG] : (t?.tags ?? []);
      const res = await patchTask({ actor, id: it.task_id, body: { status: 'triage', tags }, expect: current });
      if (!res.ok) continue;
      restored.push(it.task_id);
      if (rec.mode === 'close_done') {
        await prisma.comment.create({ data: { task_id: it.task_id, user_id: userId, content: CLOSE_UNDONE_COMMENT, is_internal: true, client_visible: false } });
      }
    } catch {
      // changed since: it stays as it is
    }
  }
  for (const actionId of rec.ask_action_ids ?? []) {
    const row = await db.homeAction.findFirst({ where: { id: actionId, user_id: userId }, select: { before: true } });
    const wc: WorkCloseRecord | null = readWorkCloseRecord(row?.before);
    if (wc && (await markHomeActionUndone(db, userId, actionId, now))) await undoWorkClose(db, userId, wc, now);
  }
  return { restored };
}
