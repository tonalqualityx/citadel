/**
 * Slice 4a: reads and writes of home_owed_thread for the owner, plus the run's own bookkeeping.
 *
 * Writes only: home_owed_thread, one home_keeper_runs row per owner and zoned day (kind owed_reply, upserted each
 * run, finished_at is the "within the hour" freshness stamp), and one home_actions row (source keeper) per run that
 * drafted something. NEVER an EmailAsk, a Task or an EmailOutbox row, and nothing is ever sent.
 */

import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import { zonedDateString } from '../act';
import { loadHomeInputs } from '../load';
import { appendHomeAction, dateOnly, type HomeDb } from '../state';
import { ownerOnHome } from '../keeper/run';
import { parseItemKey, threadKey } from '../item-key';
import { threadClient } from '../score';
import { checkDraftBody, checkRead, checkSuggested } from './checks';
import { draftedLine, OWED } from './copy';
import { owedQueue } from './queue';
import type { OwedRequestKind, OwedRow } from './state';

export const OWED_RUN_KIND = 'owed_reply';
/** The home_actions.action the run's keeper line is written under (2c's list in load.ts and types.ts gains it at wire-in). */
export const OWED_ACTION = 'keeper_owed_drafts';

const ROW_SELECT = {
  thread_key: true,
  state: true,
  request_kind: true,
  requested_at: true,
  draft_id: true,
  draft_hash: true,
  draft_for_ask_id: true,
  drafted_at: true,
  mike_edited_at: true,
  attempts: true,
  updated_at: true,
  bast_read: true,
  suggested_answer: true,
  draft_text: true,
} satisfies Prisma.HomeOwedThreadSelect;

/** The owner's owed rows (all of them; the user id is in the where clause). */
export async function loadOwedRows(db: HomeDb, userId: string): Promise<OwedRow[]> {
  return db.homeOwedThread.findMany({ where: { user_id: userId }, select: ROW_SELECT });
}

// ============================================================================
// GET: what to draft
// ============================================================================

export interface OwedWorkItem {
  thread_key: string;
  account: string;
  thread_id: string;
  ask_ids: string[];
  newest: {
    ask_id: string;
    gmail_id: string;
    from_email: string;
    from_name: string | null;
    subject: string;
    received_at: string;
    intent: string | null;
  };
  client_name: string | null;
  lead: boolean;
  request: OwedRequestKind | null;
  suggested_answer: string | null;
  bast_draft: { draft_id: string; draft_hash: string | null; for_ask_id: string | null } | null;
}

/** The owner's drafting queue in order, at most `limit` (6 by default). Writes nothing. */
export async function listOwedWork(
  db: PrismaClient,
  ownerId: string,
  now: Date,
  limit: number = OWED.perRun,
): Promise<{ skipped?: 'home_off'; items: OwedWorkItem[] }> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { skipped: 'home_off', items: [] };
  const cap = Math.max(1, Math.min(OWED.perRun, Math.floor(limit) || OWED.perRun));
  const [raw, rows] = await Promise.all([
    loadHomeInputs(db, ownerId, now, { timezone: timezone || DEFAULT_DISPLAY_TIMEZONE }),
    loadOwedRows(db, ownerId),
  ]);
  const crisisKeys = new Set(raw.crises.map((c) => threadKey(c.account, c.thread_id ?? c.message_id)));
  const queue = owedQueue({ crisisKeys }, raw.threads, rows, now, cap);
  const items = queue.map((e): OwedWorkItem => {
    const newest = e.thread.asks[0];
    const row = e.row;
    return {
      thread_key: e.thread_key,
      account: e.thread.account,
      thread_id: e.thread.thread_id,
      ask_ids: e.thread.asks.map((a) => a.id),
      newest: {
        ask_id: newest.id,
        gmail_id: newest.message_id,
        from_email: newest.from_email,
        from_name: newest.from_name,
        subject: newest.subject,
        received_at: newest.received_at.toISOString(),
        intent: newest.intent,
      },
      client_name: threadClient(e.thread)?.name ?? null,
      lead: e.lead,
      request: e.request,
      suggested_answer: row?.suggested_answer ?? null,
      bast_draft: row?.draft_id ? { draft_id: row.draft_id, draft_hash: row.draft_hash, for_ask_id: row.draft_for_ask_id } : null,
    };
  });
  return { items };
}

// ============================================================================
// POST: save the machine's results
// ============================================================================

export type OwedResultItem =
  | { thread_key: string; newest_ask_id: string; outcome: 'drafted'; draft_id: string; draft_message_id: string; draft_text: string; model: string; cost_usd?: number }
  | { thread_key: string; newest_ask_id: string; outcome: 'needs_thought'; read: string; suggested_answer: string | null; needs_commitment: boolean; model: string; cost_usd?: number }
  | { thread_key: string; newest_ask_id: string; outcome: 'mike_edited' }
  | { thread_key: string; newest_ask_id: string; outcome: 'failed'; error: string };

