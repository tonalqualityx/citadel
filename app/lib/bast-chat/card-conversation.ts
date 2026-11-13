/**
 * Bast chat, one conversation per card (operating model S4).
 *
 * A conversation with a `task_id` is about that one Triage card. Two rules live here so the route, the tests and the
 * panel read one place:
 *
 *   1. "Release it" and "drop it" from inside a card conversation act on THAT card and no other. The chat's ops route
 *      refuses a triage action whose task ids are anything but the card's own, and refuses releasing a whole plan from
 *      here (a plan is released from the home screen's Triage row). The write itself still goes through the existing
 *      `home` op, `runHomeAct` and lib/tasks/triage.ts, so the status check, the 72-hour undo and the action row are
 *      the ones every release already has.
 *   2. The card's title and body travel to the machine with each message (`InboxCard`, inbox.ts), read at that moment,
 *      so a reopened conversation sees the card as it is now.
 */
import { ApiError } from '@/lib/api/errors';

export const CARD_ONLY_TEXT = 'This chat is about one card. Release or drop that card here; a whole plan is released from the Triage list.';

const CARD_ACTIONS = ['triage_release', 'triage_drop'] as const;

/** Throws a plain 409 when a triage action from a card conversation names anything but its own card. A general conversation passes. */
export function assertCardConversationOp(conversationTaskId: string | null | undefined, opName: string, rawInput: unknown): void {
  if (!conversationTaskId || opName !== 'home') return;
  const input = rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
  const action = input.action;
  if (action === 'triage_release_plan') throw new ApiError(CARD_ONLY_TEXT, 409, 'card_only');
  if (!(CARD_ACTIONS as readonly unknown[]).includes(action)) return;
  const ids = input.task_ids;
  const own = conversationTaskId.toLowerCase();
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string' || ids[0].toLowerCase() !== own) {
    throw new ApiError(CARD_ONLY_TEXT, 409, 'card_only');
  }
}
