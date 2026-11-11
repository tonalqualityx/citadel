/**
 * Home screen Slice 1: which buttons each item gets (plan 1.4, task H4).
 *
 * Rules:
 * - At most CAPS.visibleActions (3) visible buttons; the rest go under More.
 * - "Not now" on every row that is not an emergency and not pinned; from the third Not now
 *   (park_count at NOT_NOW.choicesOnlyAtParkCount) it is withdrawn, and a task gets
 *   "Let it go" in its place. Other kinds have no Let it go in Slice 1; their real choices stay.
 * - "Not an emergency" on every emergency.
 * - "This matters more" and "Add to today's arc" under More (never on an emergency's
 *   "matters more"; never on a pinned row).
 * - Only the first button of the top Next row is filled (filledFirst).
 * - A pinned item shows its own finishing buttons plus "Stop for now"; "I'll do it now" is gone.
 * - Slice 1 offers nothing that needs a later slice: no Send the draft, no Hand to Sabeen, no
 *   Book 30 minutes.
 */

import { ACTION_LABELS, approveAllLabel } from './copy';
import { CAPS, NOT_NOW } from './rules';
import type { OwedState } from './owed/state';
import type { HomeActionId, HomeItemAction, HomeSourceKind } from './types';

export interface ActionsInput {
  kind: HomeSourceKind;
  /** Meets an emergency rule and is not marked "Not an emergency". */
  emergency: boolean;
  /** The one pinned item ("things in progress"). */
  pinned: boolean;
  /** home_item_state.park_count, 0 when there is no state. */
  parkCount: number;
  /** Fill the first visible button (the top row of Next). */
  filledFirst: boolean;
  /** Review fold: how many pieces "Approve all" approves. */
  pieceCount?: number;
  /** Session ask: the session's remote_url. */
  sessionUrl?: string | null;
  /** Thread or crisis mail: the Mike draft (draft_url), the thread (deep_link). */
  draftUrl?: string | null;
  threadUrl?: string | null;
  /** Wait: price-review wait (Open only), whether it can be approved (has an approval request), a link, a task for the drawer. */
  waitPriceReview?: boolean;
  waitApprovable?: boolean;
  waitHref?: string | null;
  hasTaskId?: boolean;
  /** Slice 3: a task Bast stopped on. Open only (no Done, no I'll do it now, no Let it go, no arc), plus Not now and This matters more. */
  botTask?: boolean;
  /**
   * Slice 4a: a thread the drafter works (status show). state is where Bast's reply work stands, suggestion is true when
   * a needs-thought row holds a suggested answer. Absent = the Slice 1 buttons.
   */
  owedThread?: { state: OwedState | null; suggestion: boolean };
}

export interface ActionsOutput {
  actions: HomeItemAction[];
  more_actions: HomeItemAction[];
}

function button(id: HomeActionId, href: string | null = null, label?: string): HomeItemAction {
  return { id, label: label ?? ACTION_LABELS[id], filled: false, href };
}

/** The item's own buttons, in order, and the extras that go under More. */
function own(input: ActionsInput): { primary: HomeItemAction[]; extras: HomeItemAction[] } {
  const primary: HomeItemAction[] = [];
  const extras: HomeItemAction[] = [];
  switch (input.kind) {
    case 'task':
      if (input.botTask) {
        primary.push(button('open_task'));
        break;
      }
      if (!input.pinned) primary.push(button('do_now'));
      primary.push(button('done'));
      extras.push(button('open_task'));
      break;
    case 'review':
      primary.push(button('approve_all', null, approveAllLabel(input.pieceCount ?? 0)));
      break;
    case 'session':
      if (input.sessionUrl) primary.push(button('open_session', input.sessionUrl));
      break;
    case 'wait':
      if (input.waitPriceReview) {
        if (input.waitHref || input.hasTaskId) primary.push(button('open_wait', input.waitHref ?? null));
      } else {
        primary.push(input.waitApprovable ? button('approve_wait') : button('complete_wait'));
        if (input.hasTaskId) extras.push(button('open_task'));
      }
      break;
    case 'thread':
      if (input.owedThread && !input.owedThread.state?.startsWith('his_draft')) {
        const { state, suggestion } = input.owedThread;
        if (state === 'draft_ready' || state === 'stale_draft') {
          // Bast's draft is in his Gmail: open it, or ask for Bast's read instead.
          if (input.draftUrl) primary.push(button('open_draft', input.draftUrl));
          else if (input.threadUrl) primary.push(button('open_thread', input.threadUrl));
          primary.push(button('needs_thought'));
          extras.push(button('no_reply_needed'));
        } else if (state === 'needs_thought') {
          if (suggestion) primary.push(button('go_with_that'));
          if (input.threadUrl) primary.push(button('open_thread', input.threadUrl));
          extras.push(button('draft_now'), button('no_reply_needed'));
        } else {
          // No draft yet (or one was asked for): the first button asks for it, unless the ask is already waiting.
          if (state !== 'drafting') primary.push(button('draft_now'));
          if (input.threadUrl) primary.push(button('open_thread', input.threadUrl));
          extras.push(button('no_reply_needed'));
        }
        break;
      }
      if (input.draftUrl) {
        primary.push(button('open_draft', input.draftUrl));
        if (input.threadUrl) extras.push(button('open_thread', input.threadUrl));
      } else if (input.threadUrl) {
        primary.push(button('open_thread', input.threadUrl));
      }
      primary.push(button('no_reply_needed'));
      break;
    case 'crisis':
      primary.push(button('handled'));
      if (input.threadUrl) primary.push(button('open_thread', input.threadUrl));
      break;
  }
  return { primary, extras };
}

export function actionsFor(input: ActionsInput): ActionsOutput {
  const { primary, extras } = own(input);
  const visible: HomeItemAction[] = [...primary];
  const more: HomeItemAction[] = [...extras];

  if (input.pinned) {
    visible.push(button('stop'));
  } else if (input.emergency) {
    visible.push(button('not_emergency'));
  } else if (input.parkCount >= NOT_NOW.choicesOnlyAtParkCount) {
    if (input.kind === 'task' && !input.botTask) visible.push(button('let_it_go'));
  } else {
    visible.push(button('not_now'));
  }

  if (!input.emergency && !input.pinned) more.push(button('matters_more'));
  if (!input.pinned && !input.botTask) more.push(button('add_to_arc'));

  // Over the cap: the overflow goes under More, keeping order.
  while (visible.length > CAPS.visibleActions) more.unshift(visible.pop() as HomeItemAction);

  if (input.filledFirst && visible.length > 0) visible[0] = { ...visible[0], filled: true };
  return { actions: visible, more_actions: more };
}

/** Today's steps carry "Remove from arc" under More in place of "Add to today's arc". */
export function asArcStepActions(more: HomeItemAction[]): HomeItemAction[] {
  const without = more.filter((a) => a.id !== 'add_to_arc' && a.id !== 'remove_from_arc');
  return [...without, button('remove_from_arc')];
}

/** The same list for an item that is already a step elsewhere on the screen: no second add offered. */
export function withoutAddToArc(more: HomeItemAction[]): HomeItemAction[] {
  return more.filter((a) => a.id !== 'add_to_arc');
}
