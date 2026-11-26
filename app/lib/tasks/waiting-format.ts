/**
 * Waiting on someone (task 23cd54cf): the pure half, with no database import, so formatters and client code can use it.
 * The rest is in lib/tasks/waiting.ts.
 */
const CLOSED = ['done', 'abandoned'];

export interface WaitingFields {
  status?: string | null;
  waiting_on_name?: string | null;
  waiting_on_contact_id?: string | null;
  waiting_on_user_id?: string | null;
  waiting_since?: Date | null;
  waiting_follow_up_at?: Date | null;
  waiting_thread?: string | null;
  waiting_note?: string | null;
  waiting_follow_up_sent_at?: Date | null;
}

/** True while the card is off Mike's lists: marked, still open, and the follow-up time (if any) not yet reached. */
export function isActivelyWaiting(t: WaitingFields, now: Date = new Date()): boolean {
  if (!t.waiting_since) return false;
  if (t.status && CLOSED.includes(t.status)) return false;
  return !t.waiting_follow_up_at || t.waiting_follow_up_at.getTime() > now.getTime();
}

/** The `waiting_on` block on a task response; null when the card is not marked. */
export function formatWaiting(t: WaitingFields, now: Date = new Date()) {
  if (!t.waiting_since) return null;
  const followUp = t.waiting_follow_up_at ?? null;
  return {
    name: t.waiting_on_name ?? null,
    contact_id: t.waiting_on_contact_id ?? null,
    user_id: t.waiting_on_user_id ?? null,
    since: t.waiting_since,
    follow_up_at: followUp,
    thread: t.waiting_thread ?? null,
    note: t.waiting_note ?? null,
    follow_up_sent_at: t.waiting_follow_up_sent_at ?? null,
    active: isActivelyWaiting(t, now),
    follow_up_due: Boolean(followUp && followUp.getTime() <= now.getTime() && !(t.status && CLOSED.includes(t.status))),
  };
}