export interface OwedRefusal {
  thread_key: string;
  reason: string;
  /** 409 for a stale ask; absent otherwise. */
  status?: number;
}

export interface OwedSaveResult {
  skipped?: 'home_off';
  saved: { thread_key: string; outcome: OwedResultItem['outcome'] }[];
  refused: OwedRefusal[];
  action_id: string | null;
  line: string | null;
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

function personName(a: { from_name: string | null; from_email: string }): string {
  const name = (a.from_name ?? '').replace(/["<>]/g, '').trim();
  if (name) return name;
  const local = a.from_email.split('@')[0] ?? '';
  return local.trim() || 'someone';
}

/** The first failed check on an item, as a reason like draft_money or read_shape, or null. */
export function itemRefusal(item: OwedResultItem): string | null {
  if (item.outcome === 'drafted') {
    const r = checkDraftBody(item.draft_text);
    return r.ok ? null : `draft_${r.category}`;
  }
  if (item.outcome === 'needs_thought') {
    const read = checkRead(item.read);
    if (!read.ok) return `read_${read.category}`;
    if (item.suggested_answer !== null) {
      const s = checkSuggested(item.suggested_answer);
      if (!s.ok) return `suggested_${s.category}`;
    }
  }
  return null;
}

type Counts = { drafted: number; needs_thought: number; mike_edited: number; failed: number; refused: number; stale: number };

function addCounts(prior: unknown, add: Counts): Counts {
  const p = prior && typeof prior === 'object' && !Array.isArray(prior) ? (prior as Record<string, unknown>) : {};
  const n = (k: keyof Counts) => (typeof p[k] === 'number' ? (p[k] as number) : 0) + add[k];
  return { drafted: n('drafted'), needs_thought: n('needs_thought'), mike_edited: n('mike_edited'), failed: n('failed'), refused: n('refused'), stale: n('stale') };
}

/**
 * Save the machine's results for the owner, in one transaction. Each item is checked again here (the same TS checks),
 * and an item whose newest_ask_id is no longer the live newest open ask on that thread is refused 409 stale and
 * writes nothing. Valid items are saved even when others are refused.
 */
export async function saveOwedResults(db: PrismaClient, userId: string, items: readonly OwedResultItem[], now: Date): Promise<OwedSaveResult> {
  const empty: OwedSaveResult = { saved: [], refused: [], action_id: null, line: null };
  const { ok, timezone } = await ownerOnHome(db, userId);
  if (!ok) return { ...empty, skipped: 'home_off' };
  const date = dateOnly(zonedDateString(now, timezone || DEFAULT_DISPLAY_TIMEZONE));

  return db.$transaction(
    async (tx) => {
      const saved: OwedSaveResult['saved'] = [];
      const refused: OwedRefusal[] = [];
      const counts: Counts = { drafted: 0, needs_thought: 0, mike_edited: 0, failed: 0, refused: 0, stale: 0 };
      const draftedNames: string[] = [];
      const draftedKeys: string[] = [];
      const seen = new Set<string>();

      for (const item of items) {
        const refuse = (reason: string, status?: number) => {
          refused.push({ thread_key: item.thread_key, reason, ...(status ? { status } : {}) });
          counts.refused += 1;
        };
        const parsed = parseItemKey(item.thread_key);
        if (!parsed || parsed.kind !== 'thread') {
          refuse('bad_key');
          continue;
        }
        if (seen.has(item.thread_key)) {
          refuse('duplicate');
          continue;
        }
        seen.add(item.thread_key);

        const why = itemRefusal(item);
        if (why) {
          refuse(why);
          continue;
        }

        const newest = await tx.emailAsk.findFirst({
          where: {
            account: parsed.account,
            state: 'open',
            is_urgent: false,
            OR: [{ thread_id: parsed.thread_id }, { thread_id: null, message_id: parsed.thread_id }],
          },
          orderBy: { received_at: 'desc' },
          select: { id: true, from_name: true, from_email: true },
        });
        if (!newest || newest.id !== item.newest_ask_id) {
          refuse('stale', 409);
          counts.stale += 1;
          continue;
        }

        const where = { user_id_thread_key: { user_id: userId, thread_key: item.thread_key } };
        const row = await tx.homeOwedThread.findUnique({ where, select: { draft_id: true, attempts: true } });

        if (item.outcome === 'mike_edited') {
          if (!row?.draft_id) {
            refuse('no_draft');
            continue;
          }
          await tx.homeOwedThread.update({ where, data: { mike_edited_at: now, request_kind: null, requested_at: null } });
          counts.mike_edited += 1;
        } else if (item.outcome === 'failed') {
          const failure = { attempts: (row?.attempts ?? 0) + 1, last_error: item.error.slice(0, 300), request_kind: null, requested_at: null };
          await tx.homeOwedThread.upsert({
            where,
            create: { user_id: userId, thread_key: item.thread_key, state: 'failed', ...failure },
            update: row?.draft_id ? failure : { state: 'failed', ...failure },
          });
          counts.failed += 1;
        } else if (item.outcome === 'drafted') {
          const data = {
            state: 'drafted',
            request_kind: null,
            requested_at: null,
            draft_id: item.draft_id,
            draft_message_id: item.draft_message_id,
            draft_hash: sha256(item.draft_text),
            draft_text: item.draft_text,
            draft_for_ask_id: item.newest_ask_id,
            drafted_at: now,
            mike_edited_at: null,
            bast_read: null,
            suggested_answer: null,
            needs_commitment: false,
            thought_since: null,
            attempts: 0,
            last_error: null,
            last_model: item.model.slice(0, 20),
          };
          await tx.homeOwedThread.upsert({ where, create: { user_id: userId, thread_key: item.thread_key, ...data }, update: data });
          counts.drafted += 1;
          draftedNames.push(personName(newest));
          draftedKeys.push(item.thread_key);
        } else {
          const data = {
            state: 'needs_thought',
            request_kind: null,
            requested_at: null,
            bast_read: item.read,
            suggested_answer: item.suggested_answer,
            needs_commitment: item.needs_commitment,
            thought_since: now,
            attempts: 0,
            last_error: null,
            last_model: item.model.slice(0, 20),
          };
          await tx.homeOwedThread.upsert({ where, create: { user_id: userId, thread_key: item.thread_key, ...data }, update: data });
          counts.needs_thought += 1;
        }
        saved.push({ thread_key: item.thread_key, outcome: item.outcome });
      }

      // The run itself: finished_at is what lets the screen say "within the hour".
      const runKey = { user_id_date_kind: { user_id: userId, date, kind: OWED_RUN_KIND } };
      const prior = await tx.homeKeeperRun.findUnique({ where: runKey, select: { counts: true } });
      const merged = addCounts(prior?.counts, counts);
      await tx.homeKeeperRun.upsert({
        where: runKey,
        create: { user_id: userId, date, kind: OWED_RUN_KIND, finished_at: now, counts: merged },
        update: { finished_at: now, counts: merged, error: null },
      });

      let actionId: string | null = null;
      let line: string | null = null;
      if (draftedNames.length > 0) {
        line = draftedLine(draftedNames);
        const action = await appendHomeAction(tx, userId, {
          item_key: null,
          action: OWED_ACTION,
          source: 'keeper',
          before: {},
          after: { line, details: draftedNames.map((n) => `Reply drafted to ${n}`).slice(0, 50), thread_keys: draftedKeys },
          // A draft is his to keep or discard: there is no Undo, so the window is already closed.
          undo_until: now,
        });
        actionId = action.id;
      }
      return { saved, refused, action_id: actionId, line };
    },
    { timeout: 30_000 },
  );
}

// ============================================================================
// Taps (Draft it now, Needs thought, Go with that)
// ============================================================================

export type RequestOwedResult =
  | { ok: true; before: { request_kind: string | null; requested_at: string | null } }
  | { ok: false; reason: 'no_suggestion' | 'already_drafted' };

/**
 * Record a tap on a thread: only the request fields of the owner's row. 'go_with_that' needs a needs_thought row with a
 * suggested answer. 'draft' on a thread whose Bast draft already covers the newest message is refused. Never touches
 * anything outside home_owed_thread; the caller writes the home_actions row and sends nothing.
 */
export async function requestOwed(db: HomeDb, userId: string, key: string, kind: OwedRequestKind, now: Date): Promise<RequestOwedResult> {
  const where = { user_id_thread_key: { user_id: userId, thread_key: key } };
  const row = await db.homeOwedThread.findUnique({
    where,
    select: { state: true, suggested_answer: true, request_kind: true, requested_at: true, draft_id: true, mike_edited_at: true },
  });
  if (kind === 'go_with_that' && !(row?.state === 'needs_thought' && row.suggested_answer)) return { ok: false, reason: 'no_suggestion' };
  if (kind === 'draft' && row?.draft_id && row.state === 'drafted' && !row.mike_edited_at) return { ok: false, reason: 'already_drafted' };
  const before = { request_kind: row?.request_kind ?? null, requested_at: row?.requested_at ? row.requested_at.toISOString() : null };
  await db.homeOwedThread.upsert({
    where,
    create: { user_id: userId, thread_key: key, request_kind: kind, requested_at: now },
    update: { request_kind: kind, requested_at: now },
  });
  return { ok: true, before };
}

/**
 * Undo a tap that has not been served yet: put the request fields back as `before` had them, only while the row still
 * holds the tap Undo is for. Returns false when the next run already served it (the draft is in his Gmail then).
 */
export async function clearOwedRequest(
  db: HomeDb,
  userId: string,
  key: string,
  kind: OwedRequestKind,
  before: { request_kind: string | null; requested_at: string | null },
): Promise<boolean> {
  const r = await db.homeOwedThread.updateMany({
    where: { user_id: userId, thread_key: key, request_kind: kind },
    data: { request_kind: before.request_kind, requested_at: before.requested_at ? new Date(before.requested_at) : null },
  });
  return r.count === 1;
}
