/**
 * The front session's comments (Mike, 2026-11-24, front session chat: "every time you attach a comment from me on a card I get a
 * slack notification. Would love for that to stop.").
 *
 * The front session records Mike's words on a card. That note is a record, not a message to staff, so a comment from the enforced
 * front-session lane notifies nobody (no mention, no assignee notice) and is always an internal note, the same as the triage desk.
 */
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { isFrontSessionCaller } from '@/lib/front-session/release';

type FrontAuth = Pick<AuthPayload, 'userId' | 'via' | 'lane' | 'laneEnforced'>;

/** Null for any other caller. For the front session: refuses a client-visible comment (403) and returns the forced internal flag. */
export function guardFrontSessionComment(
  auth: FrontAuth,
  data: { client_visible?: boolean; client_question?: boolean }
): { is_internal: true } | null {
  if (!isFrontSessionCaller(auth)) return null;
  if (data.client_visible || data.client_question) {
    throw new ApiError('The front session writes internal notes only; it never sends to a client.', 403, 'front_session_client_closed');
  }
  return { is_internal: true };
}
