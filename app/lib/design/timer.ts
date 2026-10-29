/**
 * Designer Portal D10: the automatic task timer. Driven by the design routes (never by a designer-facing
 * time-entry route): a TimeEntry on the session's task for the session's own user, kept alive by visible polls,
 * stopped on lapse (ended_at = last presence) and on close. Uses lib/services/time-entries.ts, with touchTask off.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { isTerminalStatus } from './sessions';
import { startRunningEntry, stopRunningEntry } from '@/lib/services/time-entries';

export const AUTO_TIMER_DESCRIPTION = 'Design portal (auto)';

export interface TimerView {
  running: boolean;
  elapsed_s: number;
}

export interface TimerSession {
  id: string;
  designer_id: string;
  task_id: string;
  site_id: string;
}
export interface TimerActor {
  userId: string;
  role: string;
}


interface TimerSettings {
  enabled: boolean;
  lapseMs: number;
}

async function loadSettings(db: PrismaClient): Promise<TimerSettings> {
  const s = await db.designPortalSettings.findUnique({
    where: { id: 1 },
    select: { auto_timer_enabled: true, auto_timer_lapse_minutes: true },
  });
  return {
    enabled: s?.auto_timer_enabled ?? true,
    lapseMs: Math.max(1, s?.auto_timer_lapse_minutes ?? 5) * 60_000,
  };
}

/**
 * Billing rule (Mike, 2026-10-29): an automatic entry is non-billable because the time is tracked on the project;
 * it is billable ONLY when the work is ad-hoc (the task has no project, `Task.project_id` null) AND the client has no
 * retainer (`Client.retainer_hours` null or 0; the client is the task's own, else its project's). The old flat
 * `DesignPortalSettings.auto_timer_billable` default is no longer read (column kept, deprecated).
 */
export async function autoTimerBillable(taskId: string, db: Pick<PrismaClient, 'task' | 'client'>): Promise<boolean> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { project_id: true, client_id: true, project: { select: { client_id: true } } } });
  if (!task || task.project_id) return false;
  const clientId = task.client_id ?? task.project?.client_id ?? null;
  if (!clientId) return true; // ad-hoc and no client: nothing to hold a retainer
  const client = await db.client.findUnique({ where: { id: clientId }, select: { retainer_hours: true } });
  return !(client?.retainer_hours != null && Number(client.retainer_hours) > 0);
}

/** Only the session's opener (a designer, or an admin in a session the admin opened) owns a timer. */
export function ownsTimer(session: Pick<TimerSession, 'designer_id'>, actor: TimerActor | undefined): boolean {
  return !!actor && actor.userId === session.designer_id && (actor.role === 'designer' || actor.role === 'admin');
}

/** Seconds this user has on the task: finished entries' minutes plus the running entry's wall time. */
async function elapsedOnTask(db: PrismaClient, userId: string, taskId: string, now: Date): Promise<number> {
  const rows = await db.timeEntry.findMany({
    where: { user_id: userId, task_id: taskId, is_deleted: false },
    select: { started_at: true, duration: true, is_running: true },
  });
  let s = 0;
  for (const r of rows) s += r.is_running ? Math.max(0, Math.floor((now.getTime() - r.started_at.getTime()) / 1000)) : r.duration * 60;
  return s;
}

/**
 * If the session's timer presence is older than the lapse, stop its entry at the last presence and clear the
 * link. Claims the link first so a poll and a sweep racing each other stop it once. Returns true when it stopped.
 */
