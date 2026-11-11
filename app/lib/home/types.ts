/**
 * Home screen Slice 1: the shared contract (plan task H3). Every later builder codes against
 * this file; read it with your own task in the plan and you have what you need.
 *
 * Who fills what:
 * - H5 load.ts fills the Raw* loader inputs (section C) from Prisma. state.ts fills
 *   RawItemState and RawHomeDay.
 * - H4 select.ts, today.ts, copy.ts and actions-for.ts turn raw inputs into HomeItem,
 *   HomeToday, HomeSections and HomeEverythingElse (section A). copy.ts writes every
 *   reader-facing string; actions-for.ts writes every HomeItemAction.
 * - H6 GET /api/home assembles HomeResponse and sends it with Cache-Control: no-store.
 * - H7 POST /api/home/act takes HomeActRequest and answers HomeActResponse or
 *   HomeActErrorBody; POST /api/home/undo takes HomeUndoRequest (section B).
 * - H9a hooks fetch HomeResponse and post the requests. H9b and H9c render it through the
 *   component props in section D.
 *
 * Hard law for everything in sections A and B (what the browser sees): no score, class,
 * quadrant, priority number or emergency rule, ever. Importance, urgency and consequence
 * class stay inside score.ts and select.ts. Ranking shows only as order and as the
 * one-line reason in `why_now` / `reason`. rules.test.ts scans this file's property names
 * for those words.
 *
 * Conventions: payload field names are snake_case (the API's style); component props are
 * camelCase (React's style). Every timestamp in the payload is an ISO 8601 string; every
 * date in a Raw* type is a Date. Strings are never null where an empty string is meant;
 * fields that may be absent say "or null".
 */

import type {
  AskQueue,
  AskSeverity,
  BatteryImpact,
  ClientStatus,
  EmailAskIntent,
  EmailAskState,
  MysteryFactor,
  OracleSessionStatus,
  ProjectStatus,
  TaskStatus,
  WaitKind,
  WaitState,
} from '@prisma/client';

// ============================================================================
// A. GET /api/home response (what the browser receives)
// ============================================================================

/** The record kind behind an item; the prefix of its item key (see item-key.ts). */
export type HomeSourceKind = 'task' | 'review' | 'session' | 'wait' | 'thread' | 'crisis';

/**
 * How a row reads, set by select.ts (H4). One value per item.
 * - emergency: meets an emergency rule (plan 1.3) and Mike has not marked it "Not an
 *   emergency". Any source kind can be one (a task, a wait, a session ask, crisis mail).
 * - lead: a qualifying thread whose newest open ask has intent sales.
 * - owed_reply: any other qualifying thread (a client email waiting).
 * - sign_off: a review fold, one per project.
 * - session_ask: an agent session waiting on Mike.
 * - wait: a wait owned by Mike that is in view.
 * - task: Mike's own task (design 2.5, "do it yourself").
 * Clients use it for small presentation choices only (for example the gold rule on
 * emergencies). Section membership comes from HomeSections, never from this field.
 */
export type HomeItemType = 'emergency' | 'lead' | 'owed_reply' | 'sign_off' | 'session_ask' | 'wait' | 'task';

/**
 * Every button id a row or card can carry. actions-for.ts (H4) decides which an item gets
 * (plan 1.4); useHomeItemAction (H9a) runs them.
 *
 * Existing-endpoint actions (H9a calls the existing hook, then posts `record`):
 * - done: task. PATCH /api/tasks/{source.id} {status:'done'}. Undo: PATCH back to
 *   source.task_status. When the item is pinned, H9a also posts `done_pin`.
 * - do_now: "I'll do it now". Posts home `pin` first; only after the pin succeeds, and only
 *   for a task, PATCH {status:'in_progress'}. A 409 pin_conflict leaves the task untouched.
 * - open_task: opens the task peek drawer (TaskPeekProvider) on opened.task_id.
 * - let_it_go: task, third Not now. PATCH {status:'abandoned'}. No undo in Slice 1.
 * - approve_all: review fold. PATCH /api/tasks/{id} {approved:true} for each of
 *   source.ids, in sequence. No undo in Slice 1.
 * - open_session: session ask. Opens action.href (the session's remote_url) in a new tab.
 * - approve_wait / complete_wait: PATCH /api/waits/{source.id} {action:'resolve',
 *   resolution:'approved' | 'completed'}. No undo in Slice 1.
 * - open_wait: a price-review wait (approval needs approved_terms), "Open" only. Follows
 *   action.href; when href is null, opens the peek drawer on opened.task_id.
 * - open_draft / open_thread: thread. Opens action.href (draft_url / deep_link) in a new tab.
 * - no_reply_needed: thread. PATCH /api/email-asks/{id} {state:'dismissed'} for each of
 *   source.ids. Undo: PATCH each back to {state:'open'}.
 * - handled: crisis mail. PATCH /api/email-asks/{source.id} {state:'handled'}. Undo: back
 *   to {state:'open'}.
 *
 * Home-only actions (H9a posts HomeActRequest; undo through /api/home/undo):
 * - not_now -> {action:'not_now'}; matters_more -> {action:'matters_more'};
 *   not_emergency -> {action:'not_emergency'}; stop -> {action:'stop', note} (asks
 *   "Where did you leave it?" first); add_to_arc -> {action:'arc_add', origin:'in_view'};
 *   remove_from_arc -> {action:'arc_remove'}.
 */
