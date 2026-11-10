/**
 * Bast chat v2, op `wait`: who a wait is on, when it comes due, pause, resume, finish (plan 2.1).
 *
 * Input, one object per action (strict):
 *   {wait_id, action: 'redate',   due_at}                      a new due time (ISO with offset)
 *   {wait_id, action: 'extend',   business_days}  or  {wait_id, action: 'extend', until}
 *   {wait_id, action: 'pause',    until}                       a future time (ISO with offset)
 *   {wait_id, action: 'resume'}
 *   {wait_id, action: 'reassign', owner_user_id}               an active user
 *   {wait_id, action: 'complete'}                              resolution `completed`
 *   {wait_id, action: 'cancel'}                                resolution `cancelled`
 * There is no way to name any other resolution, so `approved`, `declined`, `sent`, `booked` and `signed` cannot be
 * reached, and any action on a price review wait (charter.price_review) is a 400.
 *
 * The writes are the wait actions of lib/waits/actions.ts, run through the sweeper's store inside one transaction
 * with a compare-and-set claim on the wait's `updated_at` as read, so each one writes its WaitEvent as the route does.
 * An extend that would hit the cap or add nothing is refused and rolled back (the route would flip the wait to
 * needs_human; the chat never does that).
 *
 * Reach (R4): redate, extend, resume and reassign tap when the wait is open and its owner resolves to Bast after the
 * change (its task step would file a Bast task). Pause and cancel never tap by the reach check. `complete` advances a
 * chain (resolveWait opens the next step), so it taps when that step, built with buildNextStepData, resolves to Bast
 * or sends to a client; with no next step, or one that is not either, it applies without a tap.
 *
 * Undo: redate, extend, pause, resume and reassign restore the recorded values. A finished wait (complete, cancel)
 * CANNOT be reopened: no code path in Citadel moves a wait out of `done` (the route refuses any action on a done wait,
 * and `completed` may already have opened the next step). So those records have no undo window and the line says so.
 *
 * Record: target_id is the wait id; before and after hold `{wait_id, action, <snapshot>}`.
 */
