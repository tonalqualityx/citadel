/**
 * Slice 4a: the owner's home_owed_thread rows and the taps on them. Kept apart from store.ts so that load.ts and act.ts
 * can use them without a cycle (store.ts reads the whole home screen). Writes only the request fields of one row.
 */

import type { Prisma } from '@prisma/client';
import type { HomeDb } from '../state';
import type { OwedRequestKind, OwedRow } from './state';

export const OWED_RUN_KIND = 'owed_reply';
/** The home_actions.action the run's keeper line is written under (in KEEPER_ACTIONS and KeeperActionKind; it has no Undo). */
export const OWED_ACTION = 'keeper_owed_drafts';

export const OWED_ROW_SELECT = {
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
  needs_commitment: true,
  thought_since: true,
  lead_clock_from: true,
  resurfaced_at: true,
  resurface_count: true,
  not_lead_at: true,
  keep_lead_at: true,
  joined_to_key: true,
  replied_elsewhere_at: true,
  replied_elsewhere_from: true,
  auto_drafted_at: true,
  short_draft_id: true,
  short_draft_hash: true,
  short_draft_text: true,
} satisfies Prisma.HomeOwedThreadSelect;

/** The owner's owed rows (all of them; the user id is in the where clause). */
export async function loadOwedRows(db: HomeDb, userId: string): Promise<OwedRow[]> {
  return db.homeOwedThread.findMany({ where: { user_id: userId }, select: OWED_ROW_SELECT });
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

// ============================================================================
// Slice 4c: lead marks (Keep it, Treat as a reply)
// ============================================================================

export const OWED_MARK_FIELDS = ['lead_clock_from', 'keep_lead_at', 'not_lead_at'] as const;
export type OwedMarkField = (typeof OWED_MARK_FIELDS)[number];
/** The marks a tap writes, as ISO strings (or null), so Undo can compare and put back. */
export type OwedMarkValues = Partial<Record<OwedMarkField, string | null>>;

export type MarkOwedResult = { ok: true; before: OwedMarkValues; after: OwedMarkValues } | { ok: false; reason: 'not_lead' };

/** Write lead marks on the owner's own row. Only these columns change; nothing is sent. */
export async function markOwed(db: HomeDb, userId: string, key: string, patch: Partial<Record<OwedMarkField, Date | null>>): Promise<MarkOwedResult> {
  const where = { user_id_thread_key: { user_id: userId, thread_key: key } };
  const row = await db.homeOwedThread.findUnique({ where, select: { lead_clock_from: true, keep_lead_at: true, not_lead_at: true } });
  const before: OwedMarkValues = {};
  const after: OwedMarkValues = {};
  for (const f of Object.keys(patch) as OwedMarkField[]) {
    before[f] = row?.[f] ? row[f]!.toISOString() : null;
    after[f] = patch[f] ? patch[f]!.toISOString() : null;
  }
  await db.homeOwedThread.upsert({ where, create: { user_id: userId, thread_key: key, ...patch }, update: patch });
  return { ok: true, before, after };
}

/** Undo of a lead mark: a field goes back only while it still holds what the tap wrote. */
export async function undoOwedMark(db: HomeDb, userId: string, key: string, before: OwedMarkValues, after: OwedMarkValues): Promise<void> {
  const row = await db.homeOwedThread.findUnique({
    where: { user_id_thread_key: { user_id: userId, thread_key: key } },
    select: { lead_clock_from: true, keep_lead_at: true, not_lead_at: true },
  });
  if (!row) return;
  const patch: Partial<Record<OwedMarkField, Date | null>> = {};
  for (const f of Object.keys(before) as OwedMarkField[]) {
    const now = row[f] ? row[f]!.toISOString() : null;
    if (now === (after[f] ?? null)) patch[f] = before[f] ? new Date(before[f] as string) : null;
  }
  if (Object.keys(patch).length > 0) await db.homeOwedThread.update({ where: { user_id_thread_key: { user_id: userId, thread_key: key } }, data: patch });
}
