/**
 * Slice 4a: how a thread row reads, from its asks, Bast's owed row and the clock. Pure.
 *
 * owedStatus returns:
 * - 'drafting': a tap (Draft it now, Needs thought, Go with that) is waiting for the next run
 * - 'draft_ready': Bast's draft is in his Gmail and covers the newest message
 * - 'stale_draft': Bast's draft is older than the newest message and he has not touched it (Bast will update it)
 * - 'his_draft': his own draft, or Bast's draft after he edited it
 * - 'his_draft_older': his draft stands and their newer message came after it (Bast leaves it alone)
 * - 'needs_thought': Bast wrote its read instead of a draft
 * - null: nothing to say (no draft and no request, or the last try failed)
 */

import type { RawThread } from '../types';
import { IF_IGNORED, OWED, OWED_SECOND_LINE } from './copy';

export type OwedRowState = 'queued' | 'drafted' | 'needs_thought' | 'failed';
export type OwedRequestKind = 'draft' | 'read' | 'go_with_that';
export type OwedState = 'drafting' | 'draft_ready' | 'stale_draft' | 'his_draft' | 'his_draft_older' | 'needs_thought';

/** The columns of home_owed_thread the pure code reads. */
export interface OwedRow {
  thread_key: string;
  state: string;
  request_kind: string | null;
  requested_at: Date | null;
  draft_id: string | null;
  draft_hash: string | null;
  draft_for_ask_id: string | null;
  drafted_at: Date | null;
  mike_edited_at: Date | null;
  attempts: number;
  updated_at: Date;
  bast_read: string | null;
  suggested_answer: string | null;
  draft_text: string | null;
}

const HOUR_MS = 3_600_000;

/** True when a drafter run finished within the last 2 hours. The only thing that lets a line say "within the hour". */
export function drafterFresh(drafterFreshAt: Date | null | undefined, now: Date): boolean {
  if (!drafterFreshAt) return false;
  const age = now.getTime() - drafterFreshAt.getTime();
  return age >= 0 && age <= OWED.freshHours * HOUR_MS;
}

export function hasBastDraft(row: OwedRow | null | undefined): boolean {
  return !!row && !!row.draft_id;
}

export function owedStatus(thread: RawThread, row: OwedRow | null | undefined, now: Date, drafterFreshAt?: Date | null): OwedState | null {
  void now;
  void drafterFreshAt;
  const newest = thread.asks[0];
  if (!newest) return null;

  if (row && row.request_kind) return 'drafting';
  if (row && row.state === 'needs_thought') return 'needs_thought';

  if (row && row.draft_id) {
    if (row.mike_edited_at) {
      return newest.received_at.getTime() > row.mike_edited_at.getTime() ? 'his_draft_older' : 'his_draft';
    }
    if (row.draft_for_ask_id && row.draft_for_ask_id !== newest.id) return 'stale_draft';
    return 'draft_ready';
  }

  const his = thread.asks.filter((a) => !!a.draft_url);
  if (his.length > 0) {
    const started = Math.max(...his.map((a) => (a.draft_started_at ? a.draft_started_at.getTime() : 0)));
    if (started > 0 && newest.received_at.getTime() > started) return 'his_draft_older';
    return 'his_draft';
  }
  return null;
}

/** The second line of the row after the age, or null when the state has no words (the row keeps its old line). */
export function owedSecondLine(state: OwedState | null): string | null {
  switch (state) {
    case 'drafting':
    case 'stale_draft':
      return OWED_SECOND_LINE.drafting;
    case 'draft_ready':
      return OWED_SECOND_LINE.draft_ready;
    case 'his_draft':
    case 'his_draft_older':
      return OWED_SECOND_LINE.his_draft;
    case 'needs_thought':
      return OWED_SECOND_LINE.needs_thought;
    default:
      return null;
  }
}

/** "If you do nothing". "Within the hour" appears only when a drafter run finished in the last 2 hours. */
export function ifIgnoredLine(state: OwedState | null, drafterFreshAt: Date | null | undefined, now: Date): string {
  const fresh = drafterFresh(drafterFreshAt, now);
  switch (state) {
    case 'draft_ready':
      return IF_IGNORED.draft_ready;
    case 'needs_thought':
      return IF_IGNORED.needs_thought;
    case 'his_draft':
    case 'his_draft_older':
      return IF_IGNORED.his_draft;
    case 'stale_draft':
      return fresh ? IF_IGNORED.update_fresh : IF_IGNORED.draft_ready;
    case 'drafting':
    default:
      return fresh ? IF_IGNORED.no_draft_fresh : IF_IGNORED.stays_here;
  }
}
