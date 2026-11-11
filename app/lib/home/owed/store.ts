/**
 * Slice 4a: reads and writes of home_owed_thread for the owner, plus the run's own bookkeeping.
 *
 * Writes only: home_owed_thread, one home_keeper_runs row per owner and zoned day (kind owed_reply, upserted each
 * run, finished_at is the "within the hour" freshness stamp), and one home_actions row (source keeper) per run that
 * drafted something. NEVER an EmailAsk, a Task or an EmailOutbox row, and nothing is ever sent.
 */

import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import { zonedDateString } from '../act';
import { loadHomeInputs } from '../load';
import { appendHomeAction, dateOnly, loadItemStates } from '../state';
import { ownerOnHome } from '../keeper/run';
import { isItemKey, parseItemKey, threadKey } from '../item-key';
import { threadClient } from '../score';
import { checkDraftBody, checkRead, checkShortDraft, checkSuggested } from './checks';
import { weekdayIn } from './clock';
import { draftedLine, OWED, repliedElsewhereLine, shortDraftedLine } from './copy';
import { mergeJoinedThreads } from './join';
import { owedQueue, type OwedCaps } from './queue';
import type { OwedWorkRequest } from './state';
import { OWED_ACTION, OWED_RUN_KIND, loadOwedRows } from './rows';

export { OWED_ACTION, OWED_RUN_KIND, loadOwedRows, requestOwed, clearOwedRequest, type RequestOwedResult } from './rows';


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
  /** 'short' and 'auto' appear only for a caller that sent ?caps=short / ?caps=auto. */
  request: OwedWorkRequest | null;
  suggested_answer: string | null;
  bast_draft: { draft_id: string; draft_hash: string | null; for_ask_id: string | null } | null;
  /** Only with caps=short: Bast's current full draft, sent with a short request (null otherwise). */
  full_draft_text?: string | null;
  /** Only with caps=joins: the other threads Citadel already knows are joined to this one (may be empty). */
  joined?: { account: string; thread_id: string }[];
}

/** The ?caps=short,auto,joins list. Without any, the items have the 4a shape and never ask for a short or auto draft. */
export interface OwedWorkCaps extends OwedCaps {
  joins: boolean;
}
export const NO_CAPS: OwedWorkCaps = { short: false, auto: false, joins: false };

export function parseCaps(raw: string | null | undefined): OwedWorkCaps {
  const set = new Set((raw ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  return { short: set.has('short'), auto: set.has('auto'), joins: set.has('joins') };
}

/** The owner's drafting queue in order, at most `limit` (6 by default). Writes nothing. */
export async function listOwedWork(
  db: PrismaClient,
  ownerId: string,
  now: Date,
  limit: number = OWED.perRun,
  caps: OwedWorkCaps = NO_CAPS,
): Promise<{ skipped?: 'home_off'; items: OwedWorkItem[] }> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { skipped: 'home_off', items: [] };
  const cap = Math.max(1, Math.min(OWED.perRun, Math.floor(limit) || OWED.perRun));
  const [raw, rows, itemStates] = await Promise.all([
    loadHomeInputs(db, ownerId, now, { timezone: timezone || DEFAULT_DISPLAY_TIMEZONE }),
    loadOwedRows(db, ownerId),
    loadItemStates(db, ownerId),
  ]);
  const crisisKeys = new Set(raw.crises.map((c) => threadKey(c.account, c.thread_id ?? c.message_id)));
  const merged = mergeJoinedThreads(raw.threads, rows);
  const queue = owedQueue({ crisisKeys, members: merged.members, states: new Map(itemStates.map((s) => [s.item_key, s])) }, merged.threads, rows, now, cap, caps);
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
      ...(caps.short ? { full_draft_text: e.request === 'short' ? row?.draft_text ?? null : null } : {}),
      ...(caps.joins
        ? {
            joined: e.joined.flatMap((k) => {
              const p = parseItemKey(k);
              return p && p.kind === 'thread' ? [{ account: p.account, thread_id: p.thread_id }] : [];
            }),
          }
        : {}),
    };
  });
  return { items };
}

// ============================================================================
// POST: save the machine's results
// ============================================================================

/** Any outcome may carry the threads the mirror shows share an RFC Message-ID with this one. */
export interface OwedJoin {
  account: string;
  thread_id: string;
}
type WithJoins = { joins?: OwedJoin[] };

