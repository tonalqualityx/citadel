/**
 * Slice 7a: the reads behind the measures, and the nightly snapshot. Read only, every query scoped to the owner.
 * Nothing here writes; run.ts writes home_measures, the learn run row and the keeper lines.
 */

import type { PrismaClient, TaskStatus } from '@prisma/client';
import { addBusinessDays } from '@/lib/waits/business-days';
import { zonedToUtc } from '../act';
import { loadHomeInputs } from '../load';
import { crisisKey, reviewKey, siteKey, taskKey, threadKey, waitKey } from '../item-key';
import {
  CLIENT_WAIT_EMERGENCY_BUSINESS_DAYS,
  CLOSED_TASK_STATUSES,
  EXCLUDED_PROJECT_STATUSES,
  businessDaysElapsed,
  hasClientBlockingTag,
  hasLifelineTag,
  hasSecurityTag,
  isNoise,
} from '../rules';
import { selectHome } from '../select';
import { dateOnly, dateString, loadItemStates } from '../state';
import { cleanLabel } from './copy';
import type { DailySnapshot, EmergencyEvent, GuardRow, GuessError, HardDateRow, OwedEntry, TaskChange, TodayDay } from './measures';
import { EFFORT, countedMinutes, guessDrain, guessMinutes, guessUnknowns } from './effort';
import { APPROVAL_DID } from './measures';
import { addDaysYmd, isWeekdayYmd, parseYmd, ymdInZone } from './working-hours';

const MINUTE_MS = 60_000;
/** A home tap within this long of a task change counts as made here. */
export const HERE_WINDOW_MS = 2 * MINUTE_MS;
const OWED_LIST_CAP = 100;
const ROW_TAKE = 5000;

type Db = PrismaClient;

/** The instant a zoned day begins. */
function dayStart(ymd: string, tz: string): Date {
  const p = parseYmd(ymd);
  return zonedToUtc(p.y, p.m, p.d, 0, 0, tz);
}

// ============================================================================
// The nightly snapshot
// ============================================================================

/** Open items on his plate, how many are past their day, and the threads that wait for a reply. */
export async function buildDailySnapshot(db: Db, ownerId: string, now: Date, tz: string, date: string): Promise<DailySnapshot> {
  const [raw, states] = await Promise.all([loadHomeInputs(db, ownerId, now, { timezone: tz }), loadItemStates(db, ownerId)]);
  const sel = selectHome({ raw, states, now });
  const newest = new Map<string, { at: Date; label: string }>();
  for (const th of raw.threads) {
    newest.set(threadKey(th.account, th.thread_id), { at: th.asks[0].received_at, label: th.asks[0].subject });
  }
  const owed: OwedEntry[] = [];
  for (const c of sel.candidates) {
    if (c.kind !== 'thread' || !c.inView || c.parked) continue;
    const hit = newest.get(c.key);
    if (!hit) continue;
    owed.push({ key: c.key, label: cleanLabel(c.item.title || hit.label), age_bd: businessDaysElapsed(hit.at, now) });
  }
  owed.sort((a, b) => b.age_bd - a.age_bd || a.key.localeCompare(b.key));
  return {
    date,
    open_items: sel.candidates.length,
    past_day: sel.everything_else.past_day,
    owed: owed.slice(0, OWED_LIST_CAP),
  };
}

// ============================================================================
// The week
// ============================================================================

interface HomeTap {
  item_key: string | null;
  action: string;
  did: string | null;
  undo: boolean;
  at: Date;
}

function didOf(after: unknown): { did: string | null; undo: boolean } {
  const rec = after && typeof after === 'object' && !Array.isArray(after) ? (after as Record<string, unknown>).recorded : null;
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
    const r = rec as Record<string, unknown>;
    return { did: typeof r.did === 'string' ? r.did : null, undo: r.undo === true };
  }
  return { did: null, undo: false };
}

/** His own taps (source home) from `from` to `to`, oldest first. */
async function loadTaps(db: Db, ownerId: string, from: Date, to: Date): Promise<HomeTap[]> {
  const rows = await db.homeAction.findMany({
    where: { user_id: ownerId, source: 'home', created_at: { gte: from, lt: to } },
    select: { item_key: true, action: true, after: true, created_at: true },
    orderBy: { created_at: 'asc' },
    take: ROW_TAKE,
  });
  return rows.map((r) => ({ item_key: r.item_key, action: r.action, ...didOf(r.after), at: r.created_at }));
}

