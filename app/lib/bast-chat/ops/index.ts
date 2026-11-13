/**
 * Bast chat v2: the operations behind POST /api/bast-chat/worker/ops (plan 2.1 and 2.2).
 *
 * Seven operations, each a `ChatOperation` registered once with `registerChatOperation` when this module loads
 * (so the undo, release, decline and undo-since routes import it for its side effect):
 *
 *   name         target_type  tool (stored)        what it changes
 *   home         home         home_change          the OWNER's own home_item_state, home_day and home_actions rows
 *   comment      comment      comment_on_task      one internal comment on a task, written as Bast
 *   email_ask    email_ask    close_email_ask      an email ask's state (handled, dismissed, open)
 *   wait         wait         change_wait          a wait's owner, due date, pause or end
 *   project      project      change_project       a project's status
 *   start_project project_start start_project      a new project (hidden, status queue) and a kickoff task for the owner; a new client only when asked
 *   start_quote  quote_start  start_quote          a deal record (status lead) and a pricing task for the owner; no value, no Proposal, nothing sent
 *
 * Besides the registry's `prepare`, `apply`, `prepareUndo` and `undo`, each op has `run`: the write that returns the
 * TRUE before and after for the chat's record (`OpRun`). `apply` (the owner's tap) is `run` with the outcome mapped.
 * `run` takes only `ctx.ownerId` from the settings, never an id from the request. It may run inside a transaction
 * (`ctx.db` is then the transaction client) unless the op sets `ownTransaction` (home: runHomeAct opens its own).
 *
 * The files under this folder do not import this module (it imports them), so there is no import cycle.
 */
import { ZodError } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { getChatOperation, registerChatOperation, type ChatOperation, type OpContext, type OpOutcome } from '../actions';
import { homeOp } from './home';
import { commentOp } from './comment';
import { emailAskOp } from './email-ask';
import { waitOp } from './wait';
import { projectOp } from './project';
import { startProjectOp } from './start-project';
import { startQuoteOp } from './start-quote';

export type OpJson = Prisma.InputJsonValue;
export type OpDb = PrismaClient;

/** What a write did, for the chat's record, the line Mike sees and the small answer the machine gets. */
export interface OpRun {
  /** The record's `target_id`: the row Undo and the panel point at. */
  target_id: string;
  /** The values the op changed, as they were. Allowlisted fields only. */
  before: OpJson;
  /** The same values as the op left them. */
  after: OpJson;
  /** The line Mike sees (`opSummary`, plus "It can't be undone." where that is true). */
  summary: string;
  /** What the machine gets back, small and plain. */
  result: Record<string, OpJson | null>;
  /** False when Undo is refused (a finished wait cannot be reopened). Then the record has no undo window. */
  undoable: boolean;
  /** Length of the undo window in hours when it is not the chat's usual one (Triage's Release and Drop keep 72 hours). */
  undo_hours?: number;
  /** Side effects that must wait until the write has committed (a team notice). */
  afterCommit?: () => Promise<void>;
}

/** What each operation file exports. `apply` is added here. */
export type OpDef<I> = Omit<ChatOperation<I>, 'apply'> & {
  /** The tool name stored on the record and its proposal. */
  readonly tool: string;
  /** True when `run` opens its own transaction (do not hand it a transaction client). */
  readonly ownTransaction?: boolean;
  run(ctx: OpContext, input: I, expect: unknown): Promise<OpRun>;
};

export type RunnableOp<I = unknown> = ChatOperation<I> & Pick<OpDef<I>, 'tool' | 'ownTransaction' | 'run'>;

/** A thrown ApiError below 500 or a zod error is a plain outcome; anything else is a real fault. */
export function outcomeOf(e: unknown): OpOutcome {
  if (e instanceof ApiError && e.statusCode < 500) return e.statusCode === 409 ? { ok: false, reason: 'changed_since', message: e.message } : { ok: false, reason: 'invalid', message: e.message };
  if (e instanceof ZodError) return { ok: false, reason: 'invalid' };
  throw e;
}

function define<I>(def: OpDef<I>): RunnableOp<I> {
  const op: RunnableOp<I> = {
    ...def,
    async apply(ctx, input, expect) {
      try {
        const r = await def.run(ctx, input, expect);
        if (r.afterCommit) await r.afterCommit();
        return { ok: true };
      } catch (e) {
        return outcomeOf(e);
      }
    },
  };
  registerChatOperation(op);
  return op;
}

export const OPS: readonly RunnableOp<never>[] = [
  define(homeOp),
  define(commentOp),
  define(emailAskOp),
  define(waitOp),
  define(projectOp),
  define(startProjectOp),
  define(startQuoteOp),
] as unknown as readonly RunnableOp<never>[];

/** The operation of the ops route: only the seven above (the task kind is not reachable through it). */
export function getRunnableOp(name: string): RunnableOp | null {
  const op = getChatOperation(name);
  if (!op) return null;
  return OPS.some((o) => o.name === op.name) ? (op as RunnableOp) : null;
}

export const OP_NAMES: readonly string[] = OPS.map((o) => o.name);
