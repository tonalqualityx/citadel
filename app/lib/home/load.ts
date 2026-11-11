/**
 * Home screen Slice 1: the loader (plan task H5, sources in plan 1.1).
 *
 * `loadHomeInputs(prisma, userId, now)` runs every read the screen needs for ONE user and
 * returns the Raw* contract types (types.ts). It only reads. It never calls /api/today or
 * rolloverTodayPicksIfNeeded and writes no record of any kind.
 *
 * Reused, not re-derived: the review sign-off rule and the human-comment clock come from
 * app/api/waiting-on-me/route.ts (BOT_USER_IDS from gate-constants), the wait owner from
 * loadWaitCandidates (lib/waits/load-blocks.ts).
 *
 * Never loaded: Task.priority and Task.is_focus (plan 1.3). Mike's own due_date is loaded
 * (RawTask.due_date) but only rules.ts hardDateOf may turn it into anything shown.
 *
 * Scoping: tasks are assignee_id = userId. Review folds, session asks and email asks have no
 * per-user owner in this phase (the same reasoning as /api/waiting-on-me), so they are
 * the admin-only fleet-wide reads the plan names; the route gate (gate.ts) keeps every
 * other user out. Waits are filtered to the ones whose resolved owner is userId.
 */

import type { Prisma, PrismaClient, WaitKind, WaitState } from '@prisma/client';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { loadWaitCandidates } from '@/lib/waits/load-blocks';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import {
  AUTO_HANDLED_NOTE_PREFIX,
  CLOSED_TASK_STATUSES,
  EXCLUDED_PROJECT_STATUSES,
  EXCLUDED_SESSION_STATUSES,
  HELD_PROJECT_STATUSES,
  OPEN_WAIT_STATES,
} from './rules';
import { isItemKey } from './item-key';
import { RULE_ACTION } from './emergency/copy';
import { LEARNED_ACTION } from './learn/copy';
import { loadWeights } from './learn/weights-store';
import { loadNotEmergencyRules } from './emergency/read';
import { loadProjectSteps } from './projects/load';
import { OWED_ROW_SELECT, OWED_RUN_KIND } from './owed/rows';
import { SEND_ACTION } from './owed/send-copy';
import type {
  KeeperActionKind,
  RawArcRef,
  RawAutoHandled,
  RawCalendarEvent,
  RawClientRef,
  RawCrisis,
  RawEmailAsk,
  RawHeldProject,
  RawHomeInputs,
  RawKeeperLine,
  RawOwedSend,
  RawProjectRef,
  RawRequirement,
  RawSiteIncident,
  RawReviewFold,
  RawSessionAsk,
  RawTask,
  RawThread,
  RawWait,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a keeper line stays in Handled for you (and open for Undo). */
const KEEPER_LINE_MS = 72 * 60 * 60 * 1000;
const KEEPER_ACTIONS: readonly string[] = [
  'keeper_stagger',
  'keeper_dates',
  'keeper_summaries',
  'keeper_arc_create',
  'keeper_arc_close',
  'keeper_arc_link',
  'keeper_owed_drafts',
  // Slice 6a: the site check's own lines (no Undo)
  'watch_site_cleared',
  'watch_site_down',
  // Slice 7a: the Monday measures line and the approval-speed guard line (no Undo)
  'keeper_measures',
  'keeper_guard',
] satisfies KeeperActionKind[];
/** How long an answered uptime-mail check keeps its mails out of Needs you now. */
const ANSWERED_KEEP_MS = 3 * DAY_MS;
/** Cap on classifier auto-closes read; the screen shows 5 and a count. */
const AUTO_HANDLED_TAKE = 200;

const CLIENT_SELECT = { id: true, name: true, status: true } as const;
const PROJECT_SELECT = { id: true, name: true, status: true } as const;
const ARC_SELECT = {
  id: true,
  name: true,
  client_id: true,
  project_id: true,
  closed_at: true,
  snoozed_until: true,
} as const;

export interface LoadHomeOptions {
  /** IANA zone for "today's calendar events". Default: the user's UserPreference.timezone, else the display default. */
  timezone?: string;
}

// ============================================================================
// Time zone day bounds
// ============================================================================

function zonedYmd(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function zonedWallClockAsUtc(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const hour = get('hour') === 24 ? 0 : get('hour');
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

/** The UTC instant of local midnight at the start of y-m-d in the zone. */
function zonedMidnightUtc(y: number, m: number, d: number, timeZone: string): Date {
  const nominal = Date.UTC(y, m - 1, d);
  let guess = nominal;
  for (let i = 0; i < 3; i++) {
    const offset = zonedWallClockAsUtc(new Date(guess), timeZone) - guess;
    guess = nominal - offset;
  }
  return new Date(guess);
}

/** [start, end) of the zoned calendar day that contains `now`. */
export function zonedDayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const { y, m, d } = zonedYmd(now, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    start: zonedMidnightUtc(y, m, d, timeZone),
    end: zonedMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
  };
}

// ============================================================================
// Small mappers
// ============================================================================

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Task.requirements (Json) as deliverables, in sort_order. [] when none or unreadable. */
function readRequirements(json: unknown): RawRequirement[] {
  if (!Array.isArray(json)) return [];
  const items: { text: string; completed: boolean; sort: number; idx: number }[] = [];
  json.forEach((r, idx) => {
    if (!r || typeof r !== 'object') return;
    const o = r as Record<string, unknown>;
    if (typeof o.text !== 'string' || o.text.trim() === '') return;
    items.push({
      text: o.text,
      completed: o.completed === true,
      sort: typeof o.sort_order === 'number' ? o.sort_order : idx,
      idx,
    });
  });
  items.sort((a, b) => a.sort - b.sort || a.idx - b.idx);
  return items.map(({ text, completed }) => ({ text, completed }));
}

function clientRef(c: { id: string; name: string; status: RawClientRef['status'] } | null | undefined): RawClientRef | null {
  return c ? { id: c.id, name: c.name, status: c.status } : null;
}

function projectRef(p: { id: string; name: string; status: RawProjectRef['status'] } | null | undefined): RawProjectRef | null {
  return p ? { id: p.id, name: p.name, status: p.status } : null;
}

function arcRef(a: RawArcRef | null | undefined): RawArcRef | null {
  return a
    ? {
        id: a.id,
        name: a.name,
        client_id: a.client_id,
        project_id: a.project_id,
        closed_at: a.closed_at,
        snoozed_until: a.snoozed_until,
      }
    : null;
}

// ============================================================================
// Tasks
// ============================================================================

const CLOSED = [...CLOSED_TASK_STATUSES];
/** The tag a worker puts on a task it assigned to a bot and stopped on. */
const NEEDS_MIKE_TAG = 'needs-mike';

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  tags: true,
  promised_to: true,
  hard_due_at: true,
  hard_due_source: true,
  created_by_id: true,
  due_date: true,
  created_at: true,
  estimated_minutes: true,
  energy_estimate: true,
  mystery_factor: true,
  battery_impact: true,
  site_id: true,
  charter_id: true,
  accord_id: true,
  billing_amount: true,
  requested_by_contact_id: true,
  client_visible: true,
  requirements: true,
  origin_url: true,
  staging_preview_url: true,
  client: { select: CLIENT_SELECT },
  project: { select: PROJECT_SELECT },
  arc: { select: ARC_SELECT },
  sop: { select: { id: true, title: true } },
  requested_by_contact: { select: { name: true } },
  blocking: { where: { is_deleted: false, status: { notIn: CLOSED } }, select: { id: true } },
  email_asks: { where: { state: 'open' }, select: { id: true }, take: 1 },
  assignee_id: true,
} satisfies Prisma.TaskSelect;

/**
 * The owner's open tasks, plus (Slice 3) open tasks assigned to a bot and tagged needs-mike, marked bot_task: Bast
 * stopped on those and needs the owner. Same project filter for both.
 */
async function loadTasks(db: PrismaClient, userId: string): Promise<RawTask[]> {
  const rows = await db.task.findMany({
    where: {
      is_deleted: false,
      status: { notIn: CLOSED },
      OR: [
        { assignee_id: userId },
        { assignee_id: { in: [...BOT_USER_IDS] }, tags: { has: NEEDS_MIKE_TAG } },
      ],
      AND: [{ OR: [{ project_id: null }, { project: { status: { notIn: [...EXCLUDED_PROJECT_STATUSES] } } }] }],
    },
    select: TASK_SELECT,
    orderBy: { created_at: 'asc' },
  });
  if (rows.length === 0) return [];

  // The human half of the person-waiting clock (same rule as /api/waiting-on-me): created_at,
  // moved forward only by the newest comment from a user outside BOT_USER_IDS.
  const humanComments = await db.comment.findMany({
    where: {
      task_id: { in: rows.map((t) => t.id) },
      is_deleted: false,
      user_id: { notIn: [...BOT_USER_IDS] },
    },
    select: { task_id: true, created_at: true },
    orderBy: { created_at: 'desc' },
  });
  const lastHuman = new Map<string, Date>();
  for (const c of humanComments) {
    if (!lastHuman.has(c.task_id)) lastHuman.set(c.task_id, c.created_at);
  }

  return rows.map((t): RawTask => {
    const human = lastHuman.get(t.id) ?? null;
    const clock = human && human.getTime() > t.created_at.getTime() ? human : t.created_at;
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      tags: t.tags,
      promised_to: t.promised_to,
      hard_due_at: t.hard_due_at,
      hard_due_source: t.hard_due_source,
      created_by_id: t.created_by_id,
      due_date: t.due_date,
      created_at: t.created_at,
      clock_started_at: clock,
      estimated_minutes: t.estimated_minutes,
      energy_estimate: t.energy_estimate,
      mystery_factor: t.mystery_factor,
      battery_impact: t.battery_impact,
      client: clientRef(t.client),
      project: projectRef(t.project),
      site_id: t.site_id,
      charter_id: t.charter_id,
      accord_id: t.accord_id,
      billing_amount: toNumber(t.billing_amount),
      requested_by_contact_id: t.requested_by_contact_id,
      requested_by_name: t.requested_by_contact?.name ?? null,
      client_visible: t.client_visible,
      open_blocking_count: t.blocking.length,
      has_open_email_ask: t.email_asks.length > 0,
      arc: arcRef(t.arc),
      requirements: readRequirements(t.requirements),
      sop: t.sop ? { id: t.sop.id, title: t.sop.title } : null,
      origin_url: t.origin_url,
      staging_preview_url: t.staging_preview_url,
      bot_task: t.assignee_id !== userId && !!t.assignee_id && (BOT_USER_IDS as readonly string[]).includes(t.assignee_id),
    };
  });
}