export interface WeekReads {
  week_start: string;
  week_end: string;
  emergencies: EmergencyEvent[];
  snapshots: DailySnapshot[];
  prev_snapshot: DailySnapshot | null;
  task_changes: TaskChange[];
  first_action_day: string | null;
  hard_dates: HardDateRow[];
  today_days: TodayDay[];
  guard_rows: GuardRow[];
  /** Slice 7c: finished tasks of the week that carried a time guess, with their counted minutes. */
  guess_errors?: GuessError[];
}

function asSnapshot(date: Date, value: unknown): DailySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const owedRaw = Array.isArray(v.owed) ? v.owed : [];
  const owed: OwedEntry[] = [];
  for (const o of owedRaw) {
    if (o && typeof o === 'object') {
      const e = o as Record<string, unknown>;
      if (typeof e.key === 'string' && typeof e.age_bd === 'number') owed.push({ key: e.key, label: typeof e.label === 'string' ? e.label : '', age_bd: e.age_bd });
    }
  }
  return {
    date: dateString(date),
    open_items: typeof v.open_items === 'number' ? v.open_items : 0,
    past_day: typeof v.past_day === 'number' ? v.past_day : 0,
    owed,
  };
}

/** Everything the weekly measures and the guard need for the Monday to Sunday week `start` to `end`. */
export async function loadWeekReads(db: Db, ownerId: string, tz: string, start: string, end: string): Promise<WeekReads> {
  const from = dayStart(start, tz);
  const to = dayStart(addDaysYmd(end, 1), tz);
  const taps = await loadTaps(db, ownerId, from, to);
  const tapsByKey = new Map<string, HomeTap[]>();
  for (const t of taps) {
    if (!t.item_key) continue;
    const list = tapsByKey.get(t.item_key) ?? [];
    list.push(t);
    tapsByKey.set(t.item_key, list);
  }
  // His taps on the emergency candidates, from any time: a task made before the week and answered before it is not unseen.
  const keyTaps = new Map<string, HomeTap[]>();
  const loadKeyTaps = async (keys: string[]): Promise<void> => {
    if (keys.length === 0) return;
    const rows = await db.homeAction.findMany({
      where: { user_id: ownerId, source: 'home', item_key: { in: keys }, created_at: { lt: to } },
      select: { item_key: true, action: true, after: true, created_at: true },
      orderBy: { created_at: 'asc' },
      take: ROW_TAKE,
    });
    for (const r of rows) {
      if (!r.item_key) continue;
      const list = keyTaps.get(r.item_key) ?? [];
      list.push({ item_key: r.item_key, action: r.action, ...didOf(r.after), at: r.created_at });
      keyTaps.set(r.item_key, list);
    }
  };
  const firstTapAfter = (key: string, after: Date): Date | null => {
    const hit = (keyTaps.get(key) ?? []).find((t) => t.at.getTime() >= after.getTime() && !t.undo);
    return hit ? hit.at : null;
  };

  const emergencies: EmergencyEvent[] = [];

  // Tasks: created in the week, or older and still open with no action of his.
  const taskRows = await db.task.findMany({
    where: {
      assignee_id: ownerId,
      is_deleted: false,
      tags: { isEmpty: false },
      OR: [{ created_at: { gte: from, lt: to } }, { status: { notIn: [...CLOSED_TASK_STATUSES] as TaskStatus[] } }],
    },
    select: { id: true, title: true, tags: true, created_at: true, status: true, client: { select: { name: true } } },
    take: ROW_TAKE,
  });
  const emergencyTasks = taskRows.filter((t) => hasSecurityTag(t.tags) || hasLifelineTag(t.tags) || hasClientBlockingTag(t.tags));
  await loadKeyTaps(emergencyTasks.map((t) => taskKey(t.id)));
  if (emergencyTasks.length) {
    const logs = await db.activityLog.findMany({
      where: {
        user_id: ownerId,
        entity_type: 'task',
        entity_id: { in: emergencyTasks.map((t) => t.id) },
        actor_lane: null,
        action: { not: 'created' },
      },
      select: { entity_id: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });
    for (const t of emergencyTasks) {
      const key = taskKey(t.id);
      const logAt = logs.find((l) => l.entity_id === t.id && l.created_at.getTime() >= t.created_at.getTime())?.created_at ?? null;
      const tapAt = firstTapAfter(key, t.created_at);
      const first = [logAt, tapAt].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const createdInWeek = t.created_at >= from && t.created_at < to;
      const open = !(CLOSED_TASK_STATUSES as readonly string[]).includes(t.status);
      if (!createdInWeek && !(open && !first)) continue;
      emergencies.push({ key, kind: 'task', label: `${t.client?.name ? `${t.client.name}: ` : ''}${t.title}`, started_at: t.created_at, first_action_at: first, cleared_on_own: false });
    }
  }

  // Urgent mail received in the week, not noise, not ruled not an emergency.
  const asks = await db.emailAsk.findMany({
    where: { is_urgent: true, received_at: { gte: from, lt: to } },
    select: { id: true, subject: true, from_email: true, state: true, received_at: true, updated_at: true, client: { select: { name: true } } },
    take: ROW_TAKE,
  });
  const askKeys = asks.map((a) => crisisKey(a.id));
  await loadKeyTaps(askKeys);
  const ruled = askKeys.length
    ? await db.homeItemState.findMany({ where: { user_id: ownerId, item_key: { in: askKeys }, not_emergency_at: { not: null } }, select: { item_key: true } })
    : [];
  const ruledSet = new Set(ruled.map((r) => r.item_key));
  for (const a of asks) {
    const key = crisisKey(a.id);
    if (ruledSet.has(key) || isNoise({ from_email: a.from_email, client_name: a.client?.name ?? null })) continue;
    const tapAt = firstTapAfter(key, a.received_at);
    const leftOpen = a.state !== 'open' ? a.updated_at : null;
    const first = [tapAt, leftOpen].filter((d): d is Date => !!d).sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
    emergencies.push({ key, kind: 'mail', label: a.subject, started_at: a.received_at, first_action_at: first, cleared_on_own: false });
  }

  // Site incidents that started in the week.
  const incidents = await db.homeSiteIncident.findMany({
    where: { user_id: ownerId, started_at: { gte: from, lt: to } },
    select: { site_id: true, domain: true, started_at: true, closed_at: true, close_reason: true },
    take: ROW_TAKE,
  });
  await loadKeyTaps(incidents.map((i) => siteKey(i.site_id)));
  for (const i of incidents) {
    const key = siteKey(i.site_id);
    const first = firstTapAfter(key, i.started_at);
    const cleared = !!i.closed_at && (!first || first.getTime() > i.closed_at.getTime()) && i.close_reason !== 'answered';
    emergencies.push({ key, kind: 'site', label: `${i.domain} down`, started_at: i.started_at, first_action_at: first, cleared_on_own: cleared });
  }

  // Client-blocking waits whose emergency clock passed in the week.
  const waits = await db.wait.findMany({
    where: {
      blocks_client: true,
      client_waiting_since: { not: null },
      OR: [{ owner_user_id: ownerId }, { owner_user_id: null, owner_function_id: null }],
    },
    select: { id: true, title: true, client_waiting_since: true, resolved_at: true, client: { select: { name: true } } },
    take: ROW_TAKE,
  });
  await loadKeyTaps(waits.map((w) => waitKey(w.id)));
  for (const w of waits) {
    if (!w.client_waiting_since) continue;
    const threshold = addBusinessDays(w.client_waiting_since, CLIENT_WAIT_EMERGENCY_BUSINESS_DAYS);
    if (threshold < from || threshold >= to) continue;
    const tapAt = firstTapAfter(waitKey(w.id), threshold);
    const resolved = w.resolved_at && w.resolved_at.getTime() >= threshold.getTime() ? w.resolved_at : null;
    const first = [tapAt, resolved].filter((d): d is Date => !!d).sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
    emergencies.push({ key: waitKey(w.id), kind: 'wait', label: `${w.client?.name ? `${w.client.name}: ` : ''}${w.title}`, started_at: threshold, first_action_at: first, cleared_on_own: false });
  }

  // Where he acts: tasks whose status or approval he changed, and whether a home tap came with it.
  const logs = await db.activityLog.findMany({
    where: { user_id: ownerId, entity_type: 'task', actor_lane: null, created_at: { gte: from, lt: to } },
    select: { entity_id: true, action: true, changes: true, created_at: true },
    orderBy: { created_at: 'asc' },
    take: ROW_TAKE,
  });
  const changed = logs.filter((l) => {
    if (l.action === 'status_changed' || l.action === 'completed') return true;
    const ch = l.changes && typeof l.changes === 'object' && !Array.isArray(l.changes) ? (l.changes as Record<string, unknown>) : null;
    return !!ch && ('status' in ch || 'approved' in ch || 'approved_at' in ch);
  });
  const changedIds = [...new Set(changed.map((l) => l.entity_id))];
  const projectOf = new Map<string, string | null>();
  if (changedIds.length) {
    const rows = await db.task.findMany({ where: { id: { in: changedIds } }, select: { id: true, project_id: true } });
    for (const r of rows) projectOf.set(r.id, r.project_id);
  }
  const isHere = (id: string, at: Date): boolean => {
    const keys = [taskKey(id)];
    const project = projectOf.get(id);
    if (project) keys.push(reviewKey(project));
    return keys.some((k) => (tapsByKey.get(k) ?? []).some((t) => Math.abs(t.at.getTime() - at.getTime()) <= HERE_WINDOW_MS));
  };
  const hereById = new Map<string, boolean>();
  for (const l of changed) hereById.set(l.entity_id, (hereById.get(l.entity_id) ?? false) || isHere(l.entity_id, l.created_at));
  const task_changes: TaskChange[] = [...hereById.entries()].map(([task_id, here]) => ({ task_id, here }));

  // Hard dates that fell in the week.
  const hardRows = await db.task.findMany({
    where: { assignee_id: ownerId, is_deleted: false, status: { notIn: ['abandoned', 'triage'] }, hard_due_at: { gte: from, lt: to } },
    select: { title: true, hard_due_at: true, completed_at: true, status: true },
    take: ROW_TAKE,
  });
  const hard_dates: HardDateRow[] = hardRows.map((t) => {
    const due = t.hard_due_at as Date;
    // A date-only value (midnight UTC) is good until the end of that day.
    const limit = due.getUTCHours() === 0 && due.getUTCMinutes() === 0 ? due.getTime() + 86_400_000 - 1 : due.getTime();
    return { label: t.title, met: t.status === 'done' && !!t.completed_at && t.completed_at.getTime() <= limit };
  });

  // His first home tap ever (the start of the log measures).
  const firstTap = await db.homeAction.aggregate({ where: { user_id: ownerId, source: 'home' }, _min: { created_at: true } });
  const first_action_day = firstTap._min.created_at ? ymdInZone(firstTap._min.created_at, tz) : null;

  // Snapshots.
  const snapRows = await db.homeMeasure.findMany({
    where: { user_id: ownerId, kind: 'daily', date: { gte: dateOnly(addDaysYmd(start, -7)), lte: dateOnly(end) } },
    select: { date: true, value: true },
    orderBy: { date: 'asc' },
  });
  const all = snapRows.map((r) => asSnapshot(r.date, r.value)).filter((s): s is DailySnapshot => !!s);
  const snapshots = all.filter((s) => s.date >= start && s.date <= end);
  const before = all.filter((s) => s.date < start && isWeekdayYmd(s.date));
  const prev_snapshot = before.length ? before[before.length - 1] : null;

  // Today: did he keep the proposed day, and were its steps done by the end of it.
  const dayRows = await db.homeDay.findMany({
    where: { user_id: ownerId, date: { gte: dateOnly(start), lte: dateOnly(end) } },
    select: { date: true, swapped_from_group: true, quick_item_keys: true, step_item_keys: true },
  });
  const stepIds = new Set<string>();
  for (const d of dayRows) for (const k of [...d.quick_item_keys, ...d.step_item_keys]) if (k.startsWith('task:')) stepIds.add(k.slice(5));
  const doneAt = new Map<string, Date>();
  if (stepIds.size) {
    const done = await db.task.findMany({ where: { id: { in: [...stepIds] }, assignee_id: ownerId, status: 'done', completed_at: { not: null } }, select: { id: true, completed_at: true } });
    for (const t of done) if (t.completed_at) doneAt.set(t.id, t.completed_at);
  }
  const today_days: TodayDay[] = dayRows.map((d) => {
    const date = dateString(d.date);
    const keys = [...new Set([...d.quick_item_keys, ...d.step_item_keys])].filter((k) => k.startsWith('task:'));
    const lo = dayStart(date, tz);
    const hi = dayStart(addDaysYmd(date, 1), tz);
    const done = keys.filter((k) => {
      const at = doneAt.get(k.slice(5));
      return !!at && at >= lo && at < hi;
    }).length;
    return { date, kept: d.swapped_from_group === null, proposed: keys.length, done };
  });

  // The guard: his first tap of the week on each sign-off or wait, with the gap since his previous tap that day.
  const prevAt = new Map<number, Date | null>();
  const dayOfTap = (t: HomeTap) => ymdInZone(t.at, tz);
  let lastOfDay: { day: string; at: Date } | null = null;
  taps.forEach((t, i) => {
    const day = dayOfTap(t);
    prevAt.set(i, lastOfDay && lastOfDay.day === day ? lastOfDay.at : null);
    lastOfDay = { day, at: t.at };
  });
  const seen = new Set<string>();
  const guard_rows: GuardRow[] = [];
  taps.forEach((t, i) => {
    if (!t.item_key || t.undo) return;
    const kind = t.item_key.slice(0, t.item_key.indexOf(':'));
    if (kind !== 'review' && kind !== 'wait') return;
    if (seen.has(t.item_key)) return;
    seen.add(t.item_key);
    const counted = t.action === 'not_now' || (t.action === 'record' && !!t.did && (APPROVAL_DID.includes(t.did) || t.did.startsWith('open_') || t.did === 'let_it_go'));
    if (!counted) return;
    const prior = prevAt.get(i) ?? null;
    guard_rows.push({ item_key: t.item_key, did: t.action === 'not_now' ? 'not_now' : (t.did as string), gap_ms: prior ? t.at.getTime() - prior.getTime() : null });
  });

  const guess_errors = await loadGuessErrors(db, ownerId, from, to);

  return { week_start: start, week_end: end, emergencies, snapshots, prev_snapshot, task_changes, first_action_day, hard_dates, today_days, guard_rows, guess_errors };
}

// ============================================================================
// Slice 7c: time guesses. Reads Task and TimeEntry, writes only the owner's home_item_state guess columns.
// ============================================================================

/** Each finished task's counted minutes for the given tasks (entries of the owner, 3 to 480 minutes, total at least 5). */
async function countedByTask(db: Db, ownerId: string, taskIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (taskIds.length === 0) return out;
  const rows = await db.timeEntry.findMany({
    where: { user_id: ownerId, is_deleted: false, is_running: false, task_id: { in: taskIds } },
    select: { task_id: true, duration: true },
    take: ROW_TAKE * 10,
  });
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.task_id) continue;
    const list = by.get(r.task_id) ?? [];
    list.push(r.duration);
    by.set(r.task_id, list);
  }
  for (const id of taskIds) out.set(id, countedMinutes(by.get(id) ?? []));
  return out;
}