export type HomeActionId =
  | 'done'
  | 'do_now'
  | 'open_task'
  | 'let_it_go'
  | 'approve_all'
  | 'open_session'
  | 'approve_wait'
  | 'complete_wait'
  | 'open_wait'
  | 'open_draft'
  | 'open_thread'
  | 'no_reply_needed'
  | 'handled'
  | 'not_now'
  | 'matters_more'
  | 'not_emergency'
  | 'stop'
  | 'add_to_arc'
  | 'remove_from_arc';

/** The HomeActionId values that call an existing Citadel endpoint and are logged with `record`. */
export type HomeRecordedActionId = Extract<
  HomeActionId,
  | 'done'
  | 'do_now'
  | 'open_task'
  | 'let_it_go'
  | 'approve_all'
  | 'open_session'
  | 'approve_wait'
  | 'complete_wait'
  | 'open_wait'
  | 'open_draft'
  | 'open_thread'
  | 'no_reply_needed'
  | 'handled'
>;

/** One button. Filled by actions-for.ts (H4); labels come from copy.ts. */
export interface HomeItemAction {
  id: HomeActionId;
  /** The button text, for example "I'll do it now", "Approve all 39", "Open the draft". */
  label: string;
  /**
   * True only for the first button of the top row in Next (plan 1.3: "Only the top row's
   * first button is filled"). Every other button is plain.
   */
  filled: boolean;
  /**
   * Where the button goes, or null when it does not navigate. A value starting with "/" is
   * an in-app path (same tab); any other value is an outside URL and opens in a new tab.
   * Set for open_session, open_draft, open_thread and (when there is one) open_wait.
   */
  href: string | null;
}

/** A named link. `href` follows the same rule as HomeItemAction.href. */
export interface HomeLink {
  label: string;
  href: string;
}

/** A client or project an item belongs to. */
export interface HomeRef {
  id: string;
  name: string;
}

/** One "Done when" deliverable (from Task.requirements, or composed for a fold). */
export interface HomeDoneWhen {
  text: string;
  /** The requirement's own completed flag. Display only; the card does not write it. */
  done: boolean;
}

/** The cold-open card (design 2B), shown by ItemCard. Filled by select.ts with copy.ts. */
export interface HomeItemCard {
  /** One to three sentences, at most about 60 words (plain-text.ts cardSummary for tasks). Never null; '' only when nothing is known. */
  summary: string;
  /**
   * One entry per deliverable. H4 sends [] when there are fewer than 2 (design 2B: one
   * deliverable means no checklist); ItemCard also renders it only at 2 or more.
   */
  done_when: HomeDoneWhen[];
  /** The SOP (Task.sop_id, as /sops/{id}) or runbook link, or null. */
  how: HomeLink | null;
  /** Every asset and piece of context as a named link: the task, the thread, the preview, the project. May be []. */
  links: HomeLink[];
  /** The task the "Original notes" link opens in the peek drawer, or null for non-task items. */
  task_id: string | null;
  /** Mike's own "Where did you leave it?" note (home_item_state.left_off_note), or null. */
  left_off_note: string | null;
}

/** The record behind an item, for the existing-endpoint calls in HomeActionId. */
export interface HomeItemSource {
  kind: HomeSourceKind;
  /**
   * The id an existing endpoint takes:
   * task: Task.id. review: the project id, or 'none' for review pieces with no project.
   * session: OracleSession.id (the row uuid; the item key carries external_id).
   * wait: Wait.id. thread: the newest open EmailAsk.id on the thread. crisis: EmailAsk.id.
   */
  id: string;
  /**
   * Every id an action fans out to. review: each piece's Task.id (approve_all).
   * thread: every open EmailAsk.id on the thread (no_reply_needed). Every other kind: [id].
   */
  ids: string[];
  /** For a task, its current status (the value Done's undo restores); null for every other kind. */
  task_status: TaskStatus | null;
}

/**
 * One row and its card. Built by select.ts (H4). The same item may appear in a section and
 * in today.quick or today.steps; it is the same object shape in both places.
 */
export interface HomeItem {
  /** Stable item key (item-key.ts), for example "task:<uuid>". Unique within a response. */
  key: string;
  type: HomeItemType;
  /** The bold one-line statement, starting with the verb where it can. Never empty. */
  title: string;
  /** Who it is for or from ("Gene Roberts", "Jessica Everlith, North Star Health"), or null. */
  who: string | null;
  /** Elapsed time in words ("10 days", "filed today"). Never a date, never ''. */
  age: string;
  /** The one-line reason it is here now, shown under the title and on the card. */
  why_now: string;
  /**
   * The filled hard-date chip, "Due Friday, November 14 (Gene Roberts)", or null. Only a
   * hard date (plan 1.3) ever produces one; every other date is not shown.
   */
  hard_date: string | null;
  /** Effort in plain words: "About 10 minutes", "Draft ready, about 2 minutes". */
  effort: string;
  /** The minutes behind `effort` (plan 1.3 Today rule). Used for the day's size; never shown as a number. */
  minutes: number;
  /** Visible buttons, at most 3, in order. */
  actions: HomeItemAction[];
  /** The rest, under "More". May be []. */
  more_actions: HomeItemAction[];
  /**
   * "If you do nothing": what really happens in Slice 1, for example "Stays here. Nothing
   * happens on its own." Never promises a later slice's behavior.
   */
  default_if_ignored: string;
  /** "Why it's here": the one-line reason for its place, in the card's muted footer. */
  reason: string;
  /** True when this is the pinned item (sections.working_on). */
  pinned: boolean;
  opened: HomeItemCard;
  source: HomeItemSource;
  /** The client it belongs to, or null. */
  client: HomeRef | null;
  /** The project it belongs to, or null. A row shows the name as a link to ProjectDrawer. */
  project: HomeRef | null;
}

