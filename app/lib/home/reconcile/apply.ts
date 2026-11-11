/**
 * Home Slice 9a: his tap on a card. Nothing here runs by itself.
 *
 *   proposalNo    closes the card (the same piece of work is never proposed again: the dedupe key stays).
 *   proposalYes   runs the card's stored plan after re-checking it: the task still open and still his (done, waiting, note),
 *                 the session's ask still the same text (session), nothing else changed since.
 *   logTime       the "Log time?" prompt on a done task with no time.
 *
 * Time: a TimeEntry is created ONLY here and in track.ts, and both are reached only through POST /api/home/reconcile (session
 * only). homeActSchema refuses track_it and log_time; a done card with a time choice and a Track it card answer 400
 * "Tap this on the home screen." when tapped through the chat's home op.
 */
import type { PrismaClient } from '@prisma/client';
import { patchTask } from '@/lib/services/task-patch';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { buildWaitData } from '@/lib/waits/templates';
import { BAST_USER_ID } from '@/lib/bast-chat/gate-mirror';
import { parseItemKey } from '../item-key';
import { appendHomeAction } from '../state';
import { zonedDateString, zonedToUtc } from '../act';
import { loadSessionAsks } from '../load';
import { runHomeAct } from '../act';
import type { HomeActResponse } from '../types';
import { ownerActor } from './actor';
import { shortDay, plainLine } from './copy';
import { ReconcileError } from './errors';
import { clampMinutes } from './estimate';
import { OPEN_TASK_STATUSES, sha256 } from './load';
import { writeNote } from './note';
import { createEstimatedEntry, endOfEmailDay } from './time';
import type { ReconcileRecord } from './records';

export const UNDO_HOURS = 24;
export const CARD_KEY_PREFIX = 'proposal:';

export interface TapOpts {
  now: Date;
  timezone: string;
}

export const cardKey = (changeId: string): string => `${CARD_KEY_PREFIX}${changeId}`;

export function parseCardKey(itemKey: string): string | null {
  const p = parseItemKey(itemKey);
  return p && p.kind === 'proposal' ? p.id : null;
}

type PlanObj = Record<string, unknown>;
const planOf = (v: unknown): PlanObj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as PlanObj) : {});

export interface OpenCard {
  id: string;
  kind: string;
  title: string;
  plan: PlanObj;
  target_key: string | null;
  quote: string | null;
  quote_at: Date | null;
  quote_to: string | null;
  link: string | null;
  dedupe_key: string;
  message_id: string;
}

/** The open card for this key, or CARD_GONE. A card whose task closed another way, or that passed its two weeks, goes quietly. */
export async function loadOpenCard(db: PrismaClient, userId: string, itemKey: string, now: Date): Promise<OpenCard> {
  const id = parseCardKey(itemKey);
  if (!id) throw new ReconcileError('not_found');
  const c = await db.homeReconcileChange.findFirst({
    where: { id, user_id: userId, mode: 'card' },
    select: { id: true, kind: true, title: true, plan: true, target_key: true, quote: true, quote_at: true, quote_to: true, link: true, dedupe_key: true, message_id: true, state: true, shown_until: true },
  });
  if (!c) throw new ReconcileError('not_found');
  if (c.state !== 'open') throw new ReconcileError('card_gone');
  if (c.shown_until && c.shown_until.getTime() < now.getTime()) {
    await db.homeReconcileChange.updateMany({ where: { id, state: 'open' }, data: { state: 'expired', resolved_at: now } });
    throw new ReconcileError('card_gone');
  }
  return { id: c.id, kind: c.kind, title: c.title, plan: planOf(c.plan), target_key: c.target_key, quote: c.quote, quote_at: c.quote_at, quote_to: c.quote_to, link: c.link, dedupe_key: c.dedupe_key, message_id: c.message_id };
}

const taskIdOf = (target: string | null): string | null => (target && target.startsWith('task:') ? target.slice(5) : null);