/** His done tasks per SOP, as their counted minutes (null when a task does not qualify). Only the SOPs asked for. */
export async function loadHistoryBySop(db: Db, ownerId: string, sopIds: string[]): Promise<Map<string, Array<number | null>>> {
  const out = new Map<string, Array<number | null>>();
  if (sopIds.length === 0) return out;
  const done = await db.task.findMany({
    where: { assignee_id: ownerId, is_deleted: false, status: 'done', sop_id: { in: sopIds } },
    select: { id: true, sop_id: true },
    take: ROW_TAKE * 4,
  });
  const totals = await countedByTask(db, ownerId, done.map((t) => t.id));
  for (const t of done) {
    if (!t.sop_id) continue;
    const list = out.get(t.sop_id) ?? [];
    list.push(totals.get(t.id) ?? null);
    out.set(t.sop_id, list);
  }
  return out;
}

export interface GuessRun {
  /** Open tasks looked at (at most EFFORT.nightlyCap). */
  considered: number;
  /** Rows written. */
  written: number;
  history: number;
  energy: number;
  kind: number;
}

/**
 * The nightly guess step. For the owner's open tasks (not bot tasks, at most EFFORT.nightlyCap a night, never-guessed
 * and longest-ago first) it writes effort, unknowns and drain into that task's home_item_state row. A value a person
 * set is never guessed: a task with estimated_minutes gets no minutes, a non-default mystery_factor gets no unknowns,
 * a non-default battery_impact gets no drain. No Task row is touched.
 */
