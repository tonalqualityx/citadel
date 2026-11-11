/**
 * Slice 2c keeper: real Arc records and stale-arc housekeeping. Shipped switched OFF.
 *
 * This is the first keeper code that writes outside the home screen's own rows (Arc rows and Task.arc_id), so:
 * - every such write is gated on its switch in the owner's home_keeper_settings row, read again inside the transaction
 *   (no row means every switch is false);
 * - Task.arc_id is written only on tasks whose assignee_id is the owner, never on a bot task;
 * - an arc holding an open task of another human (anyone but the owner and BOT_USER_IDS) is never closed;
 * - today's home_day.arc_id is never closed;
 * - nothing is ever deleted.
 * Planning reads only; applyArcs does the writes, one home_actions row (source keeper) per arc made or closed.
 */

import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { ARC_KEEPER, CLOSED_TASK_STATUSES, KEEPER } from '../rules';
import { displayText } from '../copy';
import { parseGroupKey, taskKey } from '../item-key';
import { appendHomeAction, getHomeDay, type HomeDb } from '../state';
import { rankCompare, selectHome } from '../select';
import { proposeDay } from '../today';
import { withReadings } from './plan';
import { arcClosedLine, arcMadeLine } from './lines';
import type { ArcRecord } from '../act';
import type {
  KeeperArcClose,
  KeeperArcMake,
  KeeperArcSwitches,
  RawHomeInputs,
  RawItemState,
} from '../types';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const CLOSED = [...CLOSED_TASK_STATUSES];
const isClosed = (status: string): boolean => (CLOSED as string[]).includes(status);
const DESCRIPTION = "Made by the home screen's nightly sort.";
/** How long after an Undo the keeper leaves the same arc, client or project alone. */
const HOLD_DAYS = KEEPER.holdDays;

export const SWITCHES_OFF: KeeperArcSwitches = { arcs_create: false, arcs_close: false, arcs_link_tasks: false };

/** The owner's three switches. No row, or a read that fails to find one, is all false. */
export async function loadArcSwitches(db: HomeDb, ownerId: string): Promise<KeeperArcSwitches> {
  const row = await db.homeKeeperSettings.findUnique({
    where: { user_id: ownerId },
    select: { arcs_create: true, arcs_close: true, arcs_link_tasks: true },
  });
  if (!row) return { ...SWITCHES_OFF };
  return { arcs_create: row.arcs_create === true, arcs_close: row.arcs_close === true, arcs_link_tasks: row.arcs_link_tasks === true };
}

/** A close the planner chose, with the arc's updated_at it saw (the write is guarded on it). */
export interface PlannedClose extends KeeperArcClose {
  seen_updated_at: string;
}

export interface ArcPlan {
  make: KeeperArcMake | null;
  close: PlannedClose[];
}

const otherHumans = (ownerId: string): string[] => [ownerId, ...BOT_USER_IDS];

/** Arcs, clients and projects an Undo of the keeper's own arc lines put on hold in the last 30 days. */
async function heldByUndo(db: HomeDb, ownerId: string, now: Date) {
  const rows = await db.homeAction.findMany({
    where: {
      user_id: ownerId,
      source: 'keeper',
      action: { in: ['keeper_arc_create', 'keeper_arc_close'] },
      undone_at: { not: null },
      created_at: { gte: new Date(now.getTime() - HOLD_DAYS * DAY_MS) },
    },
    select: { action: true, before: true },
  });
  const arcs = new Set<string>();
  const clients = new Set<string>();
  const projects = new Set<string>();
  for (const r of rows) {
    const recs = (r.before as { arcs?: ArcRecord[] } | null)?.arcs ?? [];
    for (const rec of recs) {
      if (rec.kind === 'close') arcs.add(rec.arc_id);
      if (rec.kind === 'create') {
        arcs.add(rec.arc_id);
        if (rec.client_id) clients.add(rec.client_id);
        if (rec.project_id) projects.add(rec.project_id);
      }
    }
  }
  return { arcs, clients, projects };
}

/** Open = not closed and not snoozed past now. */
const openArcWhere = (now: Date) => ({
  closed_at: null,
  OR: [{ snoozed_until: null }, { snoozed_until: { lte: now } }],
});