/** A Swap or Lighter choice: another group Today could be. */
export interface HomeArcChoice {
  /** Group key (item-key.ts): "arc:<uuid>", "client:<uuid>", "project:<uuid>" or "own". Send it back as to_group_key. */
  group_key: string;
  /** Arc, client or project name, or "Indelible" for own work. */
  name: string;
  /** Its one-line reason: why it ranks where it does. */
  why: string;
  /** Total minutes of its proposed steps. */
  minutes: number;
  /** `minutes` in words, "About 35 minutes". */
  effort: string;
}

/**
 * Today (design 2C, plan 1.3). Built by today.ts (H4) from home_day; stable for the zoned
 * day and changed only by swap, lighter and Mike's arc edits, plus a new emergency placed
 * at the top of `quick` on a later load.
 */
export interface HomeToday {
  /** The day's group (home_day.group_key). Send it back as group_key on arc edits. */
  group_key: string;
  /** The open Arc's id when the group is an arc, else null. */
  arc_id: string | null;
  /** The group's name: the arc name, client name, project name, or "Indelible". */
  arc_name: string;
  /** The client of the group (the arc's client, or the client group itself), or null. AddToArcSearch ranks this client first. */
  client: HomeRef | null;
  /** The project of the group, or null. */
  project: HomeRef | null;
  /** "Why this arc": one line, no trailing period required. */
  why: string;
  /**
   * Size of the day in words, for example "About 1 hour 50 minutes", or, when steps Mike
   * added overflow the free time, "About 3 hours 10 minutes, more than today has free".
   */
  size_line: string;
  /** Minutes of quick plus steps. */
  minutes_total: number;
  /** Free minutes today between 10:00 and 17:00 in his zone, less 30 after each timed meeting. */
  minutes_free: number;
  /** "Quick, before you start": at most 3, new emergencies first. */
  quick: HomeItem[];
  /**
   * The arc's open steps in Mike's order (home_day.step_item_keys), already cut to fit the
   * day. At most 4 proposed steps; steps Mike added are extra and never cut. A step he
   * added or created shows here while it is open even if select would not otherwise put it
   * in view.
   */
  steps: HomeItem[];
  /** Keys in `steps` that Mike added himself (home_item_state.arc_added_group = group_key). */
  added_keys: string[];
  /** The next two groups, best first. May be shorter or []. */
  swap: HomeArcChoice[];
  /** The lighter group, or null when none is lighter at the same or a higher consequence. */
  lighter: HomeArcChoice | null;
}

/** A quiet line in Handled for you. */
export interface HomeQuietLine {
  /** Stable id for React keys (the EmailAsk id for a classifier auto-close, the home_actions id for a keeper line). */
  id: string;
  /** One sentence. */
  text: string;
  /** At most one link (Slice 1: the thread's deep_link, new tab), or null. */
  href: string | null;
  /** When it was handled (ISO). Lines are newest first. */
  at: string;
  /**
   * Slice 2: the home_actions id to send to /api/home/undo for a keeper line (open for 72
   * hours), or null for a classifier auto-close, which has no undo.
   */
  undo_action_id: string | null;
  /** Slice 2: extra muted lines on the detail card (for a keeper line, the items it touched). [] when none. */
  details: string[];
}

/** The roll-up line after the visible quiet lines, for example "4 more handled". */
export interface HomeMoreLine {
  count: number;
  text: string;
}

/**
 * The lists behind the tiles, each already capped and in display order (plan 1.2). A tile's
 * count is the length of its list (Handled: plus handled_more.count).
 */
export interface HomeSections {
  /** Needs you now: every emergency, no cap. Client-facing first, then nearest hard date, then oldest. */
  needs_you_now: HomeItem[];
  /** Things in progress: the pinned item, 0 or 1. */
  working_on: HomeItem[];
  /** Sales leads waiting: thread items with intent sales. Never capped. */
  leads: HomeItem[];
  /** Client emails waiting: other qualifying threads, at most 3 visible, oldest first. */
  mail: HomeItem[];
  /** Decisions ready: at most 3 visible; the rest are counted in everything_else. */
  next: HomeItem[];
  /** Handled for you: classifier auto-closes in the last 24 hours, newest first, at most 5. */
  handled: HomeQuietLine[];
  /** "{n} more handled" when more than 5, else null. */
  handled_more: HomeMoreLine | null;
}

export type HomeRestGroupKey =
  | 'waiting_turn' // in view or queued but not shown above
  | 'parked' // Not now, until their view_at
  | 'scheduled' // Slice 2: given a day to come back by the nightly sort, until that day
  | 'held_projects' // tasks on quote, queue or suspended projects
  | 'review_pieces' // done tasks folded under a project sign-off
  | 'new_mail' // threads from a known person too young to show yet (not a business day old)
  | 'older_threads' // qualifying threads whose newest open ask is over 21 days old
  | 'ventures' // other ventures
  | 'bast_stopped'; // Slice 3: tasks Bast stopped on beyond the one that holds a Next slot

/** Slice 2: one row inside an Everything else group. Every row has an owner and a check text. */
export interface HomeRestItem {
  /** The item key (item-key.ts) when the row is one item, or null for a group row (for example a held project). */
  key: string | null;
  title: string;
  /** Who holds it, for example "You", "The Grok project", "The Grok sign-off". */
  owner: string;
  /** When or how it comes back, for example "Back Thursday, November 12". Never empty. */
  check_text: string;
  /** The day it comes back (ISO), or null when it has no set day. */
  check_at: string | null;
  /** True when check_at has passed and the item is still in Everything else. */
  past_check: boolean;
  /** True when "Bring it forward" works on this row (task, session, wait and thread rows; not crisis or group rows). */
  can_bring_forward: boolean;
}