export async function writeGuesses(db: Db, ownerId: string, now: Date): Promise<GuessRun> {
  const tasks = await db.task.findMany({
    where: {
      assignee_id: ownerId,
      is_deleted: false,
      status: { notIn: [...CLOSED_TASK_STATUSES] as TaskStatus[] },
      AND: [{ OR: [{ project_id: null }, { project: { status: { notIn: [...EXCLUDED_PROJECT_STATUSES] } } }] }],
    },
    select: {
      id: true,
      title: true,
      description: true,
      sop_id: true,
      estimated_minutes: true,
      energy_estimate: true,
      mystery_factor: true,
      battery_impact: true,
      requirements: true,
    },
    orderBy: { created_at: 'asc' },
    take: ROW_TAKE,
  });
  const states = await db.homeItemState.findMany({
    where: { user_id: ownerId, item_key: { in: tasks.map((t) => taskKey(t.id)) } },
    select: { item_key: true, guessed_at: true },
  });
  const guessedAt = new Map(states.map((s) => [s.item_key, s.guessed_at?.getTime() ?? 0]));
  const batch = [...tasks]
    .sort((a, b) => (guessedAt.get(taskKey(a.id)) ?? 0) - (guessedAt.get(taskKey(b.id)) ?? 0))
    .slice(0, EFFORT.nightlyCap);

  const sopIds = [...new Set(batch.filter((t) => t.estimated_minutes == null && t.sop_id).map((t) => t.sop_id as string))];
  const history = await loadHistoryBySop(db, ownerId, sopIds);

  const run: GuessRun = { considered: batch.length, written: 0, history: 0, energy: 0, kind: 0 };
  for (const t of batch) {
    const personMinutes = t.estimated_minutes != null && t.estimated_minutes > 0;
    const effort = personMinutes
      ? null
      : guessMinutes({ history: t.sop_id ? history.get(t.sop_id) ?? [] : [], energy_estimate: t.energy_estimate });
    const unknowns = t.mystery_factor === 'none'
      ? guessUnknowns({ title: t.title, description: t.description, requirements: Array.isArray(t.requirements) ? t.requirements.length : 0, sop_id: t.sop_id })
      : null;
    const drain = t.battery_impact === 'average_drain' ? guessDrain({ title: t.title, description: t.description }) : null;
    const data = {
      effort_minutes: effort ? effort.minutes : null,
      effort_source: effort ? effort.source : null,
      effort_basis_n: effort ? effort.n : null,
      unknowns,
      drain,
      guessed_at: now,
    };
    const key = taskKey(t.id);
    await db.homeItemState.upsert({
      where: { user_id_item_key: { user_id: ownerId, item_key: key } },
      create: { user_id: ownerId, item_key: key, ...data },
      update: data,
    });
    run.written += 1;
    if (effort) run[effort.source] += 1;
  }
  return run;
}