/** The group Today would propose, when it earns an arc. Reads only. */
async function planMake(
  db: HomeDb,
  raw: RawHomeInputs,
  states: readonly RawItemState[],
  now: Date,
  held: Awaited<ReturnType<typeof heldByUndo>>,
): Promise<KeeperArcMake | null> {
  const after = withReadings(states, raw, now);
  const sel = selectHome({ raw, states: after, now });
  const day = proposeDay(sel, raw.calendar_events, now);
  if (!day) return null;
  const g = parseGroupKey(day.group_key);
  if (!g || (g.kind !== 'client' && g.kind !== 'project')) return null;
  if (g.kind === 'client' ? held.clients.has(g.id) : held.projects.has(g.id)) return null;

  const mine = raw.tasks.filter((t) => {
    if (t.bot_task || t.arc) return false;
    return g.kind === 'client' ? t.client?.id === g.id : !t.client && t.project?.id === g.id;
  });
  if (mine.length < 2) return null;

  const existing = await db.arc.findFirst({
    where: { ...openArcWhere(now), ...(g.kind === 'client' ? { client_id: g.id } : { project_id: g.id }) },
    select: { id: true },
  });
  if (existing) return null;

  const rank = (id: string) => sel.byKey.get(taskKey(id));
  const chosen = [...mine]
    .sort((a, b) => {
      const ca = rank(a.id);
      const cb = rank(b.id);
      if (ca && cb) return rankCompare(ca, cb);
      return ca ? -1 : cb ? 1 : a.title.localeCompare(b.title);
    })
    .slice(0, ARC_KEEPER.linkCap);
  const name = (g.kind === 'client' ? mine[0].client?.name : mine[0].project?.name) ?? day.group_label;
  const clean = name.trim().slice(0, 300);
  if (!clean) return null;
  return {
    group_key: day.group_key,
    name: clean,
    client_id: g.kind === 'client' ? g.id : null,
    project_id: g.kind === 'project' ? g.id : null,
    task_ids: chosen.map((t) => t.id),
    task_titles: chosen.map((t) => displayText(t.title)),
    line: arcMadeLine(clean, chosen.length),
  };
}

/** Arcs to close tonight: all steps done first, then stale ones, oldest first, at most 5. Reads only. */
async function planClose(
  db: HomeDb,
  ownerId: string,
  now: Date,
  held: Awaited<ReturnType<typeof heldByUndo>>,
  todayDate: string,
): Promise<PlannedClose[]> {
  const today = await getHomeDay(db, ownerId, todayDate);
  const cutoff = new Date(now.getTime() - ARC_KEEPER.staleDays * DAY_MS);
  const arcs = await db.arc.findMany({
    where: { ...openArcWhere(now), ...(today?.arc_id ? { id: { not: today.arc_id } } : {}) },
    select: {
      id: true,
      name: true,
      updated_at: true,
      tasks: { where: { is_deleted: false }, select: { status: true, assignee_id: true, updated_at: true } },
    },
    orderBy: { updated_at: 'asc' },
  });
  const bots = new Set(otherHumans(ownerId));
  const out: PlannedClose[] = [];
  for (const a of arcs) {
    if (held.arcs.has(a.id)) continue;
    const open = a.tasks.filter((t) => !isClosed(t.status));
    if (open.some((t) => t.assignee_id && !bots.has(t.assignee_id))) continue;
    const allDone = a.tasks.length > 0 && open.length === 0 && a.tasks.some((t) => t.status === 'done');
    const stale = a.updated_at < cutoff && a.tasks.every((t) => t.updated_at < cutoff);
    if (!allDone && !stale) continue;
    const reason = allDone ? 'all_done' : 'stale';
    out.push({
      arc_id: a.id,
      name: a.name,
      reason,
      open_tasks: reason === 'all_done' ? 0 : open.length,
      line: arcClosedLine(a.name, reason, reason === 'all_done' ? 0 : open.length),
      seen_updated_at: a.updated_at.toISOString(),
    });
  }
  out.sort((x, y) => (x.reason === y.reason ? 0 : x.reason === 'all_done' ? -1 : 1));
  return out.slice(0, ARC_KEEPER.maxClosePerNight);
}

/**
 * What the arc rules would do tonight, whatever the switches say. Reads only.
 * `want` limits the work: a real run with a switch off does not plan that part at all.
 */
export async function planArcs(
  db: HomeDb,
  ownerId: string,
  raw: RawHomeInputs,
  states: readonly RawItemState[],
  now: Date,
  todayDate: string,
  want: { make: boolean; close: boolean } = { make: true, close: true },
): Promise<ArcPlan> {
  const held = await heldByUndo(db, ownerId, now);
  return {
    make: want.make ? await planMake(db, raw, states, now, held) : null,
    close: want.close ? await planClose(db, ownerId, now, held, todayDate) : [],
  };
}

export interface ArcApplyResult {
  /** The switches as read inside the transaction. */
  switches: KeeperArcSwitches;
  made: KeeperArcMake[];
  closed: KeeperArcClose[];
  action_ids: string[];
}