export interface HomeEverythingElseGroup {
  key: HomeRestGroupKey;
  /** For example "Waiting their turn", "Parked by you". */
  label: string;
  count: number;
  /** Who holds them, for example "You", "Each project's sign-off". */
  owner: string;
  /** Slice 2: one row per item (or per project or fold where the group is counted that way). */
  items: HomeRestItem[];
}

/** Everything else (plan 1.2): one count sentence and the groups behind it. Groups with count 0 are left out. */
export interface HomeEverythingElse {
  /** Sum of the groups' counts. */
  count: number;
  /** One sentence, for example "52 other items are on your plate and counted here." */
  line: string;
  groups: HomeEverythingElseGroup[];
  /** Slice 2: how many of the items have a day to come back. */
  with_day: number;
  /** Slice 2: how many of those are past their day and still here. */
  past_day: number;
  /** Slice 2: "{S} tasks on unsigned or paused projects are kept as scope, not work.", or null when there are none. */
  scope_line: string | null;
}

/** The tiles, in the preview's order. */
export type HomeTileId =
  | 'today'
  | 'needs_you_now'
  | 'working_on'
  | 'leads'
  | 'mail'
  | 'next'
  | 'projects'
  | 'handled'
  | 'everything_else';

/** Tile order on screen (plan Slice 1: Today, need you now, things in progress, ...). */
export const HOME_TILE_ORDER: readonly HomeTileId[] = [
  'today',
  'needs_you_now',
  'working_on',
  'leads',
  'mail',
  'next',
  'projects',
  'handled',
  'everything_else',
];

/** GET /api/home, 200. */
export interface HomeResponse {
  /** When the server built this response (ISO). */
  generated_at: string;
  /** Today's date in his zone, YYYY-MM-DD (the home_day date). */
  date: string;
  /** His IANA zone from resolveUserTimezone, for example "America/New_York". */
  timezone: string;
  /** The date line, written out: "Monday, November 9". */
  screen_date_line: string;
  /** The signed-in user's id: assignee_id for create-and-add and the open-task search (H9c). */
  user_id: string;
  /** The day's proposal, or null when nothing is in view (then no home_day row is written). */
  today: HomeToday | null;
  sections: HomeSections;
  everything_else: HomeEverythingElse;
  /**
   * The empty sentence for every tile, from copy.ts, exactly as the design gives them
   * ("Nothing urgent.", "No active projects.", ...). '' where the design has none.
   */
  empty: Record<HomeTileId, string>;
}

// ============================================================================
// B. POST /api/home/act and /api/home/undo
// ============================================================================

/** The `action` values of HomeActRequest; also the home_actions.action column value. */
export type HomeActName =
  | 'bring_forward'
  | 'not_now'
  | 'matters_more'
  | 'not_emergency'
  | 'pin'
  | 'stop'
  | 'done_pin'
  | 'arc_add'
  | 'arc_remove'
  | 'arc_reorder'
  | 'swap'
  | 'lighter'
  | 'record';

/** How a step reached arc_add, kept in the home_actions row for the "where he acts" measure. */
export type HomeArcAddOrigin =
  | 'in_view' // "Add to today's arc" under More on a row, or picked from the payload's items
  | 'search' // one of his open tasks found through GET /api/tasks?search=
  | 'created'; // a new one-line task: the browser POSTed /api/tasks first, then sent its task key

/**
 * The body of POST /api/home/act. H7 validates it with a Zod schema typed as
 * z.ZodType<HomeActRequest>, item keys with itemKeySchema and group keys with
 * groupKeySchema (item-key.ts). Every home-only action writes only home_item_state,
 * home_day and home_actions for the caller, never a shared record.
 */
export type HomeActRequest =
  /**
   * Slice 2, Bring it forward: boosted_at = now, view_at = null, view_set_by = null. The item
   * goes to the front of Next. Undoable. Message "Moved to the front of Next."
   */
  | { action: 'bring_forward'; item_key: string }
  /**
   * Not now: park_count + 1. First: view_at = next business day 9:00 in his zone. Second:
   * view_at = now + 7 days. From park_count 3 (rules.ts NOT_NOW.choicesOnlyAtParkCount) the
   * item stays in view and actions-for gives it its real choices plus "Let it go".
   */
  | { action: 'not_now'; item_key: string }
  /** This matters more: boosted_at = now; the item goes to the top of its section at once. */
  | { action: 'matters_more'; item_key: string }
  /** Not an emergency: not_emergency_at = now; the item leaves Needs you now and ranks like any other. */
  | { action: 'not_emergency'; item_key: string }
  /**
   * I'll do it now: working_since = now. When another item is pinned and `switch` is not
   * true, answers 409 code 'pin_conflict' with the message "Switch to this one? The other
   * goes back to its place."; resend with switch: true to move the pin.
   */
  | { action: 'pin'; item_key: string; switch?: boolean }
  /** Stop for now: working_since = null and left_off_note = note (trimmed; null or '' clears it). At most LEFT_OFF_NOTE_MAX characters. */
  | { action: 'stop'; item_key: string; note: string | null }
  /** Done on the pinned item: working_since = null. Sent by H9a after the existing Done call. */
  | { action: 'done_pin'; item_key: string }
  /**
   * Add to today's arc, as the last step. Sets arc_added_at and arc_added_group =
   * group_key, clears any arc_removed mark for that group, appends to
   * home_day.step_item_keys. Any valid item key for one of his items is accepted, including
   * a task the browser just created (origin 'created'). 409 'stale_day' when group_key is
   * not today's group; 409 'already_in_arc' when the key is already a step.
   */
  | { action: 'arc_add'; item_key: string; group_key: string; origin: HomeArcAddOrigin }
  /**
   * Remove from arc. Removes the key from home_day.step_item_keys and sets arc_removed_at
   * and arc_removed_group = group_key (not proposed for that group for 7 days), clearing
   * any arc_added mark. The item goes back to its ranked place; nothing is closed. 409
   * 'stale_day' or 'not_in_arc'.
   */
  | { action: 'arc_remove'; item_key: string; group_key: string }
  /**
   * Reorder: step_keys is the full new order and must be exactly the same set as
   * home_day.step_item_keys (else 409 'stale_day'). At most ARC_STEP_KEYS_MAX keys.
   */
  | { action: 'arc_reorder'; group_key: string; step_keys: string[] }
  /** Swap arc: rewrite today's home_day to the chosen group (one of today.swap). Sets swapped_from_group. */
  | { action: 'swap'; to_group_key: string }
  /** Lighter today: rewrite today's home_day to today.lighter.group_key. Sets lighter_at. */
  | { action: 'lighter'; to_group_key: string }
  /**
   * Log an existing-endpoint action into home_actions (source 'home', no undo) so the
   * "where he acts" measure has data. `undo: true` logs the existing-endpoint undo instead.
   */
  | { action: 'record'; item_key: string; did: HomeRecordedActionId; undo?: boolean };

