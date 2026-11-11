/**
 * Slice 4a: which owed threads Bast drafts this run, in order. Pure.
 *
 * Qualifies: threadStatus is 'show' (leads at any age within 21 days; known person, one business day, last-message
 * check for the rest), no crisis ask on the thread, not dismissed, no draft of his own on it, its row is not
 * needs_thought unless a tap is waiting, fewer than 3 failed attempts in the last 24 hours, and nothing left to do
 * (a Bast draft that already covers the newest message, or one he edited, is skipped).
 *
 * Order: taps first (oldest tap first), then a Bast draft written for an older ask (a redraft), then leads, then
 * the oldest thread. At most `limit` entries.
 */

import type { RawThread } from '../types';
import { threadKey } from '../item-key';
import { threadStatus } from '../select';
import { OWED } from './copy';
import type { OwedRequestKind, OwedRow } from './state';

const DAY_MS = 86_400_000;

export interface OwedSel {
  /** Thread keys he dismissed. */
  dismissed?: ReadonlySet<string>;
  /** Thread keys with an open crisis (is_urgent) ask on them. */
  crisisKeys?: ReadonlySet<string>;
}

export type OwedReason = 'request' | 'redraft' | 'lead' | 'oldest';

export interface OwedQueueEntry {
  thread: RawThread;
  thread_key: string;
  row: OwedRow | null;
  reason: OwedReason;
  request: OwedRequestKind | null;
  lead: boolean;
}

function failedRecently(row: OwedRow | null, now: Date): boolean {
  if (!row || row.attempts < OWED.failCap) return false;
  return now.getTime() - row.updated_at.getTime() <= DAY_MS;
}

export function owedQueue(
  sel: OwedSel,
  threads: readonly RawThread[],
  owedRows: readonly OwedRow[],
  now: Date,
  limit: number = OWED.perRun,
): OwedQueueEntry[] {
  const rows = new Map(owedRows.map((r) => [r.thread_key, r]));
  const out: OwedQueueEntry[] = [];

  for (const thread of threads) {
    const newest = thread.asks[0];
    if (!newest) continue;
    const key = threadKey(thread.account, thread.thread_id);
    if (sel.dismissed?.has(key)) continue;
    if (sel.crisisKeys?.has(key) || thread.asks.some((a) => a.is_urgent)) continue;
    if (threadStatus(thread, now) !== 'show') continue;

    const row = rows.get(key) ?? null;
    if (failedRecently(row, now)) continue;

    const request = (row?.request_kind as OwedRequestKind | null | undefined) ?? null;
    const bast = !!row?.draft_id;
    // His own draft (not Bast's) means hands off.
    if (thread.asks.some((a) => !!a.draft_url) && !bast) continue;
    const lead = newest.intent === 'sales';

    let reason: OwedReason;
    if (request) {
      reason = 'request';
    } else if (row?.state === 'needs_thought') {
      continue;
    } else if (bast) {
      if (row?.mike_edited_at) continue;
      if (row?.draft_for_ask_id && row.draft_for_ask_id !== newest.id) reason = 'redraft';
      else continue;
    } else {
      reason = lead ? 'lead' : 'oldest';
    }
    out.push({ thread, thread_key: key, row, reason, request, lead });
  }

  const rank: Record<OwedReason, number> = { request: 0, redraft: 1, lead: 2, oldest: 3 };
  out.sort((a, b) => {
    if (rank[a.reason] !== rank[b.reason]) return rank[a.reason] - rank[b.reason];
    if (a.reason === 'request') {
      const d = (a.row?.requested_at?.getTime() ?? 0) - (b.row?.requested_at?.getTime() ?? 0);
      if (d !== 0) return d;
    }
    const d = a.thread.asks[0].received_at.getTime() - b.thread.asks[0].received_at.getTime();
    return d !== 0 ? d : a.thread_key.localeCompare(b.thread_key);
  });
  return out.slice(0, Math.max(0, limit));
}
