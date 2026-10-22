/**
 * Whether a client may cancel a request, decided in one place (pure, so the page, the chat view
 * and the cancel route all agree).
 *
 *   allowed    clarifying, confirming, not started, in progress, or staged and waiting for the client
 *   going_live the client approved staged work and it is not live yet: the publish pass owns it
 *   live       done: the change is out, so the client asks for a change instead
 *   cancelled  status abandoned (by the client, or closed by staff): nothing more to offer
 */
import { CLIENT_CANCELLED_TAG, isApprovedGoingLive } from '@/lib/portal/status-labels';

export type CancelMode = 'allowed' | 'going_live' | 'live' | 'cancelled';

export interface CancelFields {
  status?: string | null;
  tags?: string[] | null;
  client_approved_at?: Date | string | null;
}

export function cancelMode(task: CancelFields): CancelMode {
  if (task.status === 'abandoned') return 'cancelled';
  if (isApprovedGoingLive(task)) return 'going_live';
  if (task.status === 'done' || task.client_approved_at) return 'live';
  return 'allowed';
}

/** True when work may already be under way, so a person has to be told to stop. */
export function workMayBeUnderWay(status: string | null | undefined): boolean {
  return status === 'in_progress' || status === 'blocked' || status === 'review';
}

export const wasCancelledByClient = (task: { tags?: string[] | null }): boolean => (task.tags ?? []).includes(CLIENT_CANCELLED_TAG);