/** The arc and day requests TodayList, ArcEditor and AddToArcSearch send. */
export type HomeTodayActRequest = Extract<HomeActRequest, { action: 'arc_add' | 'arc_remove' | 'arc_reorder' | 'swap' | 'lighter' }>;

/** POST /api/home/act, 200. */
export interface HomeActResponse {
  ok: true;
  /** The home_actions row id; pass it to /api/home/undo. */
  action_id: string;
  /** Until when undo is open (ISO, now + 24 hours), or null for `record`. */
  undo_until: string | null;
  /** The item acted on, or null for swap, lighter and arc_reorder. */
  item_key: string | null;
  /** A short quiet line for the toast, for example "Back tomorrow at 9:00.", or null. */
  message: string | null;
}

/** Error `code` values the act and undo routes send (through ApiError and handleApiError). */
export type HomeActErrorCode =
  | 'pin_conflict' // 409: another item is pinned and switch was not true
  | 'stale_day' // 409: group_key or step_keys do not match today's home_day
  | 'already_in_arc' // 409: arc_add of a key that is already a step
  | 'not_in_arc' // 409: arc_remove of a key that is not a step
  | 'unknown_group' // 409: swap or lighter to a group that has no items in view
  | 'undo_expired' // 409: undo_until has passed
  | 'undo_used' // 409: undone_at is already set
  | 'not_undoable' // 409: a record row, or an action with no stored before-state
  | 'not_found'; // 404: no such home_actions row for this user

/** Error body (handleApiError's shape: { error, code }). 400 bodies carry Zod `details` instead of `code`. */
export interface HomeActErrorBody {
  /** Reader-facing message; for pin_conflict, exactly "Switch to this one? The other goes back to its place." */
  error: string;
  code?: HomeActErrorCode;
}

/** POST /api/home/undo body. */
export interface HomeUndoRequest {
  /** A HomeActResponse.action_id. */
  action_id: string;
}

/** POST /api/home/undo, 200. */
export interface HomeUndoResponse {
  ok: true;
  action_id: string;
  item_key: string | null;
}

// ============================================================================
// C. Loader inputs (server only; H5 load.ts and state.ts fill these, H4 reads them)
// ============================================================================
//
// Raw* types are plain data: Dates as Date, Decimals converted to number, no Prisma
// objects. They deliberately omit Task.priority and Task.is_focus (plan 1.3: never read),
// and Mike's own due_date reaches the browser only through rules.ts hardDateOf.

/** A client as the scoring rules need it (active client = status 'active'). */
export interface RawClientRef {
  id: string;
  name: string;
  status: ClientStatus;
}

export interface RawProjectRef {
  id: string;
  name: string;
  status: ProjectStatus;
}

/** An Arc as Today needs it. Open = closed_at null and (snoozed_until null or past). */
export interface RawArcRef {
  id: string;
  name: string;
  client_id: string | null;
  project_id: string | null;
  closed_at: Date | null;
  snoozed_until: Date | null;
}

/** One deliverable from Task.requirements (the Requirement shape in lib/hooks/use-tasks.ts). */
export interface RawRequirement {
  text: string;
  completed: boolean;
}

/**
 * An open task of U (plan 1.1): assignee_id = U, not deleted, status not done or abandoned,
 * project null or its status not in EXCLUDED_PROJECT_STATUSES.
 */
