/**
 * Slice 4c: one row per conversation across inboxes. Pure.
 *
 * The drafter finds threads that share an RFC Message-ID (mike@becomeindelible.com, mike@whoismikedion.com, bast@) and
 * POSTs them as `joins`; Citadel stores `joined_to_key` on the non-primary rows. At read time the groups are rebuilt
 * from those links (undirected), the primary is whichever thread's newest message is newest NOW, and the group renders
 * as that one thread whose asks are every open ask of the group (so "No reply needed" closes every joined thread).
 */

import { threadKey } from '../item-key';
import type { RawThread } from '../types';

export interface JoinRow {
  thread_key: string;
  joined_to_key?: string | null;
  replied_elsewhere_at?: Date | null;
  replied_elsewhere_from?: string | null;
}

export interface JoinResult {
  threads: RawThread[];
  /** Primary thread key -> the other keys in its group (including keys with no open ask now). */
  members: Map<string, string[]>;
}

export function mergeJoinedThreads(threads: readonly RawThread[], rows: readonly JoinRow[]): JoinResult {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as string;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const r of rows) if (r.joined_to_key && r.joined_to_key !== r.thread_key) union(r.thread_key, r.joined_to_key);

  const byKey = new Map(threads.map((t) => [threadKey(t.account, t.thread_id), t]));
  const allKeys = new Set<string>();
  for (const r of rows) {
    if (r.joined_to_key && r.joined_to_key !== r.thread_key) {
      allKeys.add(r.thread_key);
      allKeys.add(r.joined_to_key);
    }
  }
  const groupsOf = new Map<string, string[]>();
  for (const k of allKeys) {
    const root = find(k);
    const g = groupsOf.get(root) ?? [];
    g.push(k);
    groupsOf.set(root, g);
  }

  const members = new Map<string, string[]>();
  const out: RawThread[] = [];
  const done = new Set<string>();
  for (const t of threads) {
    const key = threadKey(t.account, t.thread_id);
    if (!allKeys.has(key)) {
      out.push(t);
      continue;
    }
    const root = find(key);
    if (done.has(root)) continue;
    done.add(root);
    const keys = groupsOf.get(root) ?? [key];
    const present = keys.map((k) => byKey.get(k)).filter((x): x is RawThread => !!x);
    let primary = present[0];
    for (const p of present) {
      const a = p.asks[0].received_at.getTime();
      const b = primary.asks[0].received_at.getTime();
      if (a > b || (a === b && threadKey(p.account, p.thread_id) < threadKey(primary.account, primary.thread_id))) primary = p;
    }
    const seen = new Set<string>();
    const asks = present
      .flatMap((p) => p.asks)
      .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
      .sort((x, y) => y.received_at.getTime() - x.received_at.getTime());
    const pk = threadKey(primary.account, primary.thread_id);
    out.push({ ...primary, asks });
    members.set(pk, keys.filter((k) => k !== pk).sort());
  }
  return { threads: out, members };
}

export interface RepliedElsewhere {
  at: Date;
  from: string;
}

/** Someone on our side answered in a joined thread after their newest message: the latest such mark, or null. */
export function repliedElsewhere(
  primaryKey: string,
  members: readonly string[],
  rowsByKey: ReadonlyMap<string, JoinRow>,
  newestAt: Date,
): RepliedElsewhere | null {
  let best: RepliedElsewhere | null = null;
  for (const k of [primaryKey, ...members]) {
    const r = rowsByKey.get(k);
    const at = r?.replied_elsewhere_at ?? null;
    if (!at || at.getTime() < newestAt.getTime()) continue;
    if (!best || at.getTime() > best.at.getTime()) best = { at, from: r?.replied_elsewhere_from ?? '' };
  }
  return best;
}