export type OwedResultItem = (
  | { thread_key: string; newest_ask_id: string; outcome: 'drafted'; draft_id: string; draft_message_id: string; draft_text: string; model: string; cost_usd?: number }
  | { thread_key: string; newest_ask_id: string; outcome: 'needs_thought'; read: string; suggested_answer: string | null; needs_commitment: boolean; model: string; cost_usd?: number }
  | { thread_key: string; newest_ask_id: string; outcome: 'mike_edited' }
  | { thread_key: string; newest_ask_id: string; outcome: 'failed'; error: string }
  | { thread_key: string; newest_ask_id: string; outcome: 'short_drafted'; short_draft_id: string; short_draft_text: string; model: string; cost_usd?: number }
  | { thread_key: string; newest_ask_id: string; outcome: 'replied_elsewhere'; replied_from: string; replied_at: string }
) &
  WithJoins;

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
  if (item.outcome === 'short_drafted') {
    const r = checkShortDraft(item.short_draft_text);
    return r.ok ? null : `short_${r.category}`;
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

type Counts = {
  drafted: number;
  needs_thought: number;
  mike_edited: number;
  failed: number;
  refused: number;
  stale: number;
  short_drafted: number;
  replied_elsewhere: number;
};

function addCounts(prior: unknown, add: Counts): Counts {
  const p = prior && typeof prior === 'object' && !Array.isArray(prior) ? (prior as Record<string, unknown>) : {};
  const n = (k: keyof Counts) => (typeof p[k] === 'number' ? (p[k] as number) : 0) + add[k];
  return {
    drafted: n('drafted'),
    needs_thought: n('needs_thought'),
    mike_edited: n('mike_edited'),
    failed: n('failed'),
    refused: n('refused'),
    stale: n('stale'),
    short_drafted: n('short_drafted'),
    replied_elsewhere: n('replied_elsewhere'),
  };
}

type JoinTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function newestInbound(tx: JoinTx, key: string): Promise<number> {
  const p = parseItemKey(key);
  if (!p || p.kind !== 'thread') return 0;
  const a = await tx.emailAsk.findFirst({
    where: { account: p.account, OR: [{ thread_id: p.thread_id }, { thread_id: null, message_id: p.thread_id }] },
    orderBy: { received_at: 'desc' },
    select: { received_at: true },
  });
  return a ? a.received_at.getTime() : 0;
}

/**
 * Store a joined conversation: the item's thread plus the threads the mirror shows share an RFC Message-ID with it, plus
 * anything already joined to any of them. The primary is the thread whose newest inbound message is newest; every other
 * row gets joined_to_key = primary, and the primary's own joined_to_key is cleared. Writes only home_owed_thread.
 */
async function applyJoins(tx: JoinTx, userId: string, thisKey: string, joins: readonly OwedJoin[]): Promise<void> {
  const group = new Set<string>([thisKey]);
  for (const j of joins.slice(0, 8)) {
    const k = threadKey(j.account, j.thread_id);
    if (isItemKey(k)) group.add(k);
  }
  if (group.size < 2) return;
  for (let i = 0; i < 4 && group.size < 16; i++) {
    const keys = [...group];
    const rows = await tx.homeOwedThread.findMany({
      where: { user_id: userId, OR: [{ thread_key: { in: keys } }, { joined_to_key: { in: keys } }] },
      select: { thread_key: true, joined_to_key: true },
    });
    const before = group.size;
    for (const r of rows) {
      if (r.joined_to_key && r.joined_to_key !== r.thread_key) {
        group.add(r.joined_to_key);
        group.add(r.thread_key);
      }
    }
    if (group.size === before) break;
  }
  const keys = [...group];
  const times = new Map<string, number>();
  for (const k of keys) times.set(k, await newestInbound(tx, k));
  let primary = thisKey;
  for (const k of keys) {
    const a = times.get(k) ?? 0;
    const b = times.get(primary) ?? 0;
    if (a > b || (a === b && k !== thisKey && primary !== thisKey && k < primary)) primary = k;
  }
  for (const k of keys) {
    const joinedTo = k === primary ? null : primary;
    await tx.homeOwedThread.upsert({
      where: { user_id_thread_key: { user_id: userId, thread_key: k } },
      create: { user_id: userId, thread_key: k, joined_to_key: joinedTo },
      update: { joined_to_key: joinedTo },
    });
  }
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
      const counts: Counts = { drafted: 0, needs_thought: 0, mike_edited: 0, failed: 0, refused: 0, stale: 0, short_drafted: 0, replied_elsewhere: 0 };
      const shortNames: string[] = [];
      const shortKeys: string[] = [];
      const zone = timezone || DEFAULT_DISPLAY_TIMEZONE;
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
          select: { id: true, from_name: true, from_email: true, intent: true, received_at: true },
        });
        if (!newest || newest.id !== item.newest_ask_id) {
          refuse('stale', 409);
          counts.stale += 1;
          continue;
        }

        const where = { user_id_thread_key: { user_id: userId, thread_key: item.thread_key } };
        const row = await tx.homeOwedThread.findUnique({
          where,
          select: { draft_id: true, attempts: true, state: true, request_kind: true, not_lead_at: true, draft_for_ask_id: true, replied_elsewhere_at: true },
        });

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
            // Slice 4c: a new full draft replaces any short one. A draft written with no tap on a Needs-thought row is the auto draft.
            short_draft_id: null,
            short_draft_hash: null,
            short_draft_text: null,
            auto_drafted_at: row?.state === 'needs_thought' && !row.request_kind ? now : null,
          };
          await tx.homeOwedThread.upsert({ where, create: { user_id: userId, thread_key: item.thread_key, ...data }, update: data });
          counts.drafted += 1;
          draftedNames.push(personName(newest));
          draftedKeys.push(item.thread_key);
        } else if (item.outcome === 'short_drafted') {
          if (!row?.draft_id) {
            refuse('no_draft');
            continue;
          }
          if (row.draft_for_ask_id !== item.newest_ask_id) {
            refuse('stale_draft');
            continue;
          }
          const lead = newest.intent === 'sales' && !(row.not_lead_at && row.not_lead_at.getTime() >= newest.received_at.getTime());
          await tx.homeOwedThread.update({
            where,
            data: {
              short_draft_id: item.short_draft_id,
              short_draft_hash: sha256(item.short_draft_text),
              short_draft_text: item.short_draft_text,
              attempts: 0,
              last_error: null,
              ...(lead ? { resurfaced_at: now, resurface_count: { increment: 1 } } : {}),
            },
          });
          counts.short_drafted += 1;
          shortNames.push(personName(newest));
          shortKeys.push(item.thread_key);
        } else if (item.outcome === 'replied_elsewhere') {
          const at = new Date(item.replied_at);
          if (Number.isNaN(at.getTime())) {
            refuse('bad_replied_at');
            continue;
          }
          const same = row?.replied_elsewhere_at?.getTime() === at.getTime();
          const data = { replied_elsewhere_at: at, replied_elsewhere_from: item.replied_from.slice(0, 320), request_kind: null, requested_at: null };
          await tx.homeOwedThread.upsert({ where, create: { user_id: userId, thread_key: item.thread_key, ...data }, update: data });
          counts.replied_elsewhere += 1;
          if (!same) {
            const name = personName(newest);
            const line = repliedElsewhereLine(name, item.replied_from, weekdayIn(at, zone));
            await appendHomeAction(tx, userId, {
              item_key: null,
              action: OWED_ACTION,
              source: 'keeper',
              before: {},
              after: { line, details: [`${name} was answered from our side`], thread_keys: [item.thread_key] },
              undo_until: now,
            });
          }
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
        if (item.joins && item.joins.length > 0) await applyJoins(tx, userId, item.thread_key, item.joins);
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
      if (shortNames.length > 0) {
        const shortLine = shortDraftedLine(shortNames);
        const action = await appendHomeAction(tx, userId, {
          item_key: null,
          action: OWED_ACTION,
          source: 'keeper',
          before: {},
          after: { line: shortLine, details: shortNames.map((n) => `Short reply drafted to ${n}`).slice(0, 50), thread_keys: shortKeys },
          undo_until: now,
        });
        if (actionId === null) {
          actionId = action.id;
          line = shortLine;
        }
      }
      return { saved, refused, action_id: actionId, line };
    },
    { timeout: 30_000 },
  );
}