export interface RawTask {
  id: string;
  title: string;
  /** Task.description as stored (usually a BlockNote JSON string), or null. Read with plain-text.ts. */
  description: string | null;
  status: TaskStatus;
  /** Task.tags as stored. */
  tags: string[];
  /** Task.promised_to, or null. Non-null makes due_date a hard date. */
  promised_to: string | null;
  /** Slice 2: Task.hard_due_at, a real outside date filed with a source, or null. */
  hard_due_at: Date | null;
  /** Slice 2: Task.hard_due_source ("domain renews"), or null. */
  hard_due_source: string | null;
  /** Slice 2: Task.created_by_id, or null. With the from-chat tag it makes a task fresh (rules.ts isFreshNew). */
  created_by_id: string | null;
  /** Task.due_date, or null. Only rules.ts hardDateOf may turn it into anything shown. */
  due_date: Date | null;
  created_at: Date;
  /**
   * When the person-waiting clock started: created_at, moved forward to the newest comment
   * by a human (author not in BOT_USER_IDS), the same clock as /api/waiting-on-me.
   */
  clock_started_at: Date;
  /** Task.estimated_minutes (already includes the mystery and battery multipliers), or null. */
  estimated_minutes: number | null;
  energy_estimate: number | null;
  mystery_factor: MysteryFactor;
  battery_impact: BatteryImpact;
  client: RawClientRef | null;
  project: RawProjectRef | null;
  site_id: string | null;
  charter_id: string | null;
  accord_id: string | null;
  /** Task.billing_amount as a number, or null. */
  billing_amount: number | null;
  requested_by_contact_id: string | null;
  /** The requesting contact's name, or null. Used for `who`. */
  requested_by_name: string | null;
  client_visible: boolean;
  /** Open tasks (status not done or abandoned, not deleted) in this task's `blocking` list. */
  open_blocking_count: number;
  /** True when an open EmailAsk has task_id = this task. */
  has_open_email_ask: boolean;
  /** The task's arc, or null. */
  arc: RawArcRef | null;
  /** Task.requirements read as deliverables, in sort order. [] when none or unreadable. */
  requirements: RawRequirement[];
  /** The SOP, or null. */
  sop: { id: string; title: string } | null;
  /**
   * Slice 3: true for a task assigned to a bot (BOT_USER_IDS) and tagged needs-mike: Bast stopped on it and needs the home
   * owner. It is Bast's task: listed in Next, never a Today step, never given a day by the keeper, no date reading.
   */
  bot_task: boolean;
  /** Task.origin_url (an email deep link), or null. */
  origin_url: string | null;
  /** Task.staging_preview_url, or null. */
  staging_preview_url: string | null;
}

/** One done piece waiting for review inside a fold. */
export interface RawReviewPiece {
  id: string;
  title: string;
  completed_at: Date | null;
}

/**
 * One review sign-off: every task with status done, needs_review true, approved false,
 * reviewer_id U or null, grouped by project (plan 1.1).
 */
export interface RawReviewFold {
  /** The project, or null for pieces with no project (key review:none). */
  project: RawProjectRef | null;
  /** The project's client, or null. */
  client: RawClientRef | null;
  /** Every piece, oldest completed first. Never empty. */
  pieces: RawReviewPiece[];
  /** The person-waiting clock: the earliest piece completed_at (else its updated_at). */
  waiting_since: Date;
}

/** One session ask: OracleSession.waiting_on not null, archived_at null, status not ended or stale. */
export interface RawSessionAsk {
  /** OracleSession.id (row uuid). */
  id: string;
  /** OracleSession.external_id (the item key part). */
  external_id: string;
  /** Session title, or null. */
  title: string | null;
  /** The ask itself, free text. */
  waiting_on: string;
  ask_queue: AskQueue | null;
  ask_severity: AskSeverity | null;
  status: OracleSessionStatus;
  /** https://claude.ai/code/... deep link, or null (then no "Open the session" button). */
  remote_url: string | null;
  /** When the ask was raised, best available: last_event_at, else updated_at. */
  asked_at: Date;
  arc: RawArcRef | null;
  /** The arc's client, or null. */
  client: RawClientRef | null;
  /** The arc's project, or null. */
  project: RawProjectRef | null;
}

/**
 * One wait owned by U (owner resolved by loadWaitCandidates), state in OPEN_WAIT_STATES.
 * H5 passes every such wait; select.ts decides which are in view (needs_human, or due_at
 * has passed).
 */
export interface RawWait {
  id: string;
  kind: WaitKind;
  /** Wait.template_key; 'charter.price_review' gets "Open" only. */
  template_key: string;
  state: WaitState;
  title: string;
  detail: string | null;
  started_at: Date;
  due_at: Date;
  blocks_client: boolean;
  client_waiting_since: Date | null;
  client: RawClientRef | null;
  project: RawProjectRef | null;
  task_id: string | null;
  approval_request_id: string | null;
  charter_id: string | null;
  email_thread_id: string | null;
  email_account: string | null;
}

/** One EmailAsk as the home screen reads it. */
export interface RawEmailAsk {
  id: string;
  message_id: string;
  /** EmailAsk.thread_id; when null, the loader groups and keys the ask by message_id instead. */
  thread_id: string | null;
  account: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  gist: string | null;
  intent: EmailAskIntent | null;
  is_urgent: boolean;
  state: EmailAskState;
  client: RawClientRef | null;
  project: RawProjectRef | null;
  task_id: string | null;
  arc_id: string | null;
  /** A Mike draft on the thread (machine-set), or null. */
  draft_url: string | null;
  draft_started_at: Date | null;
  deep_link: string;
  received_at: Date;
}

/** Open, non-urgent asks grouped by (account, thread_id ?? message_id). */
export interface RawThread {
  account: string;
  /** The thread id used in the key: thread_id, or the lone ask's message_id when thread_id is null. */
  thread_id: string;
  /** Every open non-urgent ask on the thread, newest received_at first. Never empty. */
  asks: RawEmailAsk[];
}

/** Crisis mail: an open EmailAsk with is_urgent true. The noise check is rules.ts crisisEmergencyRule's. */
export type RawCrisis = RawEmailAsk;

/** A classifier auto-close: state handled, updated in the last 24 hours, training_note starting "[auto] ". */
export interface RawAutoHandled {
  /** EmailAsk.id. */
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  gist: string | null;
  client_name: string | null;
  deep_link: string;
  /** EmailAsk.updated_at. */
  handled_at: Date;
}