export async function lapseStop(session: Pick<TimerSession, 'id'>, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<boolean> {
  const { lapseMs } = await loadSettings(db);
  const row = await db.designSession.findUnique({ where: { id: session.id }, select: { timer_entry_id: true, timer_presence_at: true } });
  if (!row?.timer_entry_id) return false;
  if (row.timer_presence_at && now.getTime() - row.timer_presence_at.getTime() <= lapseMs) return false;
  return releaseEntry(db, session.id, row.timer_entry_id, row.timer_presence_at ?? now);
}

async function releaseEntry(db: PrismaClient, sessionId: string, entryId: string, at: Date): Promise<boolean> {
  const claimed = await db.designSession.updateMany({
    where: { id: sessionId, timer_entry_id: entryId },
    data: { timer_entry_id: null, timer_presence_at: null },
  });
  if (claimed.count === 0) return false;
  const entry = await db.timeEntry.findUnique({ where: { id: entryId }, select: { is_running: true, started_at: true } });
  if (entry?.is_running) {
    const endedAt = at < entry.started_at ? entry.started_at : at;
    await stopRunningEntry({ entryId, endedAt }, db);
  }
  return true;
}

/** Stops the session's automatic entry now (close, abandon). No-op when none is linked. */
export async function stopTimer(session: Pick<TimerSession, 'id'>, db: PrismaClient = defaultDb): Promise<boolean> {
  const row = await db.designSession.findUnique({ where: { id: session.id }, select: { timer_entry_id: true } });
  if (!row?.timer_entry_id) return false;
  return releaseEntry(db, session.id, row.timer_entry_id, new Date());
}

/**
 * True when the session is terminal (status closed/abandoned or closed_at set) or a `close` command is pending or
 * claimed for it (closing in progress: the daemon marks the session closed only after the command completes).
 * Presence must neither start nor keep alive a timer then.
 */
export async function isClosingOrTerminal(sessionId: string, db: Pick<PrismaClient, 'designSession' | 'designCommand'> = defaultDb): Promise<boolean> {
  const row = await db.designSession.findUnique({ where: { id: sessionId }, select: { status: true, closed_at: true } });
  if (!row || row.closed_at || isTerminalStatus(row.status)) return true;
  const closing = await db.designCommand.findFirst({ where: { session_id: sessionId, verb: 'close', status: { in: ['pending', 'claimed'] } }, select: { id: true } });
  return !!closing;
}

/** Sets presence = now when the session has a linked entry (visible polls only); skipped while closing. */
export async function keepAlive(session: Pick<TimerSession, 'id'>, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<void> {
  if (await isClosingOrTerminal(session.id, db)) return;
  await db.designSession.updateMany({ where: { id: session.id, timer_entry_id: { not: null } }, data: { timer_presence_at: now } });
}

/**
 * Start or resume (idempotent) and keep alive. Order: a lapsed link is stopped at its last presence first, then
 * an existing running entry on this task is kept, else any other running entry of the user is stopped and a new
 * one starts. Serialized per user with an advisory lock so two simultaneous opens make one entry.
 */
export async function ensureTimer(session: TimerSession, actor: TimerActor | undefined, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<TimerView | null> {
  if (!ownsTimer(session, actor)) return null;
  const settings = await loadSettings(db);
  const site = await db.site.findUnique({ where: { id: session.site_id }, select: { design_auto_timer: true } });
  if (!settings.enabled || site?.design_auto_timer === false) return viewOf(db, session, now);

  await lapseStop(session, now, db);
  if (await isClosingOrTerminal(session.id, db)) return viewOf(db, session, now); // closed or closing: never (re)start
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'design-timer:' + session.designer_id}))`;
    if (await isClosingOrTerminal(session.id, tx as unknown as PrismaClient)) return; // re-check under the lock
    const link = await tx.designSession.findUnique({ where: { id: session.id }, select: { timer_entry_id: true } });
    if (link?.timer_entry_id) {
      const linked = await tx.timeEntry.findUnique({ where: { id: link.timer_entry_id }, select: { is_running: true, task_id: true } });
      if (linked?.is_running && linked.task_id === session.task_id) {
        await tx.designSession.update({ where: { id: session.id }, data: { timer_presence_at: now } });
        return;
      }
    }
    const running = await tx.timeEntry.findFirst({
      where: { user_id: session.designer_id, task_id: session.task_id, is_running: true },
      select: { id: true },
    });
    if (running) {
      // A manual (Timekeeper) timer already runs on this task: leave it alone, do not own or lapse-stop it.
      return;
    }
    const entry = await startRunningEntry(
      { userId: session.designer_id, taskId: session.task_id, description: AUTO_TIMER_DESCRIPTION, isBillable: await autoTimerBillable(session.task_id, tx), touchTask: false },
      tx,
    );
    await tx.designSession.update({ where: { id: session.id }, data: { timer_entry_id: entry.id, timer_presence_at: now } });
  });
  return viewOf(db, session, now);
}

async function viewOf(db: PrismaClient, session: TimerSession, now: Date): Promise<TimerView> {
  const running = await db.timeEntry.findFirst({ where: { user_id: session.designer_id, task_id: session.task_id, is_running: true }, select: { id: true } });
  return { running: !!running, elapsed_s: await elapsedOnTask(db, session.designer_id, session.task_id, now) };
}

/** A hidden-tab poll: no keep-alive, but a lapsed entry is stopped and the current state returned. */
export async function observeTimer(session: TimerSession, actor: TimerActor | undefined, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<TimerView | null> {
  if (!ownsTimer(session, actor)) return null;
  await lapseStop(session, now, db);
  return viewOf(db, session, now);
}

/** Stops every linked entry whose presence is older than the lapse. Indexed on timer_presence_at. */
export async function sweepLapsedTimers(now: Date = new Date(), db: PrismaClient = defaultDb): Promise<number> {
  const { lapseMs } = await loadSettings(db);
  const stale = await db.designSession.findMany({
    where: { timer_entry_id: { not: null }, timer_presence_at: { lt: new Date(now.getTime() - lapseMs) } },
    select: { id: true },
    take: 500,
  });
  let n = 0;
  for (const s of stale) if (await lapseStop(s, now, db)) n++;
  // Belt and braces: a running auto entry on a terminal session is stopped at once.
  const dead = await db.designSession.findMany({
    where: { timer_entry_id: { not: null }, OR: [{ status: { in: ['closed', 'abandoned'] } }, { closed_at: { not: null } }] },
    select: { id: true },
    take: 500,
  });
  for (const s of dead) if (await stopTimer(s, db)) n++;
  return n;
}

/** Overview rows: the linked entry's state, running only if it is not lapsed. */
export async function timerViewsFor(
  rows: { id: string; timer_entry_id: string | null; timer_presence_at: Date | null }[],
  now: Date = new Date(),
  db: PrismaClient = defaultDb,
): Promise<Map<string, TimerView>> {
  const out = new Map<string, TimerView>();
  const ids = rows.map((r) => r.timer_entry_id).filter((v): v is string => !!v);
  if (ids.length === 0) return out;
  const { lapseMs } = await loadSettings(db);
  const entries = await db.timeEntry.findMany({ where: { id: { in: ids } }, select: { id: true, started_at: true, is_running: true } });
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const r of rows) {
    const e = r.timer_entry_id ? byId.get(r.timer_entry_id) : undefined;
    if (!e) continue;
    const live = e.is_running && !!r.timer_presence_at && now.getTime() - r.timer_presence_at.getTime() <= lapseMs;
    out.set(r.id, { running: live, elapsed_s: Math.max(0, Math.floor((now.getTime() - e.started_at.getTime()) / 1000)) });
  }
  return out;
}


