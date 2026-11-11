/**
 * Home Slice 4b: every string Mike reads about "Send the draft". Pure. Plain words, no dash, none of the three banned words
 * (copy-guard covers lib/home). Kept apart from send.ts so the selector can use it without pulling in the outbox.
 */

/** The home_actions.action of the press. Equal to OWED_SEND_ACTION in lib/sends/owed-reply.ts (a test holds them together). */
export const SEND_ACTION = 'send_draft';

export const SEND_COPY = {
  off: 'Sending from here is not turned on.',
  notCurrent: 'That draft is not the current one. Reload the screen and look again.',
  alreadyQueued: 'That reply is already on its way.',
  noThread: 'That thread is not open any more.',
  blank: 'The draft still has a blank to fill in. Open it in Gmail and finish it first.',
  tooLate: "It's on its way and can't be undone.",
  chatUndo: 'Undo that on the home screen.',
} as const;

const SEND_REASONS: Record<string, string> = {
  already_replied: 'the thread already has a reply',
  expired: 'it waited too long',
  send_off: 'sending is turned off',
  no_press: 'it was not sent from your press',
  draft_blank: 'the draft still has a blank to fill in',
  draft_missing: 'the draft is not in Gmail any more',
  draft_other_thread: 'the draft is in a different thread',
};

/** The plain reason for a row that did not go, from its superseded_reason or last_error. */
export function sendFailureReason(reason: string | null | undefined): string {
  const r = (reason ?? '').toLowerCase();
  if (!r) return 'it could not be sent';
  if (SEND_REASONS[r]) return SEND_REASONS[r];
  if (r.includes('blank')) return SEND_REASONS.draft_blank;
  if (r.includes('not found') || r.includes('missing')) return SEND_REASONS.draft_missing;
  if (r.includes('other thread') || r.includes('different thread')) return SEND_REASONS.draft_other_thread;
  return 'it could not be sent';
}

export function clockTime(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(at);
  }
}

export const sendingLine = (who: string, at: Date, timezone: string): string => `Sending your reply to ${who} at ${clockTime(at, timezone)}.`;
export const sentLine = (who: string): string => `Sent your reply to ${who}. It can't be undone.`;
export const notSentLine = (reason: string): string => `Not sent: ${reason}. The draft is still in your Gmail.`;