import { z } from 'zod';
import type { BastChatAction, PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { isPriceReviewApproval } from '@/lib/price-review/guard';
import { PRICE_REVIEW_TEMPLATE_KEY } from '@/lib/price-review/terms';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { buildNextStepData } from '@/lib/waits/templates';
import { resolveWaitOwner, type SweepStore, type WaitRow } from '@/lib/waits/sweeper';
import { extendWait, pauseWait, redateWait, reassignWait, resolveByPerson, resumeWait } from '@/lib/waits/actions';
import { cleanLine } from '../card-context';
import { opSummary, type OpContext, type PreparedOp } from '../actions';
import { BAST_USER_ID } from '../gate-mirror';
import { checkOp, type ReachOp, type ReachOrigin } from '../worker-reach';
import type { OpDef, OpDb, OpJson, OpRun } from './index';

const ISO = z.string().datetime({ offset: true });
const ID = z.string().uuid();
const inputSchema = z.discriminatedUnion('action', [
  z.object({ wait_id: ID, action: z.literal('redate'), due_at: ISO }).strict(),
  z.object({ wait_id: ID, action: z.literal('extend'), business_days: z.number().int().min(1).max(15).optional(), until: ISO.optional() }).strict(),
  z.object({ wait_id: ID, action: z.literal('pause'), until: ISO }).strict(),
  z.object({ wait_id: ID, action: z.literal('resume') }).strict(),
  z.object({ wait_id: ID, action: z.literal('reassign'), owner_user_id: ID }).strict(),
  z.object({ wait_id: ID, action: z.literal('complete') }).strict(),
  z.object({ wait_id: ID, action: z.literal('cancel') }).strict(),
]);
export type WaitInput = z.infer<typeof inputSchema>;

const expectSchema = z.object({ updated_at: z.string(), state: z.string() }).strict();
const REASON = "From Mike's chat.";
const UNDO_REASON = "Put back from Mike's chat.";
const NO_UNDO = " It can't be undone.";

const snapshot = (w: WaitRow) => ({
  state: w.state,
  due_at: w.due_at.toISOString(),
  paused_until: w.paused_until?.toISOString() ?? null,
  paused_remaining_ms: w.paused_remaining_ms != null ? String(w.paused_remaining_ms) : null,
  extended_bd_total: w.extended_bd_total,
  extension_count: w.extension_count,
  owner_user_id: w.owner_user_id,
  owner_function_id: w.owner_function_id,
  escalated_to_user_id: w.escalated_to_user_id,
  nag_level: w.nag_level,
  last_nag_at: w.last_nag_at?.toISOString() ?? null,
  fired_at: w.fired_at?.toISOString() ?? null,
  claimed_at: w.claimed_at?.toISOString() ?? null,
});
type Snap = ReturnType<typeof snapshot>;

const snapSchema = z
  .object({
    wait_id: ID,
    action: z.string(),
    state: z.string(),
    due_at: z.string(),
    paused_until: z.string().nullable(),
    paused_remaining_ms: z.string().nullable(),
    extended_bd_total: z.number(),
    extension_count: z.number(),
    owner_user_id: z.string().nullable(),
    owner_function_id: z.string().nullable(),
    escalated_to_user_id: z.string().nullable(),
    nag_level: z.number(),
    last_nag_at: z.string().nullable(),
    fired_at: z.string().nullable(),
    claimed_at: z.string().nullable(),
  })
  .strict();

const asDate = (v: string | null) => (v ? new Date(v) : null);

async function load(db: OpDb, id: string): Promise<WaitRow> {
  const w = await db.wait.findUnique({ where: { id } });
  if (!w) throw new ApiError('That wait was not found.', 404, 'wait_missing');
  return w;
}

function assertOpen(w: WaitRow): void {
  if (w.template_key === PRICE_REVIEW_TEMPLATE_KEY || isPriceReviewApproval(w)) throw new ApiError("That one is Mike's to approve on the wait itself.", 400, 'price_review');
  if (['done', 'expired'].includes(w.state)) throw new ApiError('That wait is already finished.', 409, 'wait_closed');
}

async function activeUser(db: OpDb, id: string): Promise<{ id: string; name: string }> {
  const u = await db.user.findUnique({ where: { id }, select: { id: true, name: true, is_active: true } });
  if (!u || !u.is_active) throw new ApiError('That person is not available.', 409, 'assignee_unavailable');
  return u;
}

const lookups = (db: OpDb) => prismaOwnerLookups(db as unknown as Parameters<typeof prismaOwnerLookups>[0]);

/** Does the wait, with these owner fields, resolve to Bast? */
async function bastOwns(db: OpDb, w: WaitRow, over: Partial<WaitRow>): Promise<boolean> {
  return (await resolveWaitOwner({ ...w, ...over }, lookups(db))).user_id === BAST_USER_ID;
}

/**
 * `complete` advances the chain (resolveWait opens the next step through buildNextStepData). Build that step the way
 * the sweeper will, resolve who it is for, and say what it does. No next step: finishing only stops.
 */
async function nextStepReach(db: OpDb, w: WaitRow, now: Date): Promise<{ open_after: boolean; owner_is_bast_after?: boolean; next_action?: string }> {
  const data = buildNextStepData(w as unknown as Parameters<typeof buildNextStepData>[0], now);
  if (!data) return { open_after: false };
  const next = { ...w, ...data, stand_in_user_id: null, escalated_to_user_id: null } as unknown as WaitRow;
  const owner = await resolveWaitOwner(next, lookups(db));
  return { open_after: true, owner_is_bast_after: owner.user_id === BAST_USER_ID, next_action: data.terminal_action };
}

async function reachOpFor(db: OpDb, w: WaitRow, input: WaitInput, now: Date): Promise<ReachOp> {
  const base = { op: 'wait_change' as const, wait_id: w.id, action: input.action };
  if (input.action === 'complete') return { ...base, ...(await nextStepReach(db, w, now)) };
  if (input.action === 'pause' || input.action === 'cancel') return base;
  const over: Partial<WaitRow> = input.action === 'reassign' ? { owner_user_id: input.owner_user_id, escalated_to_user_id: null } : {};
  return { ...base, open_after: true, owner_is_bast_after: await bastOwns(db, w, over) };
}

async function prepare(ctx: OpContext, input: WaitInput, origin: ReachOrigin): Promise<PreparedOp> {
  const db = ctx.db as OpDb;
  const w = await load(db, input.wait_id);
  assertOpen(w);
  if (input.action === 'resume' && w.state !== 'paused') throw new ApiError('The wait is not paused.', 409, 'not_paused');
  if (input.action === 'pause' && new Date(input.until).getTime() <= ctx.now.getTime()) throw new ApiError('That time is not in the future.', 400, 'bad_until');
  if (input.action === 'extend' && !input.business_days && !input.until) throw new ApiError('Give business_days or until.', 400, 'bad_extend');
  if (input.action === 'extend' && input.business_days && input.until) throw new ApiError('Give business_days or until, not both.', 400, 'bad_extend');
  if (input.action === 'reassign') await activeUser(db, input.owner_user_id);
  const reach = checkOp({ op: await reachOpFor(db, w, input, ctx.now), now: ctx.now, origin });
  const t = cleanLine(w.title, 60);
  return {
    reach,
    expect: { updated_at: w.updated_at.toISOString(), state: w.state },
    copy: {
      clause:
        input.action === 'reassign'
          ? `give the wait "${t}" to someone`
          : input.action === 'resume'
            ? `resume the wait "${t}"`
            : input.action === 'complete'
              ? `finish the wait "${t}"`
              : `change the date of the wait "${t}"`,
      why: input.action === 'complete' ? [] : ['The wait makes a task for Bast when it comes due.'],
      // Finishing a wait hands nothing over by itself: the button says what the tap does (VERIFY-2 N7).
      ...(input.action === 'complete' ? { buttons: { yes: 'Finish it', no: 'Keep it open' } } : {}),
    },
  };
}

function linePlain(a: string, title: string, due: Date | null, toName: string | null, now: Date): string {
  switch (a) {
    case 'redate':
    case 'extend':
      return opSummary({ op: 'wait_change', action: a, title, due: due ?? now }, now);
    case 'reassign':
      return opSummary({ op: 'wait_change', action: 'reassign', title, to_name: toName ?? 'someone' }, now);
    default:
      return opSummary({ op: 'wait_change', action: a as 'pause' | 'resume' | 'complete' | 'cancel', title }, now);
  }
}

async function run(ctx: OpContext, input: WaitInput, expect: unknown): Promise<OpRun> {
  const e = expectSchema.safeParse(expect);
  if (!e.success) throw new ApiError('Changed since. Open the wait.', 409, 'changed_since');
  const base = ctx.db as OpDb;
  const inTx = async (raw: OpDb): Promise<OpRun> => {
    // The claim: the wait must be exactly as read, and nobody else can change it until this commits.
    const claim = await raw.wait.updateMany({ where: { id: input.wait_id, updated_at: new Date(e.data.updated_at), state: e.data.state as never }, data: { updated_at: ctx.now } });
    if (claim.count !== 1) throw new ApiError('Changed since. Open the wait.', 409, 'changed_since');
    const store: SweepStore = prismaSweepStore(raw as PrismaClient);
    const w = await load(raw, input.wait_id);
    assertOpen(w);
    const common = { now: ctx.now, source: 'user' as const, actor_user_id: ctx.ownerId, reason: REASON };
    let next: WaitRow;
    let toName: string | null = null;
    switch (input.action) {
      case 'redate':
        next = await redateWait(store, w, { ...common, due_at: new Date(input.due_at) });
        break;
      case 'extend': {
        const r = await extendWait(store, w, { ...common, business_days: input.business_days, until: input.until ? new Date(input.until) : undefined });
        if (!r.ok) throw new ApiError(r.code === 'cap' ? 'That wait has been extended as far as it goes. It needs a person.' : 'That wait is already finished.', 409, 'extend_refused');
        if (r.added_business_days === 0) throw new ApiError('It already comes due after that.', 409, 'no_change');
        next = r.wait;
        break;
      }
      case 'pause':
        next = await pauseWait(store, w, { ...common, until: new Date(input.until) });
        break;
      case 'resume':
        if (w.state !== 'paused') throw new ApiError('The wait is not paused.', 409, 'not_paused');
        next = await resumeWait(store, w, common);
        break;
      case 'reassign': {
        const u = await activeUser(raw, input.owner_user_id);
        toName = cleanLine(u.name.split(/\s+/)[0] ?? '', 40) || 'someone';
        next = await reassignWait(store, w, { ...common, owner_user_id: input.owner_user_id });
        break;
      }
      case 'complete':
        next = await resolveByPerson(store, w, 'completed', common);
        break;
      case 'cancel':
        next = await resolveByPerson(store, w, 'cancelled', common);
        break;
    }
    const finished = input.action === 'complete' || input.action === 'cancel';
    const line = linePlain(input.action, w.title, next.due_at, toName, ctx.now);
    return {
      target_id: w.id,
      before: { wait_id: w.id, action: input.action, ...snapshot(w) } as OpJson,
      after: { wait_id: w.id, action: input.action, ...snapshot(next) } as OpJson,
      summary: cleanLine(finished ? `${line}${NO_UNDO}` : line, 300),
      result: { wait_id: w.id, state: next.state, due_at: next.due_at.toISOString(), undoable: !finished },
      undoable: !finished,
    };
  };
  const anyDb = base as unknown as { $transaction?: unknown };
  return typeof anyDb.$transaction === 'function' ? base.$transaction((tx) => inTx(tx as unknown as OpDb)) : inTx(base);
}

function recordSnaps(a: BastChatAction): { before: z.infer<typeof snapSchema>; after: z.infer<typeof snapSchema> } {
  const before = snapSchema.safeParse(a.before);
  const after = snapSchema.safeParse(a.after);
  if (!before.success || !after.success) throw new ApiError("That can't be undone from here. Open it in Citadel.", 409, 'not_undoable');
  if (a.undo_until === null || before.data.action === 'complete' || before.data.action === 'cancel') throw new ApiError("That can't be undone.", 409, 'not_undoable');
  return { before: before.data, after: after.data };
}

/** The columns an Undo of `action` writes back, from the before snapshot. */
function restoreData(action: string, b: Snap | z.infer<typeof snapSchema>): Partial<WaitRow> {
  switch (action) {
    case 'redate':
    case 'extend':
      return { due_at: new Date(b.due_at), extended_bd_total: b.extended_bd_total, extension_count: b.extension_count, nag_level: b.nag_level, last_nag_at: asDate(b.last_nag_at), fired_at: asDate(b.fired_at), claimed_at: asDate(b.claimed_at) };
    case 'pause':
      return { state: b.state as WaitRow['state'], paused_until: asDate(b.paused_until), paused_remaining_ms: (b.paused_remaining_ms != null ? BigInt(b.paused_remaining_ms) : null) as WaitRow['paused_remaining_ms'], due_at: new Date(b.due_at), claimed_at: asDate(b.claimed_at) };
    case 'resume':
      return { state: b.state as WaitRow['state'], paused_until: asDate(b.paused_until), paused_remaining_ms: (b.paused_remaining_ms != null ? BigInt(b.paused_remaining_ms) : null) as WaitRow['paused_remaining_ms'], due_at: new Date(b.due_at) };
    case 'reassign':
      return { owner_user_id: b.owner_user_id, owner_function_id: b.owner_function_id, escalated_to_user_id: b.escalated_to_user_id };
    default:
      throw new ApiError("That can't be undone.", 409, 'not_undoable');
  }
}

/** Does the wait still hold what the action left? */
function holdsAfter(w: WaitRow, action: string, a: z.infer<typeof snapSchema>): boolean {
  switch (action) {
    case 'redate':
    case 'extend':
      return w.state === a.state && w.due_at.toISOString() === a.due_at;
    case 'pause':
      return w.state === 'paused' && (w.paused_until?.toISOString() ?? null) === a.paused_until;
    case 'resume':
      return w.state === a.state && w.due_at.toISOString() === a.due_at;
    case 'reassign':
      return w.owner_user_id === a.owner_user_id && !['done', 'expired'].includes(w.state);
    default:
      return false;
  }
}

export const waitOp: OpDef<WaitInput> = {
  name: 'wait',
  target_type: 'wait',
  tool: 'change_wait',
  validate: (raw) => inputSchema.parse(raw),
  targetId: (input) => input.wait_id,
  prepare,
  run,
  async prepareUndo(ctx, record) {
    const { before, after } = recordSnaps(record);
    const db = ctx.db as OpDb;
    const w = await load(db, before.wait_id);
    if (!holdsAfter(w, before.action, after)) throw new ApiError('Changed since. Open the wait.', 409, 'changed_since');
    const restored = restoreData(before.action, before);
    const inverse = before.action === 'pause' ? 'resume' : before.action === 'resume' ? 'pause' : before.action === 'extend' ? 'redate' : before.action;
    const stops = inverse === 'pause';
    const op: ReachOp = stops
      ? { op: 'wait_change', wait_id: w.id, action: 'pause' }
      : { op: 'wait_change', wait_id: w.id, action: inverse, open_after: true, owner_is_bast_after: await bastOwns(db, w, restored) };
    return {
      reach: checkOp({ op, now: ctx.now, origin: 'undo' }),
      expect: { updated_at: w.updated_at.toISOString(), state: w.state },
      copy: { clause: `put the wait "${cleanLine(w.title, 60)}" back as it was`, why: ['The wait makes a task for Bast when it comes due.'] },
    };
  },
  async undo(ctx, record, expect) {
    const e = expectSchema.safeParse(expect);
    if (!e.success) return { ok: false, reason: 'invalid' };
    const { before, after } = recordSnaps(record);
    const base = ctx.db as OpDb;
    const inTx = async (raw: OpDb) => {
      const claim = await raw.wait.updateMany({ where: { id: before.wait_id, updated_at: new Date(e.data.updated_at), state: e.data.state as never }, data: { updated_at: ctx.now } });
      if (claim.count !== 1) return false;
      const w = await load(raw, before.wait_id);
      if (!holdsAfter(w, before.action, after)) return false;
      const store = prismaSweepStore(raw as PrismaClient);
      await store.update(w.id, restoreData(before.action, before));
      await store.addEvent({
        wait_id: w.id,
        kind: before.action === 'reassign' ? 'reassigned' : before.action === 'pause' ? 'resumed' : before.action === 'resume' ? 'paused' : 'extended',
        from_state: w.state,
        to_state: before.state,
        from_due_at: w.due_at,
        to_due_at: new Date(before.due_at),
        reason: UNDO_REASON,
        source: 'user',
        actor_user_id: ctx.ownerId,
      });
      return true;
    };
    const anyDb = base as unknown as { $transaction?: unknown };
    const ok = typeof anyDb.$transaction === 'function' ? await base.$transaction((tx) => inTx(tx as unknown as OpDb)) : await inTx(base);
    return ok ? { ok: true } : { ok: false, reason: 'changed_since' };
  },
};