/** Finished tasks of [from, to) that carried a minutes guess, with the minutes their time entries counted. */
export async function loadGuessErrors(db: Db, ownerId: string, from: Date, to: Date): Promise<GuessError[]> {
  const done = await db.task.findMany({
    where: { assignee_id: ownerId, is_deleted: false, status: 'done', completed_at: { gte: from, lt: to } },
    select: { id: true, completed_at: true },
    take: ROW_TAKE,
  });
  if (done.length === 0) return [];
  const states = await db.homeItemState.findMany({
    where: { user_id: ownerId, item_key: { in: done.map((t) => taskKey(t.id)) }, effort_minutes: { not: null }, guessed_at: { not: null } },
    select: { item_key: true, effort_minutes: true, guessed_at: true },
  });
  const byKey = new Map(states.map((s) => [s.item_key, s]));
  const totals = await countedByTask(db, ownerId, done.map((t) => t.id));
  const out: GuessError[] = [];
  for (const t of done) {
    const st = byKey.get(taskKey(t.id));
    const actual = totals.get(t.id) ?? null;
    if (!st || st.effort_minutes == null || actual === null) continue;
    if (t.completed_at && st.guessed_at && st.guessed_at.getTime() > t.completed_at.getTime()) continue;
    out.push({ guessed: st.effort_minutes, actual });
  }
  return out;
}