/** Today's CalendarEvent rows (all of them; select ignores all_day for free time). */
export interface RawCalendarEvent {
  id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
}

/** One home_item_state row for U, without user_id. */
export interface RawItemState {
  item_key: string;
  park_count: number;
  view_at: Date | null;
  boosted_at: Date | null;
  not_emergency_at: Date | null;
  working_since: Date | null;
  left_off_note: string | null;
  arc_added_at: Date | null;
  arc_added_group: string | null;
  arc_removed_at: Date | null;
  arc_removed_group: string | null;
  first_seen_at: Date;
  last_shown_at: Date | null;
  /** Slice 2: null or 'user' is his Not now; 'keeper' is the nightly sort. */
  view_set_by: string | null;
  /** Slice 2: after an Undo of a keeper action, the keeper leaves the item alone until this time. */
  keeper_hold_until: Date | null;
  /** Slice 2: the keeper's reading of an existing due_date, or null. */
  read_hard_due_at: Date | null;
  read_hard_due_source: string | null;
  /** Slice 2: set once the keeper has read this task's date. */
  dates_read_at: Date | null;
  /** Slice 2b: Bast's card summary, its checklist (JSON), the sha256 of the description it summarizes, and when. */
  card_summary: string | null;
  card_checklist: unknown;
  card_summary_hash: string | null;
  card_summary_at: Date | null;
}

/** Today's home_day row for U. */
export interface RawHomeDay {
  id: string;
  /** home_day.date as YYYY-MM-DD (state.ts converts the @db.Date both ways). */
  date: string;
  group_key: string;
  group_label: string;
  arc_id: string | null;
  quick_item_keys: string[];
  step_item_keys: string[];
  sized_minutes: number | null;
  proposed_at: Date;
  started_at: Date | null;
  swapped_from_group: string | null;
  lighter_at: Date | null;
}

/** Slice 2: tasks held on one unsigned or paused project, for the Everything else rows. */
export interface RawHeldProject {
  project: { id: string; name: string };
  /** U's open tasks on that project. */
  count: number;
}

/** Slice 2: one keeper home_actions row as Handled for you reads it (source keeper, last 72 hours, not undone). */
export interface RawKeeperLine {
  /** home_actions.id; it is the undo id. */
  id: string;
  /** home_actions.action. */
  action: KeeperActionKind;
  /** after.line, the sentence the keeper wrote. */
  text: string;
  /** after.details, the items it touched. [] when none. */
  details: string[];
  /** home_actions.created_at. */
  at: Date;
  /** home_actions.undo_until. */
  undo_until: Date;
}

/** Everything loadHomeInputs(prisma, userId, now) returns. */
export interface RawHomeInputs {
  user_id: string;
  now: Date;
  tasks: RawTask[];
  review_folds: RawReviewFold[];
  session_asks: RawSessionAsk[];
  waits: RawWait[];
  threads: RawThread[];
  crises: RawCrisis[];
  auto_handled: RawAutoHandled[];
  /** Today's events in his zone. */
  calendar_events: RawCalendarEvent[];
  /** U's open tasks on quote, queue or suspended projects (Everything else, "on paused or unsigned projects"). */
  held_project_task_count: number;
  /** Slice 2: the held tasks by project (the sum of their counts is held_project_task_count). */
  held_projects: RawHeldProject[];
  /** Slice 2: the keeper's own Handled lines, newest first. */
  keeper_lines: RawKeeperLine[];
}

// ============================================================================
// C2. The keeper (Slice 2; server only)
// ============================================================================

/** The home_actions.action values the keeper writes (source 'keeper'). 2b adds summaries, 2c the arc ones. */
export type KeeperActionKind =
  | 'keeper_stagger'
  | 'keeper_dates'
  | 'keeper_summaries'
  | 'keeper_arc_create'
  | 'keeper_arc_close'
  | 'keeper_arc_link';

/** One task given a day to come back. */
export interface KeeperStaggerChange {
  item_key: string;
  title: string;
  /** The day it comes back, YYYY-MM-DD in Eastern. */
  day: string;
  /** The view_at to write (00:05 Eastern that day), ISO. */
  view_at: string;
}

/** One task whose existing due_date the keeper read. */
export interface KeeperDateChange {
  item_key: string;
  title: string;
  /** 'read' shows as a chip; 'set_aside' is an invented default or a dead date. */
  outcome: 'read' | 'set_aside';
  due_date: string;
  /** True when the task belongs to a client (set-aside ones on client work are listed for Mike). */
  client_facing: boolean;
}

/** One line the keeper will write into Handled for you. */
export interface KeeperPlanLine {
  action: KeeperActionKind;
  text: string;
  details: string[];
}

/** What a keeper run would do (the GET dry run) or did. JSON only: dates are ISO strings. */
export interface KeeperPlan {
  owner_id: string;
  /** The run's date in Eastern, YYYY-MM-DD. */
  date: string;
  stagger: KeeperStaggerChange[];
  dates: KeeperDateChange[];
  lines: KeeperPlanLine[];
  counts: { stagger: number; dates_read: number; dates_set_aside: number };
}

/** What the keeper route answers. Exactly one of skipped, already_ran or plan is set. */
export interface KeeperResult {
  /** True for GET, and for a POST that was asked to write nothing. */
  dry_run: boolean;
  /** The owner is not an active admin on the home view; nothing was written. */
  skipped?: 'home_off';
  /** This user and date already have a finished nightly row; nothing was written. */
  already_ran?: true;
  plan?: KeeperPlan;
  /** home_actions ids written (empty on a dry run or a skip). */
  action_ids: string[];
}

