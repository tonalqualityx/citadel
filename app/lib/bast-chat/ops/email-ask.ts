/**
 * Bast chat v2, op `email_ask`: mark an owed email handled, no reply needed, or open again (plan 2.1).
 *
 * Input `{ask_id, state}` where state is `handled`, `dismissed` (no reply needed) or `open` (reopen). Only an ask
 * that is open, handled or dismissed can change; an ask the classifier already filed another way is refused. The
 * write is the same as PATCH /api/email-asks/:id with a state: leaving `open` clears the draft marker and its link
 * in the same write, which this record keeps so Undo can put both back. Reopening does not restore them (only Undo
 * does), and its line says so. Writes are compare-and-set on the state
 * read. No worker session reads ask state, so the reach check never hits.
 *
 * Record: target_id is the ask id; before and after hold `{ask_id, state, draft_started_at, draft_url}`.
 */
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { opSummary, type OpContext, type PreparedOp } from '../actions';
import { checkOp, type ReachOrigin } from '../worker-reach';
import type { OpDef, OpDb, OpRun } from './index';

const STATES = ['open', 'handled', 'dismissed'] as const;
const inputSchema = z.object({ ask_id: z.string().uuid(), state: z.enum(STATES) }).strict();
export type EmailAskInput = z.infer<typeof inputSchema>;
const expectSchema = z.object({ state: z.enum(STATES) }).strict();
const snapSchema = z.object({ ask_id: z.string().uuid(), state: z.enum(STATES), draft_started_at: z.string().nullable(), draft_url: z.string().nullable() }).strict();

type AskRow = { id: string; state: string; subject: string; draft_started_at: Date | null; draft_url: string | null };

async function load(db: OpDb, id: string): Promise<AskRow> {
  const a = await db.emailAsk.findUnique({ where: { id }, select: { id: true, state: true, subject: true, draft_started_at: true, draft_url: true } });
  if (!a) throw new ApiError('That email was not found.', 404, 'ask_missing');
  return a;
}

const snap = (a: AskRow, state: string, cleared: boolean) => ({
  ask_id: a.id,
  state,
  draft_started_at: cleared ? null : (a.draft_started_at?.toISOString() ?? null),
  draft_url: cleared ? null : a.draft_url,
});

async function prepare(ctx: OpContext, input: EmailAskInput, origin: ReachOrigin): Promise<PreparedOp> {
  const a = await load(ctx.db as OpDb, input.ask_id);
  if (!(STATES as readonly string[]).includes(a.state)) throw new ApiError('That email is already filed another way.', 409, 'ask_filed');
  if (a.state === input.state) throw new ApiError('It is already that way.', 409, 'no_change');
  return { reach: checkOp({ op: { op: 'email_ask_state', ask_id: a.id }, now: ctx.now, origin }), expect: { state: a.state }, copy: { clause: `mark an email ${input.state === 'open' ? 'open again' : input.state === 'handled' ? 'handled' : 'as no reply needed'}` } };
}

async function run(ctx: OpContext, input: EmailAskInput, expect: unknown): Promise<OpRun> {
  const e = expectSchema.safeParse(expect);
  if (!e.success) throw new ApiError('Changed since. Open the email.', 409, 'changed_since');
  const db = ctx.db as OpDb;
  const a = await load(db, input.ask_id);
  const leaving = input.state !== 'open';
  const r = await db.emailAsk.updateMany({
    where: { id: a.id, state: e.data.state },
    data: { state: input.state, ...(leaving ? { draft_started_at: null, draft_url: null } : {}) },
  });
  if (r.count !== 1) throw new ApiError('Changed since. Open the email.', 409, 'changed_since');
  return {
    target_id: a.id,
    before: snap(a, e.data.state, false),
    after: snap(a, input.state, leaving),
    summary: opSummary({ op: 'email_ask_state', subject: a.subject, state: input.state, ...(input.state === 'open' ? { draft_kept: !!(a.draft_started_at || a.draft_url) } : {}) }, ctx.now),
    result: { ask_id: a.id, state: input.state },
    undoable: true,
  };
}

export const emailAskOp: OpDef<EmailAskInput> = {
  name: 'email_ask',
  target_type: 'email_ask',
  tool: 'close_email_ask',
  validate: (raw) => inputSchema.parse(raw),
  targetId: (input) => input.ask_id,
  prepare,
  run,
  async prepareUndo(ctx, record) {
    const before = snapSchema.safeParse(record.before);
    const after = snapSchema.safeParse(record.after);
    if (!before.success || !after.success) throw new ApiError("That can't be undone from here. Open it in Citadel.", 409, 'not_undoable');
    const a = await load(ctx.db as OpDb, after.data.ask_id);
    if (a.state !== after.data.state) throw new ApiError('Changed since. Open the email.', 409, 'changed_since');
    return { reach: checkOp({ op: { op: 'email_ask_state', ask_id: a.id }, now: ctx.now, origin: 'undo' }), expect: { state: a.state }, copy: { clause: 'put an email back as it was' } };
  },
  async undo(ctx, record, expect) {
    const before = snapSchema.safeParse(record.before);
    const e = expectSchema.safeParse(expect);
    if (!before.success || !e.success) return { ok: false, reason: 'invalid' };
    const b = before.data;
    const r = await (ctx.db as OpDb).emailAsk.updateMany({
      where: { id: b.ask_id, state: e.data.state },
      data: { state: b.state, draft_started_at: b.draft_started_at ? new Date(b.draft_started_at) : null, draft_url: b.draft_url },
    });
    return r.count === 1 ? { ok: true } : { ok: false, reason: 'changed_since' };
  },
};
