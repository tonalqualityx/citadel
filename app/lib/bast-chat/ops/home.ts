/**
 * Bast chat v2, op `home`: every home screen decision of plan 2.1, acting on the chat OWNER's own rows.
 *
 * It calls the home screen's own `runHomeAct` and `runHomeUndo` (lib/home/act.ts), so the screen and the chat run
 * one reducer and can never disagree. The owner is `ctx.ownerId`, which the route takes from the settings; the input
 * is the home screen's own strict request schema, so a user id anywhere in it is a 400. The `record` action (the
 * screen's log of a button that changed a shared record) is not available here.
 *
 * Writes only home_item_state, home_day and home_actions of the owner. If today's home_day row does not exist yet (the
 * screen has not loaded the day), it stores the same proposal GET /api/home would (lib/home/ensure-day.ts) first. The home routes refuse API keys by design
 * and stay that way: this is the worker-side door. No reach check can hit (the worker never reads these rows).
 *
 * Record: target_id is the home_actions row id. before and after hold that row's own before and after.
 * Slice 8b: `step_done` only marks the step (home_item_state); the chat never queues the project refresh. That call is the screen's own.
 * Undo: `runHomeUndo`, with its own refusals ("Today's list changed since, so this can't be undone.").
 */
import type { BastChatAction } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { ensureHomeDay } from '@/lib/home/ensure-day';
import { homeActSchema, runHomeAct, runHomeUndo, zonedDateString } from '@/lib/home/act';
import { parseItemKey, parseGroupKey } from '@/lib/home/item-key';
import { getHomeAction, getItemState } from '@/lib/home/state';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import type { HomeActRequest } from '@/lib/home/types';
import type { OpContext, PreparedOp } from '../actions';
import { opSummary, type OpLine } from '../actions';
import { cleanLine, quoted } from '../card-context';
import { checkOp, type ReachOrigin } from '../worker-reach';
import type { OpDef, OpJson, OpRun, OpDb } from './index';

export type HomeInput = Exclude<HomeActRequest, { action: 'record' }>;

const NO_UUID = '00000000-0000-0000-0000-000000000000';
const OFF_TEXT = 'Your home screen is off.';

function validate(raw: unknown): HomeInput {
  const r = homeActSchema.parse(raw);
  if (r.action === 'record') throw new ApiError('That home action is not available here.', 400, 'bad_action');
  return r;
}

interface Described {
  title: string;
  security: boolean;
}

/** The plain words for an item key, read from the record it names. Never from the request. */
async function describeItem(db: OpDb, key: string): Promise<Described> {
  const p = parseItemKey(key);
  const fallback: Described = { title: 'that item', security: false };
  if (!p) return fallback;
  switch (p.kind) {
    case 'task': {
      const t = await db.task.findUnique({ where: { id: p.id }, select: { title: true, tags: true } });
      return t ? { title: t.title, security: t.tags.includes('security') || t.tags.includes('security-report') } : fallback;
    }
    case 'wait': {
      const w = await db.wait.findUnique({ where: { id: p.id }, select: { title: true } });
      return w ? { title: w.title, security: false } : fallback;
    }
    case 'crisis': {
      const a = await db.emailAsk.findUnique({ where: { id: p.id }, select: { subject: true } });
      return a ? { title: a.subject, security: false } : fallback;
    }
    case 'thread': {
      const a = await db.emailAsk.findFirst({ where: { account: p.account, thread_id: p.thread_id }, orderBy: { created_at: 'desc' }, select: { subject: true } });
      return a ? { title: a.subject, security: false } : fallback;
    }
    case 'review': {
      if (!p.project_id) return { title: 'the sign-off', security: false };
      const pr = await db.project.findUnique({ where: { id: p.project_id }, select: { name: true } });
      return { title: pr ? `${pr.name} sign-off` : 'the sign-off', security: false };
    }
    case 'session': {
      const s = await db.oracleSession.findFirst({ where: { external_id: p.external_id }, orderBy: { last_event_at: 'desc' }, select: { title: true } });
      return { title: cleanLine(s?.title ?? '', 60) || 'that', security: false };
    }
    case 'site': {
      const s = await db.site.findUnique({ where: { id: p.id }, select: { url: true } });
      return { title: s?.url ? `${s.url.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '')} going down` : 'that site', security: false };
    }
    case 'hands':
      return { title: "this week's hands", security: false };
    case 'step': {
      const pr = await db.project.findUnique({ where: { id: p.project_id }, select: { name: true } });
      return { title: pr?.name ?? 'that project', security: false };
    }
    case 'finished': {
      if (!p.id) return { title: 'the looks-finished list', security: false };
      const it = await db.workFinishedItem.findUnique({ where: { id: p.id }, select: { task_id: true } });
      const t = it ? await db.task.findUnique({ where: { id: it.task_id }, select: { title: true } }) : null;
      return t ? { title: t.title, security: false } : fallback;
    }
    case 'attach': {
      const l = await db.workLink.findUnique({ where: { id: p.id }, select: { label: true } });
      return { title: l?.label ?? 'that question', security: false };
    }
    case 'proposal': {
      const c = await db.homeReconcileChange.findUnique({ where: { id: p.id }, select: { title: true } });
      return { title: c?.title ?? 'that card', security: false };
    }
  }
}

