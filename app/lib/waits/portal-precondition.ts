/**
 * The sweeper skip conditions for the portal clocks (portal phase B).
 *
 * portal_answered (portal.first_response): the client has an answer once a person has moved the
 * task: in_progress, review or done, or the task is staged for the client. `blocked` and
 * `abandoned` do NOT count: a dependency can block a task with nobody having looked at it, and a
 * dropped task is handled by the subject check (the wait expires), not by pretending the client
 * was answered.
 * A client-visible staff reply (Comment.client_visible, slice 2) is the other answer: pass
 * `has_staff_reply` and it closes the clock.
 *
 * portal_untouched (portal.emergency): fire only while nobody has taken it up. The task is still
 * not answered, and is unassigned or still sits with Bast, the filing default. Once a person is
 * assigned or the status moves, the clock stands down.
 */
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

const ANSWERING_STATUSES = ['in_progress', 'review', 'done'];

export function isPortalTaskAnswered(task: {
  status: string;
  staging_preview_url?: string | null;
  /** A client-visible reply from staff exists on the task. */
  has_staff_reply?: boolean;
}): boolean {
  if (task.has_staff_reply) return true;
  if (ANSWERING_STATUSES.includes(task.status)) return true;
  return typeof task.staging_preview_url === 'string' && task.staging_preview_url.length > 0;
}

export function isPortalTaskUntouched(task: {
  status: string;
  staging_preview_url?: string | null;
  assignee_id?: string | null;
  has_staff_reply?: boolean;
}): boolean {
  if (isPortalTaskAnswered(task)) return false;
  return !task.assignee_id || task.assignee_id === BAST_USER_ID;
}
