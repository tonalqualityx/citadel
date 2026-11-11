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
import { autoDraftDue, isLeadNow, owedClock, wokeByNewMessage } from './clock';
import { repliedElsewhere, type JoinRow } from './join';
import type { OwedRequestKind, OwedRow, OwedWorkRequest } from './state';

const DAY_MS = 86_400_000;

export interface OwedSel {
  /** Thread keys he dismissed. */
  dismissed?: ReadonlySet<string>;
  /** Thread keys with an open crisis (is_urgent) ask on them. */
  crisisKeys?: ReadonlySet<string>;
  /** Slice 4c: joined groups, primary key -> the other keys. A thread passed in is already the merged one. */
  members?: ReadonlyMap<string, readonly string[]>;
  /** Slice 4c: his item states by key, so a thread whose Not now ended because they wrote again is not held back as young. */
  states?: ReadonlyMap<string, { view_at: Date | null; view_set_by: string | null; parked_at?: Date | null }>;
}

/** Slice 4c: what the caller's drafter said it can serve (the GET's ?caps=short,auto,joins). None = the 4a shape. */
export interface OwedCaps {
  short: boolean;
  auto: boolean;
}

export type OwedReason = 'request' | 'redraft' | 'clock' | 'lead' | 'oldest' | 'auto' | 'short';

export interface OwedQueueEntry {
  thread: RawThread;
  thread_key: string;
  row: OwedRow | null;
  reason: OwedReason;
  request: OwedWorkRequest | null;
  lead: boolean;
  /** The other thread keys joined to this one. */
  joined: string[];
}

function failedRecently(row: OwedRow | null, now: Date): boolean {
  if (!row || row.attempts < OWED.failCap) return false;
  return now.getTime() - row.updated_at.getTime() <= DAY_MS;
}

/**
 * Whether a short holding draft is wanted on this thread now: a full draft of Bast's covers the newest message, he has not
 * edited it, and either a client reply reached its fifth business day as Needs thought with no short draft yet, or a lead
 * came back at its repeat time and has no short draft written since.
 */
function shortWanted(row: OwedRow | null, newestId: string, lead: boolean, clock: ReturnType<typeof owedClock>): boolean {
  if (!row || !row.draft_id || !row.draft_text || row.mike_edited_at) return false;
  if (row.draft_for_ask_id !== newestId) return false;
  if (lead) {
    const at = clock.lead?.resurfaceAt ?? null;
    if (!at) return false;
    return !row.resurfaced_at || row.resurfaced_at.getTime() < at.getTime();
  }
  return row.state === 'needs_thought' && clock.thoughtDue && !row.short_draft_id;
}

export function owedQueue(
  sel: OwedSel,
  threads: readonly RawThread[],
  owedRows: readonly OwedRow[],
  now: Date,
  limit: number = OWED.perRun,
  caps: OwedCaps = { short: false, auto: false },
): OwedQueueEntry[] {
  const rows = new Map(owedRows.map((r) => [r.thread_key, r]));
  const out: OwedQueueEntry[] = [];

  for (const thread of threads) {
    const newest = thread.asks[0];
    if (!newest) continue;
    const key = threadKey(thread.account, thread.thread_id);
    if (sel.dismissed?.has(key)) continue;
    if (sel.crisisKeys?.has(key) || thread.asks.some((a) => a.is_urgent)) continue;

    const row = rows.get(key) ?? null;
    const lead = isLeadNow(newest.intent, newest.received_at, row);
    if (threadStatus(thread, now, { notLead: newest.intent === 'sales' && !lead, woke: wokeByNewMessage(sel.states?.get(key), newest.received_at, now) }) !== 'show') continue;
    const joined = [...(sel.members?.get(key) ?? [])];
    // Someone on our side already answered (in this thread or a joined one): nothing to draft.
    if (repliedElsewhere(key, joined, rows as ReadonlyMap<string, JoinRow>, newest.received_at)) continue;
    if (failedRecently(row, now)) continue;

    const request = (row?.request_kind as OwedRequestKind | null | undefined) ?? null;
    const bast = !!row?.draft_id;
    // His own draft (not Bast's) means hands off.
    if (thread.asks.some((a) => !!a.draft_url) && !bast) continue;
    const clock = owedClock(newest.received_at, lead, row, now);

    let reason: OwedReason;
    let asked: OwedWorkRequest | null = request;
    if (request) {
      reason = 'request';
    } else if (row?.state === 'needs_thought') {
      if (row.mike_edited_at) continue;
      const autoOk =
        caps.auto &&
        !!row.suggested_answer &&
        !row.needs_commitment &&
        !row.auto_drafted_at &&
        !!row.thought_since &&
        row.thought_since.getTime() >= newest.received_at.getTime() &&
        autoDraftDue(row.thought_since, now);
      if (autoOk) {
        reason = 'auto';
        asked = 'auto';
      } else if (caps.short && shortWanted(row, newest.id, lead, clock)) {
        reason = 'short';
        asked = 'short';
      } else {
        continue;
      }
    } else if (bast) {
      if (row?.mike_edited_at) continue;
      if (row?.draft_for_ask_id && row.draft_for_ask_id !== newest.id) {
        reason = 'redraft';
      } else if (!lead && clock.thoughtDue && !row?.auto_drafted_at && (!row?.thought_since || row.thought_since.getTime() <= newest.received_at.getTime())) {
        // Day 5 with Bast's draft still unsent: Bast writes its read, and the row becomes Needs thought.
        reason = 'clock';
        asked = 'read';
      } else if (lead && clock.lead?.past && row?.drafted_at && row.drafted_at.getTime() < clock.lead.due.getTime()) {
        // The lead's clock ran out: Bast refreshes its draft (the 4a update rule).
        reason = 'clock';
        asked = 'draft';
      } else if (caps.short && shortWanted(row, newest.id, lead, clock)) {
        reason = 'short';
        asked = 'short';
      } else {
        continue;
      }
    } else {
      reason = lead ? 'lead' : 'oldest';
    }
    out.push({ thread, thread_key: key, row, reason, request: asked, lead, joined });
  }

  const rank: Record<OwedReason, number> = { request: 0, redraft: 1, clock: 2, lead: 3, oldest: 4, auto: 5, short: 6 };
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