/** U's open tasks on held (quote, queue, suspended) projects, grouped by project with the project name. */
async function loadHeldProjects(db: PrismaClient, userId: string): Promise<RawHeldProject[]> {
  const groups = await db.task.groupBy({
    by: ['project_id'],
    where: {
      assignee_id: userId,
      is_deleted: false,
      status: { notIn: CLOSED },
      project: { status: { in: [...HELD_PROJECT_STATUSES] } },
    },
    _count: { _all: true },
  });
  const counted = groups.filter((g): g is typeof g & { project_id: string } => g.project_id !== null);
  if (counted.length === 0) return [];
  const projects = await db.project.findMany({
    where: { id: { in: counted.map((g) => g.project_id) } },
    select: { id: true, name: true },
  });
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return counted
    .map((g): RawHeldProject => ({
      project: { id: g.project_id, name: names.get(g.project_id) ?? 'A project' },
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.project.name.localeCompare(b.project.name));
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

/** The keeper's own Handled lines: source keeper, last 72 hours, not undone, newest first. */
async function loadKeeperLines(db: PrismaClient, userId: string, now: Date): Promise<RawKeeperLine[]> {
  const rows = await db.homeAction.findMany({
    where: {
      user_id: userId,
      source: 'keeper',
      created_at: { gte: new Date(now.getTime() - KEEPER_LINE_MS) },
      undone_at: null,
    },
    select: { id: true, action: true, after: true, created_at: true, undo_until: true },
    orderBy: { created_at: 'desc' },
  });
  const lines: RawKeeperLine[] = [];
  for (const r of rows) {
    if (!KEEPER_ACTIONS.includes(r.action)) continue;
    const after = r.after && typeof r.after === 'object' && !Array.isArray(r.after) ? (r.after as Record<string, unknown>) : null;
    const text = typeof after?.line === 'string' ? after.line.trim() : '';
    if (!text) continue;
    lines.push({
      id: r.id,
      action: r.action as KeeperActionKind,
      text,
      details: stringList(after?.details),
      at: r.created_at,
      undo_until: r.undo_until ?? new Date(r.created_at.getTime() + KEEPER_LINE_MS),
    });
  }
  // Slice 6a: a rule he saved stays as a line while its Undo is open (seven days). Not a keeper action: his own press.
  const ruleRows = await db.homeAction.findMany({
    where: { user_id: userId, action: RULE_ACTION, undone_at: null, undo_until: { gt: now } },
    select: { id: true, action: true, after: true, created_at: true, undo_until: true },
    orderBy: { created_at: 'desc' },
    take: 20,
  });
  for (const r of ruleRows) {
    const after = r.after && typeof r.after === 'object' && !Array.isArray(r.after) ? (r.after as Record<string, unknown>) : null;
    const text = typeof after?.line === 'string' ? after.line.trim() : '';
    if (r.action !== RULE_ACTION || !text || !r.undo_until) continue;
    lines.push({ id: r.id, action: 'not_emergency_rule', text, details: [], at: r.created_at, undo_until: r.undo_until });
  }
  // Slice 7b: a Learned line stays while its Undo is open (seven days).
  const learnedRows = await db.homeAction.findMany({
    where: { user_id: userId, action: LEARNED_ACTION, source: 'keeper', undone_at: null, undo_until: { gt: now } },
    select: { id: true, action: true, after: true, created_at: true, undo_until: true },
    orderBy: { created_at: 'desc' },
    take: 20,
  });
  for (const r of learnedRows) {
    const after = r.after && typeof r.after === 'object' && !Array.isArray(r.after) ? (r.after as Record<string, unknown>) : null;
    const text = typeof after?.line === 'string' ? after.line.trim() : '';
    if (r.action !== LEARNED_ACTION || !text || !r.undo_until) continue;
    lines.push({ id: r.id, action: 'keeper_learned', text, details: stringList(after?.details), at: r.created_at, undo_until: r.undo_until });
  }
  lines.sort((a, b) => b.at.getTime() - a.at.getTime());
  return lines;
}

// ============================================================================
// Slice 6a: site incidents
// ============================================================================

/** U's open site incidents, plus uptime-mail ones closed as answered in the last 3 days (they keep their mails out of Needs you now). */
async function loadSiteIncidents(db: PrismaClient, userId: string, now: Date): Promise<RawSiteIncident[]> {
  const rows = await db.homeSiteIncident.findMany({
    where: {
      user_id: userId,
      OR: [
        { closed_at: null },
        { source: 'uptime_mail', close_reason: 'answered', closed_at: { gte: new Date(now.getTime() - ANSWERED_KEEP_MS) } },
      ],
    },
    orderBy: { started_at: 'asc' },
    take: 500,
  });
  if (rows.length === 0) return [];
  const askIds = Array.from(new Set(rows.flatMap((r) => r.ask_ids)));
  const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter((x): x is string => !!x)));
  const [asks, clients] = await Promise.all([
    askIds.length ? db.emailAsk.findMany({ where: { id: { in: askIds } }, select: { id: true, deep_link: true, received_at: true }, orderBy: { received_at: 'desc' } }) : Promise.resolve([]),
    clientIds.length ? db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const link = new Map(asks.map((a) => [a.id, a.deep_link]));
  const names = new Map(clients.map((c) => [c.id, c.name]));
  return rows.map((r): RawSiteIncident => ({
    site_id: r.site_id,
    domain: r.domain,
    client_id: r.client_id,
    client_name: r.client_id ? (names.get(r.client_id) ?? null) : null,
    source: r.source === 'kuma' ? 'kuma' : 'uptime_mail',
    ask_ids: r.ask_ids,
    started_at: r.started_at,
    last_checked_at: r.last_checked_at,
    last_check_up: r.last_check_up,
    closed_at: r.closed_at,
    close_reason: r.close_reason,
    mail_links: r.ask_ids
      .map((id) => link.get(id))
      .filter((h): h is string => !!h)
      .slice(0, 1)
      .map((href) => ({ label: 'The email thread', href })),
  }));
}

async function resolveZone(db: PrismaClient, userId: string, tz?: string): Promise<string> {
  if (tz) return tz;
  const pref = await db.userPreference.findUnique({ where: { user_id: userId }, select: { timezone: true } });
  return pref?.timezone || DEFAULT_DISPLAY_TIMEZONE;
}

// ============================================================================
// Slice 4a: Bast's owed-reply work
// ============================================================================

/** U's own home_owed_thread rows (the user id is in the where clause). */
async function loadOwedRows(db: PrismaClient, userId: string): Promise<RawHomeInputs['owed_rows']> {
  return db.homeOwedThread.findMany({ where: { user_id: userId }, select: OWED_ROW_SELECT });
}

/** When the drafter last finished a run for U (the "within the hour" stamp), or null. */
async function loadDrafterFreshAt(db: PrismaClient, userId: string): Promise<Date | null> {
  const run = await db.homeKeeperRun.findFirst({
    where: { user_id: userId, kind: OWED_RUN_KIND, finished_at: { not: null } },
    orderBy: { finished_at: 'desc' },
    select: { finished_at: true },
  });
  return run?.finished_at ?? null;
}

// ============================================================================
// Slice 4b: Send the draft
// ============================================================================

const SEND_LINE_MS = 24 * 60 * 60 * 1000;
const SEND_EXPIRE_MS = 6 * 60 * 60 * 1000;

/**
 * U's own switch (HomeKeeperSettings.owed_send; no settings row is off) and U's presses on Send the draft in the last 24 hours
 * that were not undone, each with where its held outbox row stands. A press whose switch is now off, or whose hold ended long
 * ago without a send, reads as not sent. Reads only.
 */
async function loadOwedSend(db: PrismaClient, userId: string, now: Date): Promise<{ on: boolean; sends: RawOwedSend[] }> {
  const settings = await db.homeKeeperSettings.findUnique({ where: { user_id: userId }, select: { owed_send: true } });
  const on = settings?.owed_send === true;
  const actions = await db.homeAction.findMany({
    where: { user_id: userId, action: SEND_ACTION, undone_at: null, created_at: { gte: new Date(now.getTime() - SEND_LINE_MS) } },
    select: { id: true, item_key: true, after: true, created_at: true },
    orderBy: { created_at: 'desc' },
    take: 50,
  });
  if (actions.length === 0) return { on, sends: [] };
  const afterOf = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const ids = actions.map((a) => afterOf(a.after).outbox_id).filter((x): x is string => typeof x === 'string');
  const rows = ids.length
    ? await db.emailOutbox.findMany({ where: { id: { in: ids } }, select: { id: true, sent_at: true, superseded_at: true, superseded_reason: true, last_error: true, attempts: true } })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sends: RawOwedSend[] = [];
  for (const a of actions) {
    const after = afterOf(a.after);
    const out = typeof after.outbox_id === 'string' ? byId.get(after.outbox_id) : undefined;
    const sendAfter = typeof after.send_after === 'string' ? new Date(after.send_after) : null;
    if (!a.item_key || !out || !sendAfter || Number.isNaN(sendAfter.getTime())) continue;
    if (out.superseded_reason === 'cancelled_by_mike') continue;
    let status: RawOwedSend['status'] = 'pending';
    let reason: string | null = null;
    if (out.sent_at) status = 'sent';
    else if (out.superseded_at) {
      status = 'failed';
      reason = out.superseded_reason;
    } else if (!on) {
      status = 'failed';
      reason = 'send_off';
    } else if (out.attempts > 0 && out.last_error) {
      status = 'failed';
      reason = out.last_error;
    } else if (now.getTime() - sendAfter.getTime() > SEND_EXPIRE_MS) {
      status = 'failed';
      reason = 'expired';
    }
    sends.push({
      action_id: a.id,
      item_key: a.item_key,
      who: typeof after.who === 'string' && after.who ? after.who : 'them',
      send_after: sendAfter,
      pressed_at: a.created_at,
      status,
      reason,
    });
  }
  return { on, sends };
}

// ============================================================================
// Review sign-offs
// ============================================================================

async function loadReviewFolds(db: PrismaClient, userId: string): Promise<RawReviewFold[]> {
  // Same rule as /api/waiting-on-me's awaiting-review sweep.
  const rows = await db.task.findMany({
    where: {
      is_deleted: false,
      status: 'done',
      needs_review: true,
      approved: false,
      OR: [{ reviewer_id: null }, { reviewer_id: userId }],
    },
    select: {
      id: true,
      title: true,
      completed_at: true,
      updated_at: true,
      project: { select: { ...PROJECT_SELECT, client: { select: CLIENT_SELECT } } },
    },
  });

  type Piece = { id: string; title: string; completed_at: Date | null; at: Date };
  const groups = new Map<
    string,
    { project: RawProjectRef | null; client: RawClientRef | null; pieces: Piece[] }
  >();
  for (const r of rows) {
    const key = r.project?.id ?? 'none';
    let g = groups.get(key);
    if (!g) {
      g = {
        project: r.project ? projectRef(r.project) : null,
        client: r.project ? clientRef(r.project.client) : null,
        pieces: [],
      };
      groups.set(key, g);
    }
    g.pieces.push({ id: r.id, title: r.title, completed_at: r.completed_at, at: r.completed_at ?? r.updated_at });
  }

  const folds: RawReviewFold[] = [];
  for (const g of groups.values()) {
    g.pieces.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
    // Clock: the earliest finished piece; updated_at only for pieces with no completed_at.
    const completed = g.pieces.filter((p) => p.completed_at).map((p) => p.completed_at as Date);
    const waitingSince = completed.length > 0 ? new Date(Math.min(...completed.map((d) => d.getTime()))) : g.pieces[0].at;
    folds.push({
      project: g.project,
      client: g.client,
      pieces: g.pieces.map((p) => ({ id: p.id, title: p.title, completed_at: p.completed_at })),
      waiting_since: waitingSince,
    });
  }
  folds.sort((a, b) => a.waiting_since.getTime() - b.waiting_since.getTime());
  return folds;
}

// ============================================================================
// Session asks
// ============================================================================

async function loadSessionAsks(db: PrismaClient): Promise<RawSessionAsk[]> {
  const rows = await db.oracleSession.findMany({
    where: {
      waiting_on: { not: null },
      archived_at: null,
      status: { notIn: [...EXCLUDED_SESSION_STATUSES] },
    },
    select: {
      id: true,
      external_id: true,
      title: true,
      waiting_on: true,
      ask_queue: true,
      ask_severity: true,
      status: true,
      remote_url: true,
      last_event_at: true,
      updated_at: true,
      arc: {
        select: {
          ...ARC_SELECT,
          client: { select: CLIENT_SELECT },
          project: { select: PROJECT_SELECT },
        },
      },
    },
    orderBy: { last_event_at: 'desc' },
  });

  const asks: RawSessionAsk[] = [];
  for (const s of rows) {
    const text = s.waiting_on?.trim();
    if (!text) continue; // a blank ask is not an ask
    if (!isItemKey(`session:${s.external_id}`)) continue; // cannot be keyed (whitespace, too long)
    asks.push({
      id: s.id,
      external_id: s.external_id,
      title: s.title,
      waiting_on: s.waiting_on as string,
      ask_queue: s.ask_queue,
      ask_severity: s.ask_severity,
      status: s.status,
      remote_url: s.remote_url,
      asked_at: s.last_event_at ?? s.updated_at,
      arc: s.arc ? arcRef(s.arc) : null,
      client: s.arc ? clientRef(s.arc.client) : null,
      project: s.arc ? projectRef(s.arc.project) : null,
    });
  }

  // The same external_id can exist on two machines; the key carries only external_id, so keep
  // the newest by activity (H3 ruling). Newest first also gives the screen a stable order.
  asks.sort((a, b) => b.asked_at.getTime() - a.asked_at.getTime() || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  return asks.filter((a) => {
    if (seen.has(a.external_id)) return false;
    seen.add(a.external_id);
    return true;
  });
}

// ============================================================================
// Waits
// ============================================================================

async function loadWaits(db: PrismaClient, userId: string): Promise<RawWait[]> {
  const candidates = await loadWaitCandidates(db);
  const mine = candidates.filter(
    (c) => c.resolved_user_id === userId && (OPEN_WAIT_STATES as readonly string[]).includes(c.state)
  );
  if (mine.length === 0) return [];

  // loadWaitCandidates leaves out template_key, detail, started_at, charter_id and the email
  // fields, so read those for the user's waits in a second query (H3 ruling).
  const rows = await db.wait.findMany({
    where: { id: { in: mine.map((c) => c.id) } },
    select: {
      id: true,
      kind: true,
      template_key: true,
      state: true,
      title: true,
      detail: true,
      started_at: true,
      due_at: true,
      blocks_client: true,
      client_waiting_since: true,
      task_id: true,
      approval_request_id: true,
      charter_id: true,
      email_thread_id: true,
      email_account: true,
      client: { select: CLIENT_SELECT },
      project: { select: PROJECT_SELECT },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const out: RawWait[] = [];
  for (const c of mine) {
    const w = byId.get(c.id);
    if (!w) continue; // resolved between the two reads
    out.push({
      id: w.id,
      kind: w.kind as WaitKind,
      template_key: w.template_key,
      state: w.state as WaitState,
      title: w.title,
      detail: w.detail,
      started_at: w.started_at,
      due_at: w.due_at,
      blocks_client: w.blocks_client,
      client_waiting_since: w.client_waiting_since,
      client: clientRef(w.client),
      project: projectRef(w.project),
      task_id: w.task_id,
      approval_request_id: w.approval_request_id,
      charter_id: w.charter_id,
      email_thread_id: w.email_thread_id,
      email_account: w.email_account,
    });
  }
  return out; // candidates arrive ordered by due_at asc
}

// ============================================================================
// Email asks: threads, crisis mail, auto-closes
// ============================================================================

const ASK_SELECT = {
  id: true,
  message_id: true,
  thread_id: true,
  account: true,
  from_name: true,
  from_email: true,
  subject: true,
  gist: true,
  intent: true,
  is_urgent: true,
  state: true,
  task_id: true,
  arc_id: true,
  draft_url: true,
  draft_started_at: true,
  deep_link: true,
  received_at: true,
  client: { select: CLIENT_SELECT },
  project: { select: PROJECT_SELECT },
} satisfies Prisma.EmailAskSelect;

type AskRow = Prisma.EmailAskGetPayload<{ select: typeof ASK_SELECT }>;

function toRawAsk(a: AskRow): RawEmailAsk {
  return {
    id: a.id,
    message_id: a.message_id,
    thread_id: a.thread_id,
    account: a.account,
    from_name: a.from_name,
    from_email: a.from_email,
    subject: a.subject,
    gist: a.gist,
    intent: a.intent,
    is_urgent: a.is_urgent,
    state: a.state,
    client: clientRef(a.client),
    project: projectRef(a.project),
    task_id: a.task_id,
    arc_id: a.arc_id,
    draft_url: a.draft_url,
    draft_started_at: a.draft_started_at,
    deep_link: a.deep_link,
    received_at: a.received_at,
  };
}

async function loadThreads(db: PrismaClient): Promise<RawThread[]> {
  const rows = await db.emailAsk.findMany({
    where: { state: 'open', is_urgent: false },
    select: ASK_SELECT,
    orderBy: { received_at: 'desc' },
  });

  // Group by (account, thread_id, or message_id when the ask has no thread). Rows arrive
  // newest first, so each group's asks are newest first and groups run newest thread first.
  const groups = new Map<string, RawThread>();
  for (const r of rows) {
    const threadId = r.thread_id ?? r.message_id;
    if (r.account.includes(':') || !isItemKey(`thread:${r.account}:${threadId}`)) continue; // cannot be keyed
    const k = `${r.account}\u0000${threadId}`;
    let g = groups.get(k);
    if (!g) {
      g = { account: r.account, thread_id: threadId, asks: [] };
      groups.set(k, g);
    }
    g.asks.push(toRawAsk(r));
  }
  return [...groups.values()];
}

async function loadCrises(db: PrismaClient): Promise<RawCrisis[]> {
  const rows = await db.emailAsk.findMany({
    where: { state: 'open', is_urgent: true },
    select: ASK_SELECT,
    orderBy: { received_at: 'desc' },
  });
  return rows.map(toRawAsk);
}

async function loadAutoHandled(db: PrismaClient, now: Date): Promise<RawAutoHandled[]> {
  const rows = await db.emailAsk.findMany({
    where: {
      state: 'handled',
      updated_at: { gte: new Date(now.getTime() - DAY_MS) },
      training_note: { startsWith: AUTO_HANDLED_NOTE_PREFIX },
    },
    select: {
      id: true,
      from_name: true,
      from_email: true,
      subject: true,
      gist: true,
      deep_link: true,
      updated_at: true,
      client: { select: { name: true } },
    },
    orderBy: { updated_at: 'desc' },
    take: AUTO_HANDLED_TAKE,
  });
  return rows.map((r) => ({
    id: r.id,
    from_name: r.from_name,
    from_email: r.from_email,
    subject: r.subject,
    gist: r.gist,
    client_name: r.client?.name ?? null,
    deep_link: r.deep_link,
    handled_at: r.updated_at,
  }));
}

// ============================================================================
// Calendar
// ============================================================================

async function loadCalendarEvents(db: PrismaClient, userId: string, now: Date, tz?: string): Promise<RawCalendarEvent[]> {
  let zone = tz;
  if (!zone) {
    const pref = await db.userPreference.findUnique({ where: { user_id: userId }, select: { timezone: true } });
    zone = pref?.timezone || DEFAULT_DISPLAY_TIMEZONE;
  }
  const { start, end } = zonedDayBounds(now, zone);
  const rows = await db.calendarEvent.findMany({
    where: { starts_at: { lt: end }, ends_at: { gt: start } },
    select: { id: true, title: true, starts_at: true, ends_at: true, all_day: true },
    orderBy: { starts_at: 'asc' },
  });
  return rows;
}

// ============================================================================
// The loader
// ============================================================================

/**
 * Every read the home screen needs for `userId`, as of `now`. Read-only; one Promise.all.
 * `opts.timezone` is the user's IANA zone (the route already resolved it); without it the
 * loader reads the user's own preference.
 */
export async function loadHomeInputs(
  db: PrismaClient,
  userId: string,
  now: Date,
  opts: LoadHomeOptions = {}
): Promise<RawHomeInputs> {
  const [tasks, reviewFolds, sessionAsks, waits, threads, crises, autoHandled, calendarEvents, heldProjects, keeperLines, owedRows, drafterFreshAt, siteIncidents, notEmergencyRules, projectSteps, weights, timezone] =
    await Promise.all([
      loadTasks(db, userId),
      loadReviewFolds(db, userId),
      loadSessionAsks(db),
      loadWaits(db, userId),
      loadThreads(db),
      loadCrises(db),
      loadAutoHandled(db, now),
      loadCalendarEvents(db, userId, now, opts.timezone),
      loadHeldProjects(db, userId),
      loadKeeperLines(db, userId, now),
      loadOwedRows(db, userId),
      loadDrafterFreshAt(db, userId),
      loadSiteIncidents(db, userId, now),
      loadNotEmergencyRules(db, userId),
      loadProjectSteps(db, userId),
      loadWeights(db, userId),
      resolveZone(db, userId, opts.timezone),
    ]);

  // After the parallel reads, so the earlier home_actions reads keep their order.
  const owedSend = await loadOwedSend(db, userId, now);

  return {
    user_id: userId,
    now,
    tasks,
    review_folds: reviewFolds,
    session_asks: sessionAsks,
    waits,
    threads,
    crises,
    auto_handled: autoHandled,
    calendar_events: calendarEvents,
    held_project_task_count: heldProjects.reduce((n, h) => n + h.count, 0),
    held_projects: heldProjects,
    keeper_lines: keeperLines,
    owed_rows: owedRows,
    drafter_fresh_at: drafterFreshAt,
    timezone,
    site_incidents: siteIncidents,
    not_emergency_rules: notEmergencyRules,
    project_steps: projectSteps,
    weights,
    owed_send: owedSend.on,
    owed_sends: owedSend.sends,
  };
}