/** The name of a group Today can be (an arc, a client, a project, or own work). */
async function groupName(db: OpDb, key: string): Promise<string> {
  const g = parseGroupKey(key);
  if (!g) return 'another group';
  if (g.kind === 'own') return 'Indelible';
  const row =
    g.kind === 'arc'
      ? await db.arc.findUnique({ where: { id: g.id }, select: { name: true } })
      : g.kind === 'client'
        ? await db.client.findUnique({ where: { id: g.id }, select: { name: true } })
        : await db.project.findUnique({ where: { id: g.id }, select: { name: true } });
  return row?.name ?? 'another group';
}

/** The name of the person on the newest open message of a thread, read from the record. Never from the request. */
async function threadWho(db: OpDb, key: string): Promise<string> {
  const p = parseItemKey(key);
  if (!p || p.kind !== 'thread') return 'that person';
  const a = await db.emailAsk.findFirst({
    where: { account: p.account, OR: [{ thread_id: p.thread_id }, { thread_id: null, message_id: p.thread_id }] },
    orderBy: { received_at: 'desc' },
    select: { from_name: true, from_email: true },
  });
  const name = (a?.from_name ?? '').replace(/["<>]/g, '').trim();
  return name || a?.from_email.split('@')[0] || 'that person';
}

async function lineFor(db: OpDb, input: HomeInput, until: Date | null, now: Date, message: string | null): Promise<string> {
  const a = input.action;
  if (a === 'arc_reorder' || a === 'lighter' || a === 'not_this_week') return opSummary({ op: 'home_act', action: a }, now);
  if (a === 'reopen_ask') {
    const id = input.item_key.slice(4);
    const ask = await db.emailAsk.findUnique({ where: { id }, select: { subject: true } });
    return opSummary({ op: 'home_act', action: 'reopen_ask', title: ask?.subject ?? 'that email' }, now);
  }
  if (a === 'finished_close') return opSummary({ op: 'home_act', action: 'finished_close', count: input.item_keys.length }, now);
  if (a === 'swap') return opSummary({ op: 'home_act', action: 'swap', title: await groupName(db, input.to_group_key) }, now);
  if (a === 'draft_now' || a === 'needs_thought' || a === 'go_with_that' || a === 'keep_lead' || a === 'treat_as_reply' || a === 'book_block') {
    return opSummary({ op: 'home_act', action: a, who: await threadWho(db, input.item_key) }, now);
  }
  const d = await describeItem(db, input.item_key);
  // A third Not now leaves no return date: the item stays in view (the opSummary line would say it stays out).
  if (a === 'not_now' && until === null) return cleanLine(`${quoted(d.title)} stays in view. Pick what to do with it.`, 300);
  let line: OpLine;
  if (a === 'not_now') line = { op: 'home_act', action: 'not_now', title: d.title, until };
  else if (a === 'not_emergency') line = { op: 'home_act', action: 'not_emergency', title: d.title, security: d.security };
  else if (a === 'step_done') line = { op: 'home_act', action: 'step_done', title: d.title };
  else if (a === 'clear_session') line = { op: 'home_act', action: 'clear_session', title: d.title };
  else if (a === 'attach_choose') line = { op: 'home_act', action: 'attach_choose', title: d.title };
  else if (a === 'proposal_yes' || a === 'proposal_no') line = { op: 'home_act', action: a, title: d.title };
  else if (a === 'on_day' || a === 'snooze') line = { op: 'home_act', action: a, title: d.title, message: message ?? '' };
  else line = { op: 'home_act', action: a, title: d.title };
  return opSummary(line, now);
}

async function prepare(ctx: OpContext, _input: HomeInput, origin: ReachOrigin): Promise<PreparedOp> {
  return { reach: checkOp({ op: { op: 'home_act' }, now: ctx.now, origin }), expect: {}, copy: { clause: 'change your home screen' } };
}

async function run(ctx: OpContext, input: HomeInput): Promise<OpRun> {
  const db = ctx.db as OpDb;
  const pref = await db.userPreference.findUnique({ where: { user_id: ctx.ownerId }, select: { home_view: true } });
  if (pref?.home_view !== 'home') throw new ApiError(OFF_TEXT, 409, 'home_off');
  const timezone = await resolveUserTimezone(ctx.ownerId);
  // Today's steps, swap and lighter need today's day row. The screen stores it on its first load of the day; if it has
  // not loaded yet, store the same proposal here before acting (V4).
  await ensureHomeDay(db as unknown as Parameters<typeof ensureHomeDay>[0], ctx.ownerId, ctx.now, timezone);
  const res = await runHomeAct(db, ctx.ownerId, input, { now: ctx.now, timezone, date: zonedDateString(ctx.now, timezone) });
  const row = await getHomeAction(db, ctx.ownerId, res.action_id);
  let until: Date | null = null;
  if (input.action === 'not_now') until = (await getItemState(db, ctx.ownerId, input.item_key))?.view_at ?? null;
  const summary = await lineFor(db, input, until, ctx.now, res.message);
  const key = 'item_key' in input ? input.item_key : input.action === 'finished_close' ? (input.item_keys[0] ?? null) : null;
  return {
    target_id: res.action_id,
    before: { home_action_id: res.action_id, action: input.action, item_key: key, state: (row?.before ?? null) as OpJson },
    after: { home_action_id: res.action_id, action: input.action, item_key: key, state: (row?.after ?? null) as OpJson },
    summary,
    result: { message: res.message, item_key: key },
    undoable: true,
  };
}

function homeActionId(a: BastChatAction): string {
  const v = (a.after as { home_action_id?: unknown } | null)?.home_action_id;
  if (typeof v !== 'string') throw new ApiError("That can't be undone from here. Open it in Citadel.", 409, 'not_undoable');
  return v;
}

export const homeOp: OpDef<HomeInput> = {
  name: 'home',
  target_type: 'home',
  tool: 'home_change',
  ownTransaction: true,
  validate,
  /** A home change has no record to point a proposal at; it never taps, so this is only a placeholder. */
  targetId: () => NO_UUID,
  prepare,
  run,
  async prepareUndo(ctx, record) {
    const id = homeActionId(record);
    return { reach: checkOp({ op: { op: 'home_act' }, now: ctx.now, origin: 'undo' }), expect: { home_action_id: id }, copy: { clause: 'undo the change to your home screen' } };
  },
  async undo(ctx, record) {
    // HomeActError (undo_used, undo_expired, not_undoable) is an ApiError: its own plain sentence reaches the panel.
    await runHomeUndo(ctx.db as OpDb, ctx.ownerId, homeActionId(record), ctx.now);
    return { ok: true };
  },
};