/** No: closes the card. */
export async function proposalNo(db: PrismaClient, userId: string, itemKey: string, now: Date): Promise<HomeActResponse> {
  const card = await loadOpenCard(db, userId, itemKey, now);
  return db.$transaction(async (tx) => {
    const r = await tx.homeReconcileChange.updateMany({ where: { id: card.id, user_id: userId, state: 'open' }, data: { state: 'dismissed', resolved_at: now } });
    if (r.count !== 1) throw new ReconcileError('card_gone');
    const rec: ReconcileRecord = { kind: 'no', change_id: card.id };
    const row = await appendHomeAction(tx as unknown as PrismaClient, userId, {
      item_key: itemKey,
      action: 'reconcile_card_no',
      before: { states: [], reconcile: rec },
      after: { states: [], reconcile: rec },
      undo_until: null,
    });
    return { ok: true as const, action_id: row.id, undo_until: null, item_key: itemKey, message: `Closed the card: ${plainLine(card.title, 120)}` };
  });
}

export interface YesOpts extends TapOpts {
  /** True only from POST /api/home/reconcile (his own session). The chat's home op passes false. */
  allowTime: boolean;
  minutes: number | null;
}

/** Yes: runs the card's plan. Track it has its own door (track.ts). */
export async function proposalYes(db: PrismaClient, userId: string, itemKey: string, o: YesOpts): Promise<HomeActResponse> {
  const card = await loadOpenCard(db, userId, itemKey, o.now);
  if (card.kind === 'track') throw new ReconcileError('tap_on_screen');
  const plan = card.plan;
  const taskId = taskIdOf(card.target_key);

  // Tasks: still open, and still his for done and waiting. Re-read now, never taken from the card.
  if (taskId) {
    const t = await db.task.findUnique({ where: { id: taskId }, select: { assignee_id: true, status: true, is_deleted: true } });
    const open = !!t && !t.is_deleted && (OPEN_TASK_STATUSES as readonly string[]).includes(t.status);
    if (!open) {
      await db.homeReconcileChange.updateMany({ where: { id: card.id, state: 'open' }, data: { state: 'expired', resolved_at: o.now } });
      throw new ReconcileError('card_gone');
    }
    if ((card.kind === 'done' || card.kind === 'waiting') && t.assignee_id !== userId) throw new ReconcileError('changed_since');
  }

  switch (card.kind) {
    case 'note':
      return applyNote(db, userId, itemKey, card, o);
    case 'done':
      return applyDone(db, userId, itemKey, card, o);
    case 'waiting':
    case 'wait':
      return applyWait(db, userId, itemKey, card, o);
    case 'session':
      return applySession(db, userId, itemKey, card, o);
    default:
      throw new ReconcileError('not_found');
  }
  void plan;
}

async function finishCard(
  tx: PrismaClient,
  userId: string,
  itemKey: string,
  card: OpenCard,
  o: TapOpts,
  rec: ReconcileRecord,
  extra: { time_entry_id?: string | null; created_ids?: unknown },
  action: string,
  message: string,
  undoable = true
): Promise<HomeActResponse> {
  const claimed = await tx.homeReconcileChange.updateMany({ where: { id: card.id, user_id: userId, state: 'open' }, data: { state: 'applied', resolved_at: o.now } });
  if (claimed.count !== 1) throw new ReconcileError('card_gone');
  const undoUntil = undoable ? new Date(o.now.getTime() + UNDO_HOURS * 3600 * 1000) : null;
  const row = await appendHomeAction(tx, userId, { item_key: itemKey, action, before: { states: [], reconcile: rec }, after: { states: [], reconcile: rec }, undo_until: undoUntil });
  await tx.homeReconcileChange.update({
    where: { id: card.id },
    data: { home_action_id: row.id, ...(extra.time_entry_id ? { time_entry_id: extra.time_entry_id } : {}), ...(extra.created_ids ? { created_ids: extra.created_ids as never } : {}) },
  });
  return { ok: true as const, action_id: row.id, undo_until: undoUntil ? undoUntil.toISOString() : null, item_key: itemKey, message };
}