// ============================================================================
// D. Component props (H9b and H9c)
// ============================================================================

/** One tile, built by H9b's home-screen-logic from HomeResponse and the projects hook. */
export interface HomeTile {
  id: HomeTileId;
  /** The big text: the count ("3"), or for Today "Today: Grok of the Rock". */
  value: string;
  /** The small text: "need you now" ("needs you now" at 1), or for Today "3 quick, then 4 steps". */
  label: string;
  /** Items behind the tile (Today: quick plus steps). 0 renders muted, except Today. */
  count: number;
  /** True only for needs_you_now with count above 0: the muted gold look. Never red. */
  hot: boolean;
}

/** TileStrip (H9b): the strip of tiles; a radio-like group, one selected. */
export interface TileStripProps {
  tiles: HomeTile[];
  selected: HomeTileId;
  onSelect: (id: HomeTileId) => void;
}

/** A one-line question shown on the card, with two buttons (for example the pin switch). */
export interface HomeCardPrompt {
  /** "Switch to this one? The other goes back to its place." */
  text: string;
  /** "Switch" */
  confirmLabel: string;
  /** "Keep the first" */
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** ItemCard (H9b): the cold-open card of design 2B for one item. */
export interface ItemCardProps {
  /** The item, or null to show `emptyText`. */
  item: HomeItem | null;
  /** Shown when item is null (the selected tile's empty sentence). */
  emptyText: string;
  /** A button was pressed (visible or under More). HomeScreen wires it to useHomeItemAction. */
  onAction: (action: HomeItemAction, item: HomeItem) => void;
  /** The action in flight, to disable buttons, or null. */
  pendingAction?: HomeActionId | null;
  /** A quiet status line under the buttons (role=status), or null. */
  statusText?: string | null;
  /** A one-line question to show above the buttons, or null. */
  prompt?: HomeCardPrompt | null;
  /** Opens ProjectDrawer for item.project. */
  onOpenProject?: (projectId: string) => void;
}

/** WorkingOnBar (H9b): the pinned item, with Done and Stop for now. */
export interface WorkingOnBarProps {
  item: HomeItem;
  /** One line standing in for the collapsed lists, for example "3 more in Next. They'll keep.", or null. */
  collapsedLine: string | null;
  /** Done: runs the item's done path (existing endpoint, then done_pin). */
  onDone: () => void;
  /** Stop for now, after "Where did you leave it?"; note may be ''. */
  onStop: (note: string) => void;
  busy?: boolean;
}

/**
 * TodayList (H9c), imported by HomeScreen (H9b): "Quick, before you start", "Today's arc:
 * {name}" with ArcEditor and AddToArcSearch, and the day foot (size line, "Why this arc",
 * "Lighter today", "Swap arc" with its two choices).
 */
export interface TodayListProps {
  /** HomeResponse.today; null renders `emptyText`. */
  today: HomeToday | null;
  /** HomeResponse.empty.today. */
  emptyText: string;
  /** The key of the item open in the card, or null. */
  selectedKey: string | null;
  /** A row was chosen; HomeScreen opens it in the card. */
  onSelect: (item: HomeItem) => void;
  /**
   * Items the add box searches first: every item in the payload's sections and today.quick
   * that is not already a step (HomeScreen builds the list).
   */
  addCandidates: HomeItem[];
  /** HomeResponse.user_id: assignee for POST /api/tasks and the open-task search. */
  userId: string;
  /**
   * Posts an arc or day request. HomeScreen passes useHomeAct (H9a), which shows the toast
   * with Undo and refetches /api/home on success, and rejects with the error body on 409.
   */
  onAct: (request: HomeTodayActRequest) => Promise<HomeActResponse>;
  /** True while a request is in flight or the screen is refetching. */
  busy?: boolean;
}

/** ArcEditor (H9c): the arc's steps, drag (and keyboard) to reorder, "Remove from arc" under More. */
export interface ArcEditorProps {
  /** HomeToday.group_key. */
  groupKey: string;
  /** HomeToday.steps, in order. */
  steps: HomeItem[];
  /** HomeToday.added_keys. */
  addedKeys: string[];
  selectedKey: string | null;
  onSelect: (item: HomeItem) => void;
  /** The full new order of step keys (sent as arc_reorder.step_keys). */
  onReorder: (stepKeys: string[]) => void;
  /** Remove one step (sent as arc_remove). */
  onRemove: (itemKey: string) => void;
  disabled?: boolean;
}

/**
 * AddToArcSearch (H9c): one box under the arc. Searches `candidates` first (same client
 * first), then his open tasks through GET /api/tasks?search=...&assignee_id=userId
 * &statuses=not_started,in_progress,blocked,review. Enter on text with no match creates the
 * task (POST /api/tasks with title and assignee_id only) and adds it with origin 'created'.
 */
export interface AddToArcSearchProps {
  /** HomeToday.group_key. */
  groupKey: string;
  /** HomeToday.client?.id: items for this client rank first. */
  groupClientId: string | null;
  candidates: HomeItem[];
  /** Keys never offered (the current steps). */
  excludeKeys: string[];
  userId: string;
  /** Add one item as the last step (sent as arc_add with this group_key). */
  onAdd: (itemKey: string, origin: HomeArcAddOrigin) => Promise<unknown>;
  disabled?: boolean;
}

// HomeScreen (H9b) takes no props: it fetches through useHome() and is rendered by the
// /dashboard switch (H10) as <HomeScreen />.
