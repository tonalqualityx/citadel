/**
 * When a session asked its parked question (OracleSession.waiting_on_since), task 6799e4ca.
 *
 * A session's last_event_at moves whenever anything writes to its transcript, including housekeeping lines on a session that has sat
 * idle for weeks. Dating an ask by last_event_at made old, answered asks come back as new on Mike's waiting list. The ask is dated
 * by when it was set instead: the heartbeat sends the manifest's own timestamp, and the ingest route keeps the stored time while the
 * text stays the same. Pure: no database in here.
 */

import { sessionAskComparable } from '@/lib/home/session-clear';

export interface SessionAskTimes {
  waiting_on_since?: Date | null;
  last_event_at?: Date | null;
  updated_at?: Date | null;
  created_at?: Date | null;
}

/** When the ask was set. Falls back to the old activity times only for a session that has not reported one yet. */
export function sessionAskSince(s: SessionAskTimes): Date | null {
  return s.waiting_on_since ?? s.last_event_at ?? s.updated_at ?? s.created_at ?? null;
}

/**
 * The waiting_on_since to write on an ingest snapshot. `undefined` leaves the stored value as it is.
 * - The ask is cleared (null or blank): null.
 * - The heartbeat sent the time it was asked: that time, never later than now, and for the same text never later than the time
 *   already stored (an unchanged ask cannot get newer, so a manifest re-stamped by a goal update never re-dates it).
 * - The text changed and no time was sent: now (a new ask starts waiting now).
 * - The same text again with no time sent: untouched, so a repeat heartbeat never re-dates it.
 */
export function resolveWaitingOnSince(args: {
  existing_waiting_on: string | null | undefined;
  existing_since?: Date | null;
  incoming_waiting_on: string | null | undefined;
  incoming_since: Date | null | undefined;
  now: Date;
}): Date | null | undefined {
  const { existing_waiting_on, existing_since, incoming_waiting_on, incoming_since, now } = args;
  const same = !!sessionAskComparable(existing_waiting_on) && sessionAskComparable(incoming_waiting_on) === sessionAskComparable(existing_waiting_on);
  if (incoming_waiting_on === undefined) {
    if (incoming_since === undefined) return undefined;
    if (!sessionAskComparable(existing_waiting_on)) return undefined; // no ask stored: nothing to date
    return incoming_since === null ? undefined : keepEarlier(clampToNow(incoming_since, now), existing_since);
  }
  if (!sessionAskComparable(incoming_waiting_on)) return null;
  if (incoming_since) return same ? keepEarlier(clampToNow(incoming_since, now), existing_since) : clampToNow(incoming_since, now);
  if (same) return undefined;
  return now;
}

/** The earlier of the incoming time and the stored one; undefined (untouched) when the stored one is already earlier or equal. */
function keepEarlier(incoming: Date, existing: Date | null | undefined): Date | undefined {
  if (existing && existing.getTime() <= incoming.getTime()) return undefined;
  return incoming;
}

function clampToNow(d: Date, now: Date): Date {
  return d.getTime() > now.getTime() ? now : d;
}
