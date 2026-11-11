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