/**
 * The writes, inside the keeper's transaction. The switches are read again here and a write happens only when its
 * switch is true now. Every write re-checks what the plan assumed and skips quietly when it no longer holds.
 */
export async function applyArcs(
  tx: HomeDb,
  ownerId: string,
  plan: ArcPlan,
  now: Date,
  todayDate: string,
): Promise<ArcApplyResult> {
  const sw = await loadArcSwitches(tx, ownerId);
  const result: ArcApplyResult = { switches: sw, made: [], closed: [], action_ids: [] };
  const undoUntil = new Date(now.getTime() + KEEPER.undoHours * HOUR_MS);

  if (sw.arcs_create && plan.make) {
    const m = plan.make;
    const noArc = await tx.arc.findFirst({
      where: { ...openArcWhere(now), ...(m.client_id ? { client_id: m.client_id } : { project_id: m.project_id as string }) },
      select: { id: true },
    });
    // Still his, still open, still without an arc (the second lock on Task.arc_id).
    const tasks = noArc
      ? []
      : await tx.task.findMany({
          where: { id: { in: m.task_ids }, assignee_id: ownerId, arc_id: null, is_deleted: false, status: { notIn: CLOSED } },
          select: { id: true, title: true },
        });
    if (tasks.length >= 2) {
      const arc = await tx.arc.create({
        data: { name: m.name, description: DESCRIPTION, client_id: m.client_id, project_id: m.project_id },
        select: { id: true },
      });
      const linked: { id: string; title: string }[] = [];
      for (const t of tasks) {
        const r = await tx.task.updateMany({
          where: { id: t.id, assignee_id: ownerId, arc_id: null, is_deleted: false, status: { notIn: CLOSED } },
          data: { arc_id: arc.id },
        });
        if (r.count === 1) linked.push(t);
      }
      const rec: ArcRecord = { kind: 'create', arc_id: arc.id, client_id: m.client_id, project_id: m.project_id, task_ids: linked.map((t) => t.id) };
      const line = arcMadeLine(m.name, linked.length);
      const row = await appendHomeAction(tx, ownerId, {
        item_key: null,
        action: 'keeper_arc_create',
        source: 'keeper',
        before: { states: [], arcs: [rec] },
        after: { states: [], arcs: [rec], line, details: linked.map((t) => displayText(t.title)) },
        undo_until: undoUntil,
      });
      result.action_ids.push(row.id);
      result.made.push({ ...m, task_ids: linked.map((t) => t.id), task_titles: linked.map((t) => displayText(t.title)), line });
    }
  }

  if (sw.arcs_close && plan.close.length > 0) {
    const today = await getHomeDay(tx, ownerId, todayDate);
    const cutoff = new Date(now.getTime() - ARC_KEEPER.staleDays * DAY_MS);
    const others = otherHumans(ownerId);
    for (const c of plan.close.slice(0, ARC_KEEPER.maxClosePerNight)) {
      if (today?.arc_id === c.arc_id) continue;
      // Another human's open task: never.
      const theirs = await tx.task.count({
        where: { arc_id: c.arc_id, is_deleted: false, status: { notIn: CLOSED }, assignee_id: { notIn: others } },
      });
      if (theirs > 0) continue;
      const openNow = await tx.task.count({ where: { arc_id: c.arc_id, is_deleted: false, status: { notIn: CLOSED } } });
      if (c.reason === 'all_done' && openNow > 0) continue;
      if (c.reason === 'stale') {
        const touched = await tx.task.count({ where: { arc_id: c.arc_id, is_deleted: false, updated_at: { gte: cutoff } } });
        if (touched > 0) continue;
      }
      const r = await tx.arc.updateMany({
        where: { id: c.arc_id, closed_at: null, updated_at: new Date(c.seen_updated_at) },
        data: { closed_at: now },
      });
      if (r.count !== 1) continue;
      const rec: ArcRecord = { kind: 'close', arc_id: c.arc_id, closed_at: now.toISOString() };
      const line = arcClosedLine(c.name, c.reason, c.reason === 'all_done' ? 0 : openNow);
      const row = await appendHomeAction(tx, ownerId, {
        item_key: null,
        action: 'keeper_arc_close',
        source: 'keeper',
        before: { states: [], arcs: [rec] },
        after: { states: [], arcs: [rec], line, details: [] },
        undo_until: undoUntil,
      });
      result.action_ids.push(row.id);
      result.closed.push({ arc_id: c.arc_id, name: c.name, reason: c.reason, open_tasks: c.reason === 'all_done' ? 0 : openNow, line });
    }
  }
  return result;
}