async function applyNote(db: PrismaClient, userId: string, itemKey: string, card: OpenCard, o: YesOpts): Promise<HomeActResponse> {
  const taskId = taskIdOf(card.target_key) as string;
  const text = typeof card.plan.text === 'string' ? card.plan.text : '';
  if (!text) throw new ReconcileError('changed_since');
  return db.$transaction(
    async (txc) => {
      const tx = txc as unknown as PrismaClient;
      const res = await writeNote(tx, userId, taskId, text, o.now, { tap: true });
      if (!res.ok) throw new ReconcileError('changed_since');
      await tx.homeReconcileChange.update({ where: { id: card.id }, data: { comment_id: res.comment_id } });
      const rec: ReconcileRecord = { kind: 'note', change_id: card.id, message_id: card.message_id, comment_id: res.comment_id, task_id: taskId };
      return finishCard(tx, userId, itemKey, card, o, rec, {}, 'reconcile_card_yes', 'Added the note.');
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

async function applyDone(db: PrismaClient, userId: string, itemKey: string, card: OpenCard, o: YesOpts): Promise<HomeActResponse> {
  const taskId = taskIdOf(card.target_key) as string;
  const offer = (planOf(card.plan.time).offer ?? false) === true;
  const minutes = o.minutes && o.minutes > 0 ? clampMinutes(o.minutes) : 0;
  if (minutes > 0 && !o.allowTime) throw new ReconcileError('tap_on_screen');
  if (offer && !o.allowTime) throw new ReconcileError('tap_on_screen');
  const before = await db.task.findUnique({ where: { id: taskId }, select: { status: true, project_id: true, assignee_id: true } });
  if (!before) throw new ReconcileError('card_gone');
  const hasTime = (await db.timeEntry.count({ where: { task_id: taskId, is_deleted: false } })) > 0;

  // The same task write his own tap makes (activity log, dependents, claim rule), compare-and-set on status and assignee.
  const actor = await ownerActor(db, userId);
  const res = await patchTask({ actor, id: taskId, body: { status: 'done' }, expect: { assignee_id: userId, status: before.status as never } });
  if (!res.ok) throw new ReconcileError('changed_since');

  return db.$transaction(
    async (txc) => {
      const tx = txc as unknown as PrismaClient;
      let entry: { id: string; started_at: Date; duration: number } | null = null;
      if (minutes > 0 && !hasTime) {
        const sent = card.quote_at ?? o.now;
        entry = await createEstimatedEntry(tx, { user_id: userId, task_id: taskId, project_id: before.project_id, ended_at: sent, minutes, billable: true, sent, timezone: o.timezone });
      }
      const rec: ReconcileRecord = {
        kind: 'done',
        change_id: card.id,
        task_id: taskId,
        status_before: before.status,
        time_entry_id: entry?.id ?? null,
        time_started_at: entry ? entry.started_at.toISOString() : null,
        time_duration: entry ? entry.duration : null,
      };
      return finishCard(tx, userId, itemKey, card, o, rec, { time_entry_id: entry?.id }, 'reconcile_card_yes', entry ? `Marked it done and logged ${entry.duration} minutes.` : 'Marked it done.');
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

async function applyWait(db: PrismaClient, userId: string, itemKey: string, card: OpenCard, o: YesOpts): Promise<HomeActResponse> {
  const plan = card.plan;
  const w = planOf(plan.wait_on);
  const email = typeof w.email === 'string' ? w.email : '';
  const name = (typeof w.name === 'string' && w.name.trim() !== '' ? w.name.trim() : email) || 'them';
  const what = typeof w.what === 'string' ? w.what : 'a reply';
  const taskId = taskIdOf(card.target_key);
  const task = taskId ? await db.task.findUnique({ where: { id: taskId }, select: { client_id: true, project_id: true } }) : null;
  const contact = email
    ? await db.clientContact.findFirst({ where: { is_deleted: false, email: { equals: email, mode: 'insensitive' } }, select: { id: true, client_id: true } })
    : null;
  const sent = typeof plan.sent_at === 'string' ? new Date(plan.sent_at) : o.now;
  return db.$transaction(
    async (txc) => {
      const tx = txc as unknown as PrismaClient;
      const data = buildWaitData({
        template_key: 'mail.awaiting_reply',
        subject: typeof plan.subject === 'string' ? plan.subject : what,
        title: `Waiting on ${plainLine(name, 80)} since ${shortDay(sent, o.timezone)} for ${plainLine(what, 120).replace(/[.]+$/, '')}`.slice(0, 300),
        started_at: sent,
        task_id: taskId,
        client_id: task?.client_id ?? contact?.client_id ?? null,
        project_id: task?.project_id ?? null,
        owner_contact_id: contact?.id ?? null,
        email_thread_id: typeof plan.thread_id === 'string' ? plan.thread_id : null,
        email_account: typeof plan.account === 'string' ? plan.account : null,
        created_by_id: userId,
        created_by_automation: 'sent-reconciler',
        idempotency_key: `reconcile:${card.dedupe_key}`,
      });
      const store = prismaSweepStore(tx);
      const { wait, created } = await store.insertIdempotent(data);
      if (created) {
        await store.addEvent({ wait_id: wait.id, kind: 'created', to_state: 'waiting', to_due_at: wait.due_at, reason: 'Opened from mail.awaiting_reply by his tap on a sent-mail card.', source: 'api', actor_user_id: userId });
      }
      const rec: ReconcileRecord = { kind: 'wait', change_id: card.id, wait_id: wait.id };
      return finishCard(tx, userId, itemKey, card, o, rec, {}, 'reconcile_card_yes', `Started a wait on ${plainLine(name, 60)}.`);
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

async function applySession(db: PrismaClient, userId: string, itemKey: string, card: OpenCard, o: YesOpts): Promise<HomeActResponse> {
  const key = typeof card.plan.session_key === 'string' ? card.plan.session_key : '';
  const hash = typeof card.plan.ask_hash === 'string' ? card.plan.ask_hash : '';
  const asks = await loadSessionAsks(db);
  const ask = asks.find((a) => a.external_id === key);
  if (!ask || sha256(ask.waiting_on) !== hash) throw new ReconcileError('changed_since');
  // The home screen's own Clear it: writes only his home_item_state row for the session; the session itself is never touched.
  const res = await runHomeAct(db, userId, { action: 'clear_session', item_key: `session:${key}` }, {
    now: o.now,
    timezone: o.timezone,
    date: zonedDateString(o.now, o.timezone),
  } as never);
  await db.homeReconcileChange.updateMany({ where: { id: card.id, user_id: userId, state: 'open' }, data: { state: 'applied', resolved_at: o.now, home_action_id: res.action_id } });
  return { ...res, item_key: itemKey, message: 'Cleared the question.' };
}

// ============================================================================
// Log time
// ============================================================================

export interface LogTimeReq {
  task_id: string;
  minutes: number;
  day: string;
}

export async function logTime(db: PrismaClient, userId: string, req: LogTimeReq, o: TapOpts): Promise<HomeActResponse> {
  return db.$transaction(async (txc) => {
    const tx = txc as unknown as PrismaClient;
    const t = await tx.task.findUnique({ where: { id: req.task_id }, select: { id: true, assignee_id: true, is_deleted: true, project_id: true, status: true } });
    if (!t || t.is_deleted || t.assignee_id !== userId) throw new ReconcileError('not_found', 'That task is not yours.');
    if ((await tx.timeEntry.count({ where: { task_id: t.id, is_deleted: false } })) > 0) throw new ReconcileError('has_time');
    const [y, m, d] = req.day.split('-').map(Number);
    const sent = zonedToUtc(y, m, d, 12, 0, o.timezone);
    const end = endOfEmailDay(req.day, o.now, o.timezone);
    const entry = await createEstimatedEntry(tx, { user_id: userId, task_id: t.id, project_id: t.project_id, ended_at: end, minutes: clampMinutes(req.minutes), billable: true, sent, timezone: o.timezone });
    const rec: ReconcileRecord = { kind: 'log_time', task_id: t.id, time_entry_id: entry.id, started_at: entry.started_at.toISOString(), duration: entry.duration };
    const undoUntil = new Date(o.now.getTime() + UNDO_HOURS * 3600 * 1000);
    const row = await appendHomeAction(tx, userId, { item_key: `task:${t.id}`, action: 'reconcile_log_time', before: { states: [], reconcile: rec }, after: { states: [], reconcile: rec }, undo_until: undoUntil });
    return { ok: true as const, action_id: row.id, undo_until: undoUntil.toISOString(), item_key: `task:${t.id}`, message: `Logged ${entry.duration} minutes.` };
  });
}

export { BAST_USER_ID };
