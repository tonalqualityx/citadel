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

import type { OwedRow, OwedState } from './owed/state';
import type { NotEmergencyRule } from './emergency/rule';
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
export type HomeSourceKind = 'task' | 'review' | 'session' | 'wait' | 'thread' | 'crisis' | 'site' | 'hands' | 'step' | 'proposal' | 'finished' | 'attach';

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
export type HomeItemType = 'emergency' | 'lead' | 'owed_reply' | 'sign_off' | 'session_ask' | 'wait' | 'task' | 'hands' | 'step' | 'proposal' | 'finished' | 'attach';

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
  | 'remove_from_arc'
  | 'draft_now'
  | 'needs_thought'
  | 'go_with_that'
  | 'not_this_week'
  | 'open_site'
  | 'keep_lead'
  | 'let_lead_go'
  | 'not_lead'
  | 'treat_as_reply'
  | 'close_lead'
  | 'open_short'
  | 'open_project'
  | 'step_done'
  // Session card: Clear it (a home act; remembers the cleared text on his own row, never touches the session).
  | 'clear_session'
  // Do it on a day (a home act: parks the item until the day he picked; writes only his own home rows).
  | 'on_day'
  // Snooze: a short park (1 to 24 hours) that returns the item to its place.
  | 'snooze'
  // Slice 4d: Book 30 minutes (a home act: a request on his own owed row; the machine makes the private calendar block).
  | 'book_block'
  // Slice 4b: Send the draft. Never a home act: these post to /api/home/send (a session-only route); homeActSchema refuses them.
  | 'send_draft'
  | 'send_short'
  // Slice 9a, a card from his sent mail: Yes (runs the card's stored plan), No (closes it), Track it (placement carried on the button;
  // posts to /api/home/reconcile, session only, never a home act) and Open the email (a link).
  | 'proposal_yes'
  | 'proposal_no'
  | 'track_it'
  | 'open_email'
  // Work stage G, the looks-finished card: Close the ticked ones, Close this one (security and portal rows), Not finished. The card's own
  // buttons are only Close the ticked ones and Not now; the rows carry the others.
  | 'finished_close'
  | 'finished_close_one'
  | 'finished_keep';

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
  | 'open_site'
  | 'no_reply_needed'
  | 'open_short'
  | 'handled'
>;

/** A quick choice under on_day (date) or snooze (hours or until). */
export interface HomeChoice {
  label: string;
  /** on_day: YYYY-MM-DD in his zone. */
  date?: string;
  /** snooze: hours from now. */
  hours?: 1 | 2 | 3 | 4;
  /** snooze: an ISO instant. */
  until?: string;
}

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
  /** on_day only: the quick choices ("Tomorrow", weekday names, "Next week"), each a calendar day in his zone. */
  choices?: HomeChoice[];
  /** Slice 9a, track_it only: where the tasks go. 'project' (the named live project), 'new_project', or 'none' (a single finished one-off). */
  placement?: 'project' | 'new_project' | 'none';
  /** Slice 9a, on a request from the browser (track_it, proposal_yes with a time choice): the minutes chosen (null or 0 = no time) and whether the time is billable. */
  minutes?: number | null;
  billable?: boolean;
  /** on_day and snooze only, on a request from the browser: the choice picked. */
  date?: string;
  hours?: 1 | 2 | 3 | 4;
  until?: string;
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
  /** The requirement's own completed flag. The card writes it through POST /api/tasks/:id/checklist. */
  done: boolean;
  /** The requirement's id in Task.requirements. Absent on a checklist Bast drafted: that one stays display only. */
  id?: string;
  /** The latest answer he saved on this item (a task comment), or absent. */
  answer?: string;
}

/** The cold-open card (design 2B), shown by ItemCard. Filled by select.ts with copy.ts. */
export interface HomeItemCard {
  /** One to three sentences, at most about 60 words (plain-text.ts cardSummary for tasks). Never null; '' only when nothing is known. */
  summary: string;
  /** Slice 2b: 'bast' when summary is Bast's short version (shown only while its hash matches the description), else null. */
  summary_by: 'bast' | null;
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
  /** Slice 4a, threads only: what Bast wrote into his Gmail draft (shown under "The draft"), or null. */
  draft_text?: string | null;
  /** Slice 4a, threads only: Bast's one-line read when the reply needs thought, or null. */
  bast_read?: string | null;
  /** Slice 4a, threads only: Bast's suggested answer, or null. */
  suggested_answer?: string | null;
  /** Slice 4c, threads only: the two-line holding draft Bast wrote into his Gmail (shown under "The short one"), or null. */
  short_draft_text?: string | null;
  /** Slice 7c, tasks only: where a guessed time came from ("Time guess: from 4 similar finished tasks."). Absent when a person set the time or there is no guess. */
  effort_basis?: string | null;
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
  /** Slice 4a, threads only: where Bast's reply work stands (owed/state.ts), or null. */
  owed_state?: OwedState | null;
  /** Slice 4a, threads only: the words after the age on the row ("Draft ready", "Their new message came after your draft."), or null. */
  owed_line?: string | null;
  /**
   * Slice 6c: the outside scan's result line, "Outside check 10:42: nothing new found from outside.", on a Needs you now row
   * (a security task with a site) while the scan came after the row landed. Absent when there is none.
   */
  outside_check?: string | null;
  /**
   * Slice 4b, threads only: the Gmail draft ids the Send buttons post to /api/home/send. Present only while the owner's owed_send
   * switch is on and the draft qualifies; absent (or null) otherwise, and then no Send button exists.
   */
  owed_send?: { draft_id: string | null; short_draft_id: string | null } | null;
  /** Slice 4d, threads only: "Booked Thursday at 2:00" once the machine made the private block (also part of owed_line). */
  owed_booked?: string | null;
  /**
   * Slice 6a: the choices "Not an emergency" offers as a rule (crisis mail and site down rows only), else absent or [].
   * Each is a scope the rule route accepts. The card asks "Why? This becomes a rule." before saving.
   */
  not_emergency_scopes?: HomeScopeChoice[];
  /** Slice 6a: on a task emergency, "A security flag is never turned into a rule." (it keeps the one-time Not an emergency). */
  not_emergency_refusal?: string | null;
  /** Slice 6a: the Monday hands row only. The jobs, grouped by written steps. */
  hands?: HomeHands | null;
  /** Slice 9a: a card from his sent mail (type 'proposal'): the evidence, the time choices and the placement. */
  proposal?: HomeProposal | null;
  /** Work stage G: the looks-finished card (type 'finished'): each task with its proof. */
  finished?: HomeFinished | null;
  /** Work stage D: the one question when it is unclear which work a source belongs to (type 'attach'). */
  attach?: HomeAttach | null;
  /** Work stage D, tasks only: the one state line ("With Bast since Nov 2"). Absent when nothing is attached to it. */
  work_line?: string | null;
}

/** Work stage D: what the attach question shows. Candidate names are links; the answers are the buttons. */
export interface HomeAttach {
  /** `attach:<work_link uuid>`: what the attach_choose act takes. */
  key: string;
  source_kind: string;
  source_href: string | null;
  /** One button per candidate: choice is its target key. */
  candidates: { choice: string; label: string; href: string }[];
  can_new_project: boolean;
  can_task: boolean;
}

/** Work stage D: the loader's question row. */
export interface RawAttachQuestionRow {
  link_id: string;
  kind: string;
  /** The source's ref (conversation key, session external id). Server only. */
  ref: string;
  title: string;
  who: string | null;
  client_name: string | null;
  source_href: string | null;
  candidates: { target_key: string; label: string; href: string }[];
  can_new_project: boolean;
  can_task: boolean;
  since: Date;
}

/** Work stage G: one task on the looks-finished card. */
export interface HomeFinishedRow {
  /** `finished:<work_finished_item uuid>`: what the three finished_* acts take. */
  key: string;
  task_id: string;
  title: string;
  href: string;
  group: 'main' | 'security' | 'portal' | 'unticked' | 'orphan';
  strength: 'strong' | 'medium';
  /** Ticked by default in its group's list: strong proof in the main list, every orphan row. */
  ticked: boolean;
  /** The proof, one line each, with a link when there is one. */
  evidence: { line: string; href: string | null }[];
  /** Work stage E: a security task a session found proof for. It is shown with its proof and closed by the owner on its own task page, never from the card. */
  close_on_task_page?: boolean;
}

/** Work stage G: what the looks-finished card shows. */
export interface HomeFinished {
  count: number;
  rows: HomeFinishedRow[];
  /** Plain lines for finished tasks that belong to other people (counted, never listed or closed). */
  others: string[];
}

/** Work stage G: the loader's rows for the card. */
export interface RawFinishedCard {
  rows: HomeFinishedRow[];
  others: { name: string; count: number }[];
  since: Date;
}

/** Work stage E: one session's looks-done card (the Stage G card, run key `session:<id>`). */
export interface RawSessionFinishedCard extends RawFinishedCard {
  /** `finished:s-<16 hex>` */
  key: string;
  /** Title and short proof of each row, for the card's title line. */
  summary: { title: string; proof: string }[];
}

/** Slice 9a: what a sent-mail card shows. Built by the server from the home_reconcile_change row; text is plain. */
export interface HomeProposal {
  kind: 'done' | 'note' | 'waiting' | 'session' | 'wait' | 'track';
  /** The card lines: his quote with the recipient and date first, then the open points or the track plan. */
  lines: string[];
  /** "Why Bast asks: ..." */
  why: string;
  /** The Gmail thread link ("Open the email"), or null. */
  link: string | null;
  /** From older mail (the look-back): shown in the drawer only. */
  look_back: boolean;
  /** Time choices: only on Track it and on a done card for a task with no time. */
  time: { default: number; choices: number[]; basis: string | null; billable_choice: boolean } | null;
  /** Track it only: how the card files the work (the buttons carry the choice). */
  placement: { kind: 'add' | 'ask' | 'new' | 'loose'; project_id: string | null; project_name: string | null } | null;
}

/** Slice 6a: one scope choice for a "Not an emergency" rule. */
export interface HomeScopeChoice {
  scope: 'sender' | 'domain' | 'site';
  label: string;
}

/** Slice 6a: the hands row's jobs. */
export interface HomeHandsJob {
  title: string;
  minutes: number;
  /** The job's own task item, for its Done, I'll do it now and Open buttons. */
  item: HomeItem;
}
export interface HomeHandsGroup {
  /** The SOP id, or null for "No written steps". */
  sop_id: string | null;
  label: string;
  jobs: HomeHandsJob[];
}
export interface HomeHands {
  count: number;
  minutes: number;
  groups: HomeHandsGroup[];
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
  /** Work stage B: `ask:<id>` for a mail recorded as handled at birth: Undo is the home act reopen_ask on this key, else absent or null. */
  reopen_item_key?: string | null;
  /** Slice 9a: the home_actions id "This was wrong" posts to /api/home/undo with wrong: true (a sent-mail note line), else absent or null. */
  wrong_action_id?: string | null;
  /** Slice 9a: "Log time? 30 min" on a task marked done from a card with no time on it, else absent or null. */
  time_prompt?: { task_id: string; minutes: number; day: string } | null;
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
  | 'bast_stopped' // Slice 3: tasks Bast stopped on beyond the one that holds a Next slot
  | 'hands' // Slice 6a: tasks tagged hands or credential-rotation (they come as one weekly row, never one by one)
  | 'project_steps' // Slice 8b: project next steps that are his and did not make Next
  | 'from_sent_mail'; // Slice 9a: cards from his sent mail beyond the one in Decisions ready, and every look-back card

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
  | 'triage'
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
  'triage',
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
  /** Work stage B: Mail recorded as handled, the last 30 days (read only; each row has Undo through reopen_ask). Never counted in Everything else. */
  handled_mail?: HomeHandledMail[];
  /**
   * Triage (operating model S3): the ideas parked for his release, grouped. Present only for the owner (Mike); absent for everyone else
   * (for Mike with nothing waiting it is an empty section, so the Triage tab shows muted at zero). Triage tasks are never shown anywhere else on this screen as work.
   */
  triage?: HomeTriage | null;
  /**
   * The empty sentence for every tile, from copy.ts, exactly as the design gives them
   * ("Nothing urgent.", "No active projects.", ...). '' where the design has none.
   */
  empty: Record<HomeTileId, string>;
}

// ============================================================================
// B. POST /api/home/act and /api/home/undo
// ============================================================================

/** Triage: one parked idea (a task in status triage). */
export interface HomeTriageTask {
  task_id: string;
  title: string;
  href: string;
  /** The project's name, or null for a task with none. */
  project_name: string | null;
  /** Questions on this card still waiting for his answer. */
  open_questions: number;
  /** One line of what is wanted (the first line of the card's description). '' when there is none. Absent in older payloads. */
  summary?: string;
  /** When the card was filed (ISO), for its age. */
  created_at?: string;
}

/** Triage: one group of parked ideas, by project, or by a `triage-pass:` tag when the tasks carry one. */
export interface HomeTriageGroup {
  /** `project:<uuid>`, `pass:<tag>` or `none`. Stable between loads; the card keys on it. */
  key: string;
  kind: 'project' | 'pass' | 'none';
  label: string;
  count: number;
  /** The first three titles. */
  titles: string[];
  /** Every task in the group, for the expanded view and for "Release plan". */
  tasks: HomeTriageTask[];
  /** Open questions across the group's cards. */
  open_questions: number;
  /** Project groups only: the project id (for Talk about this). */
  project_id: string | null;
  /** True when every project in the group is still a quote: Release plan will say so and do nothing. */
  still_quote: boolean;
}

/** Triage: a card an agent marked `triage:looks-done`, with the evidence line it left (the text after "Looks done: "). */
export interface HomeTriageLooksDone {
  task_id: string;
  title: string;
  href: string;
  project_name: string | null;
  /** What was done and where to see it, from the newest internal "Looks done: " comment. Plain text; links are made clickable by the card. */
  evidence: string;
  open_questions: number;
  summary?: string;
  created_at?: string;
}

/** Triage tab: one phase of a project card's shape. */
export interface HomeTriagePhase {
  id: string;
  name: string;
  summary: string | null;
  mike_part: string | null;
}

/** Triage tab: the project block of a project_setup card. Never carries the plan folder or any task. */
export interface HomeTriageProject {
  project_id: string;
  name: string;
  status: string;
  phases: HomeTriagePhase[];
  /** "What will be Mike's": the mike_part lines of the phases, in order. */
  mike_parts: { phase: string; text: string }[];
  /** The signed contract (or the newest one, with its status) of the project's deal; null when the project has no deal or no contract. */
  contract: { status: 'draft' | 'sent' | 'signed'; signed_at: string | null; version: number; deal_id: string; deal_href: string } | null;
  /** The deal the project came from, even without a contract yet. */
  deal: { id: string; name: string; href: string } | null;
  sitemap: { id: string; name: string; page_type: string | null; needs_design: boolean; notes: string | null }[];
}

/** Triage tab: one card. Only the owner ever gets this. */
export interface HomeTriageCard {
  task_id: string;
  title: string;
  href: string;
  /** What Bast thinks the card is; null = not sorted yet. */
  kind: 'project_setup' | 'task' | 'project_addition' | 'reusable_tool' | 'rule_proposal' | 'question_only' | null;
  created_at: string;
  /** Whole days since the card was filed. */
  age_days: number;
  /** What is wanted: the first line of the card body, at most 220 characters (the card clamps it to two lines). '' when there is none. */
  summary: string;
  /** "On release" sentence, built from the same function Release runs. */
  release_line: string;
  /** The technical detail behind the line (status, tags). Shown only behind "Details" on the card page, never on the tab card. */
  release_details: string[];
  /** False when Release would be refused (kind null, project missing or still a quote). release_line then says why. */
  /** Everything Release depends on, hashed. triage_release_card must send the one the owner read; a mismatch answers 409 card_changed. */
  release_version: string;
  release_ready: boolean;
  release_block: 'unsorted' | 'no_project' | 'still_quote' | 'project_closed' | null;
  open_questions: number;
  /** A session marked the card finished: the evidence line (text after "Looks done: ") and the web addresses in it. */
  looks_done: { evidence: string; links: { text: string; href: string }[] } | null;
  /** project_setup cards only (and only when a project is linked). */
  project: HomeTriageProject | null;
}

/** A released card (tag from-triage) that still has questions waiting for his answer. */
export interface HomeAskedAfterRelease {
  task_id: string;
  title: string;
  href: string;
  status: string;
  open_questions: number;
  released_at: string;
}

export interface HomeTriage {
  /** Every card in Triage, marked ones included. */
  count: number;
  /** The Triage tab's cards: looks done first, then oldest first. Absent in older payloads. */
  cards?: HomeTriageCard[];
  /** Released cards with open questions. Absent in older payloads. */
  asked_after_release?: HomeAskedAfterRelease[];
  /** Cards marked looks-done, shown first under their own heading and not part of any group below. Absent in older payloads. */
  looks_done?: HomeTriageLooksDone[];
  /** Open questions across every card in Triage. */
  open_questions: number;
  groups: HomeTriageGroup[];
}

/** Work stage B: one mail recorded as handled by an intake decision. */
export interface HandledMailLite {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  client_name: string | null;
  reason: string | null;
  deep_link: string;
  handled_at: Date;
  kind: string;
}

export interface HomeHandledMail {
  /** EmailAsk id. */
  id: string;
  /** `ask:<id>`: what reopen_ask takes. */
  key: string;
  /** "Ken Duffy, client: Appreciate it Mike". */
  title: string;
  /** Bast's reason, one plain sentence. */
  reason: string;
  href: string | null;
  at: string;
  /** no_action | waiting_them */
  kind: string;
}

/** Work stage B: a mail recorded as handled in the last day, for its quiet line. */
export interface RawIntakeHandled {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  kind: string;
  deep_link: string;
  handled_at: Date;
}

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
  | 'record'
  | 'draft_now'
  | 'needs_thought'
  | 'go_with_that'
  | 'not_this_week'
  | 'step_done'
  | 'clear_session'
  | 'on_day'
  | 'snooze'
  | 'book_block'
  | 'proposal_yes'
  | 'proposal_no'
  | 'finished_close'
  | 'finished_close_one'
  | 'finished_keep'
  | 'reopen_ask'
  | 'attach_choose'
  | 'triage_release'
  | 'triage_release_card'
  | 'triage_release_plan'
  | 'triage_drop'
  | 'triage_close_done'
  | 'triage_not_done';

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
  | { action: 'record'; item_key: string; did: HomeRecordedActionId; undo?: boolean }
  /**
   * Slice 4a, threads only: Draft it now. Sets the request fields of his home_owed_thread row (the next drafter run,
   * within 10 minutes, serves it). Writes nothing else and sends nothing. Undo within 24 hours clears the request
   * while it is unserved; after the draft exists it answers 409 not_undoable.
   */
  | { action: 'draft_now'; item_key: string }
  /** Slice 4a: Needs thought. Asks Bast for its read and a suggested answer on a drafted thread. Same rules as draft_now. */
  | { action: 'needs_thought'; item_key: string }
  /** Slice 4a: Go with that. Asks Bast to redraft along its suggested answer. 409 no_suggestion without one. */
  | { action: 'go_with_that'; item_key: string }
  /**
   * Slice 6a, the hands row only: Not this week. Parks the row to next Monday 00:05 (view_at, view_set_by user). Undoable. There is
   * deliberately no action here that saves a "Not an emergency" rule: that is POST /api/home/rule (browser session only).
   */
  | { action: 'not_this_week'; item_key: string }
  /** Slice 4c, a lead: Keep it. Restarts the lead clock from now. Undoable. Writes only his home_owed_thread row. */
  | { action: 'keep_lead'; item_key: string }
  /** Slice 4c, a lead: Not a lead, then "Treat as a reply". The thread stops being a lead. Undoable. */
  | { action: 'treat_as_reply'; item_key: string }
  /**
   * Slice 8b, a project next step row: I did this. Writes only his home_item_state row for the step (step_done_at, step_done_text =
   * the step text now on the project, read here and never taken from the request). Writes no Project field and calls no refresh:
   * the browser queues the existing project refresh first. Undoable for 24 hours.
   */
  | { action: 'step_done'; item_key: string }
  /**
   * A session card: Clear it. Writes only his home_item_state row for session:<external_id> (session_cleared_at, session_cleared_hash =
   * sha256 of the session's waiting_on read inside the transaction, never taken from the request). The OracleSession row is not touched.
   * The card stays hidden while the session's waiting_on hashes the same and shows again on a new text. Undoable for 24 hours.
   */
  | { action: 'clear_session'; item_key: string }
  /**
   * Do it on a day: he said when HE will do this item. Parks it until 00:05 on `date` his time (view_at, view_set_by user, parked_at,
   * on_day) and takes it out of Needs you now, Quick, today's steps and Working on until then, whatever it is (an emergency too: it
   * returns). `date` is tomorrow or later, at most 60 days out (else 400 "Pick a day after today."). Not a Not now (park_count and
   * the learner are untouched) and no Task field is written. On the day it returns boosted with "You said today." Undoable for 24 hours.
   */
  | { action: 'on_day'; item_key: string; date: string }
  /**
   * Snooze: the item leaves every list until `until` (an ISO instant 15 minutes to 24 hours ahead) or until `hours` (1 to 4) from now;
   * exactly one of the two. Longer is on_day's job (400 "Pick a day instead."). Same parking as on_day (view_at, view_set_by user,
   * parked_at) plus snoozed_until and a per-day count (the third snooze of an item in a day adds a plain sentence). It returns to
   * its place with "Back from a snooze." (no boost). Not a Not now: park_count and the learner are untouched; no Task field is
   * written. Undo for the length of the snooze, at most 24 hours.
   */
  | { action: 'snooze'; item_key: string; until?: string; hours?: 1 | 2 | 3 | 4 }
  /**
   * Slice 4d, a needs-thought thread: Book 30 minutes. Picks his next free half hour (today or the next business day, 10:00 to 17:00
   * his time, clear of meetings) and writes only the request and slot on his own home_owed_thread row; the machine makes a private
   * block on his own calendar with no attendees. 409 book_off, book_not_ready, already_booked, or no_free_slot (nothing written).
   * Undo within 24 hours: before the event exists it clears the request; after, it asks the machine to delete that one event.
   */
  | { action: 'book_block'; item_key: string }
  /**
   * Slice 9a, a card from his sent mail: Yes. Runs the card's stored plan after re-checking it (the task still open and still his; the
   * session's ask still the same text). Covers done, waiting, session, wait and note cards that offer no time choice. A Track it card,
   * or a done card with a time choice, answers 400 "Tap this on the home screen." (POST /api/home/reconcile is the only door that can
   * create a time entry, and homeActSchema refuses track_it and log_time). Undo within 24 hours (compare-and-set, nothing deleted).
   */
  | { action: 'proposal_yes'; item_key: string }
  /** Slice 9a: No. Closes the card; the same piece of work is never proposed again. */
  | { action: 'proposal_no'; item_key: string }
  /**
   * Work stage G, the looks-finished card. finished_close: the ticked list (at most 100 keys). Only main and orphan rows close; a security,
   * portal or unticked row in it is refused and stays open. Closes through the normal task status path (so Stage A closes the task's
   * emails), writes one Handled line with Undo for 72 hours. finished_close_one: one security or portal row, its own line and Undo.
   * finished_keep: Not finished; the row leaves the card and is not offered again for 90 days (Undo 24 hours).
   */
  | { action: 'triage_release'; task_ids: string[] }
  | { action: 'triage_release_card'; task_ids: [string]; release_version: string }
  | { action: 'triage_release_plan'; group_key: string }
  | { action: 'triage_drop'; task_ids: string[] }
  | { action: 'triage_close_done'; task_ids: string[] }
  | { action: 'triage_not_done'; task_ids: string[] }
  | { action: 'finished_close'; item_keys: string[] }
  | { action: 'finished_close_one'; item_key: string }
  | { action: 'finished_keep'; item_key: string }
  /** Work stage B: Undo of a mail recorded as handled. item_key is `ask:<EmailAsk id>`. Reopens it as a reply he owes and holds it against re-closing. Allowed for 30 days. */
  | { action: 'reopen_ask'; item_key: string }
  /**
   * Work stage D, the attach question. choice is one candidate's target key, or `new_project`, `task` or `not_work`. Every answer has Undo for
   * 72 hours (compare-and-set; a project it started goes to cancelled, a task it made to abandoned; nothing is deleted).
   */
  | { action: 'attach_choose'; item_key: string; choice: string };

/** The arc and day requests TodayList, ArcEditor and AddToArcSearch send. */
export type HomeTodayActRequest = Extract<HomeActRequest, { action: 'arc_add' | 'arc_remove' | 'arc_reorder' | 'swap' | 'lighter' | 'snooze' }>;

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
  | 'no_suggestion' // 409: go_with_that on a thread with no suggested answer
  | 'already_drafted' // 409: draft_now on a thread whose Bast draft already covers the newest message
  | 'book_off' // 409: book_block while the switch is off
  | 'book_not_ready' // 409: book_block on a thread that is not a needs-thought row
  | 'already_booked' // 409: book_block on a thread that already has a request or a block
  | 'no_free_slot' // 409: book_block when no free half hour exists in the next two business days (nothing written)
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
  /** Slice 9a: "This was wrong", only on a sent-mail line. Undoes it, then keeps Bast from changing that task from his mail for 90 days. */
  wrong?: true;
}

/** POST /api/home/undo, 200. */
export interface HomeUndoResponse {
  ok: true;
  action_id: string;
  item_key: string | null;
  /** Slice 9a: "Changed since. Open the task." when part of a Track it was left alone because he changed it, else absent or null. */
  message?: string | null;
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
  /** The requirement's id, when it has one. */
  id?: string;
  /** The latest saved answer on it (see lib/tasks/checklist.ts), when there is one. */
  answer?: string;
}

/**
 * An open task of U (plan 1.1): assignee_id = U, not deleted, status not done or abandoned,
 * project null or its status not in EXCLUDED_PROJECT_STATUSES.
 */
/** Work stage A: one email linked to a task, for the card's Email line. */
export interface RawTaskEmail {
  ask_id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  received_at: Date;
  deep_link: string;
}

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
  /** Work stage A: the emails linked to this task (newest first, at most 3), shown on its card under Email. [] when none. */
  emails?: RawTaskEmail[];
  /** Work stage D: the other sources attached to this task (sessions, sends, deploys, meetings), newest first, at most 4. */
  attached?: { label: string; href: string | null }[];
  /** Work stage D: the one state line when something is attached ("With Bast since Nov 2"). */
  work_line?: string | null;
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
  /** Work stage D: the keys a work link carries for this ask's conversation (the guard reads them). Absent in older fixtures. */
  conversation_key?: string | null;
  rfc_message_id?: string | null;
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
  /** Work stage B: the intake decision (no_action | reply_mike | work | meeting | waiting_them | emergency), or null on an old row. */
  disposition?: string | null;
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
  /** Slice 4c: when his Not now was tapped (null for a park from before 4c). A newer message from them wakes the row. */
  parked_at?: Date | null;
  /** Slice 8b: when he tapped "I did this" on a project next step, and the step text then. */
  step_done_at?: Date | null;
  step_done_text?: string | null;
  /** Session card: when he cleared a session's question, and the sha256 of its text then. */
  session_cleared_at?: Date | null;
  session_cleared_hash?: string | null;
  /** Do it on a day: the calendar day he picked (UTC midnight of that date). view_at holds 00:05 of it in his zone. */
  on_day?: Date | null;
  /** Snooze: the instant it ends, and how many snoozes of this item were taken on snooze_day (his zone). */
  snoozed_until?: Date | null;
  snooze_count?: number;
  snooze_day?: Date | null;
  /** Slice 7c: display-only guesses the nightly learn step wrote for an open task. Never a Task field. */
  effort_minutes?: number | null;
  effort_source?: string | null;
  effort_basis_n?: number | null;
  unknowns?: string | null;
  drain?: string | null;
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
  /** after.href, the one link on the line (work_close with a single email), or null. */
  href?: string | null;
}


/** Slice 9a: one open card from his sent mail (home_reconcile_change, mode card, state open, not past its two weeks). */
export interface RawReconcileCard {
  id: string;
  kind: 'done' | 'note' | 'waiting' | 'session' | 'wait' | 'track';
  title: string;
  lines: string[];
  /** The WhyCode (decide.ts) the card was made for. */
  reason: string | null;
  link: string | null;
  created_at: Date;
  look_back: boolean;
  plan: Record<string, unknown>;
  minutes_estimate: number | null;
  estimate_basis: string | null;
  /** quote_to, the recipient label. */
  who: string | null;
  quote_at: Date | null;
}

/** Slice 9a: one Handled line for his sent mail (a note, or a card he marked done with no time on it). */
export interface RawReconcileLine {
  /** The home_actions id: the Undo and "This was wrong" target. */
  id: string;
  text: string;
  details: string[];
  link: string | null;
  at: Date;
  undo_until: Date | null;
  /** True for an automatic note (it offers "This was wrong"). */
  note: boolean;
  time_prompt: { task_id: string; minutes: number; day: string } | null;
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
  /** Slice 9a: his open cards from sent mail, and the Handled lines of the notes. Absent means none. */
  reconcile_cards?: RawReconcileCard[];
  /** Work stage G: his open looks-finished card, or null. Absent means none. */
  finished?: RawFinishedCard | null;
  /** Work stage E: one looks-done card per session (a session that ended, or one whose in-session question waited two hours). Absent means none. */
  session_finished?: RawSessionFinishedCard[];
  /** Work stage D: his open attach questions, oldest first. Absent means none. */
  attach_questions?: RawAttachQuestionRow[];
  /**
   * Work stage D: item keys (thread:..., session:...) the guard found already carried by open work. select drops them as well (the
   * loader already left them out), so no path can show one as a second to-do. Absent means none.
   */
  handled_elsewhere?: string[];
  /** Work stage D: how many sources the guard keeps off his list now (the measures line). Absent means unknown. */
  kept_off?: number;
  /** Work stage B: mail recorded as handled in the last day (quiet lines with Undo), and in the last 30 days (the list). Absent means none. */
  intake_handled?: RawIntakeHandled[];
  handled_mail?: HandledMailLite[];
  reconcile_lines?: RawReconcileLine[];

  /** Slice 4a: U's home_owed_thread rows (Bast's drafts and reads). */
  owed_rows: OwedRow[];
  /** Slice 4a: finished_at of the owner's owed_reply keeper run row for today (the freshness stamp), or null. */
  drafter_fresh_at: Date | null;
  /** Slice 6a: his IANA zone (the hands row's Monday to Friday window). */
  timezone: string;
  /** Slice 6a: U's site incidents (open ones, and uptime-mail ones closed as answered in the last 3 days). */
  site_incidents: RawSiteIncident[];
  /** Slice 6a: U's confirmed "Not an emergency" rules (Decision lane home-emergency). */
  not_emergency_rules: NotEmergencyRule[];
  /** Slice 8b: in-progress projects whose next step is his, written by Bast or by him. Read only. */
  project_steps: RawProjectStep[];
  /**
   * Slice 7b: his learned weights that are not at 100 (loadWeights). Absent or [] means none: selectHome output is then
   * deep-equal to a run that never loaded weights. Server only; no number from a weight reaches the browser.
   */
  weights?: RawWeight[];
  /** Slice 4b: HomeKeeperSettings.owed_send for U. Absent or false = off (no settings row is off). */
  owed_send?: boolean;
  /** Slice 4b: U's presses on Send the draft in the last 24 hours that were not undone. Absent or [] when none. */
  owed_sends?: RawOwedSend[];
  /** Slice 4d: HomeKeeperSettings.book_blocks for U. Absent or false = off (no settings row is off). */
  book_blocks?: boolean;
  /** Slice 4d: U's taps on Book 30 minutes in the last 24 hours that were not undone. Absent or [] when none. */
  owed_books?: RawOwedBook[];
  /** Slice 6c: U's stored outside scan results that still belong on a row (item_key, plain summary, when it ran). Absent or [] when none. */
  outside_checks?: RawOutsideCheck[];
}

/** Slice 6c: one stored outside scan result (home_emergency_watch.scan_*). */
export interface RawOutsideCheck {
  item_key: string;
  summary: string;
  at: Date;
}

/** Slice 7b: one learned weight on a piece of evidence (client:, project:, sop:, type:, sender:). */
export interface RawWeight {
  evidence_key: string;
  label: string;
  weight_pct: number;
}

/** Slice 8b: one project's next step, as the loader read it. */
export interface RawProjectStep {
  project_id: string;
  project_name: string;
  client: RawClientRef;
  /** Project.next_step_text, unchanged (it starts with "Mike, " when Bast wrote it). */
  text: string;
  source: 'bast' | 'mike';
  /** Project.next_step_at, or null. */
  step_at: Date | null;
  /** The newest updated_at among the project's tasks, else the project's own updated_at. */
  last_activity_at: Date;
}

/** Slice 4d: one tap on "Book 30 minutes" (the slot as it was picked; the row's own columns say where the block stands now). */
export interface RawOwedBook {
  action_id: string;
  item_key: string;
  who: string;
  start: Date;
  pressed_at: Date;
  undo_until: Date | null;
}

/** Slice 4b: one press on "Send the draft", with where its held outbox row stands. */
export interface RawOwedSend {
  action_id: string;
  item_key: string;
  who: string;
  send_after: Date;
  pressed_at: Date;
  /** pending: waiting for the hold or the sender; sent: delivered; failed: it did not go (the draft is still in Gmail). */
  status: 'pending' | 'sent' | 'failed';
  /** For failed: the superseded_reason or last_error, mapped to words by sendFailureReason. */
  reason: string | null;
}

/** Slice 6a: a home_site_incident row plus what the screen needs from its site, client and mails. */
export interface RawSiteIncident {
  site_id: string;
  domain: string;
  client_id: string | null;
  client_name: string | null;
  source: 'kuma' | 'uptime_mail';
  ask_ids: string[];
  started_at: Date;
  last_checked_at: Date | null;
  last_check_up: boolean | null;
  closed_at: Date | null;
  close_reason: string | null;
  /** The mail behind it, as named links (deep links of the asks). */
  mail_links: HomeLink[];
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
  | 'keeper_arc_link'
  | 'keeper_owed_drafts'
  // Slice 6a: the site-down check's lines (source keeper, no Undo) and the saved-rule line (his own press, Undo for 7 days)
  | 'watch_site_cleared'
  | 'watch_site_down'
  // Slice 6c: the outside scan result for a site that answered again (source keeper, no Undo)
  | 'watch_site_scan'
  // Slice 7a: the Monday measures line and the approval-speed guard line (source keeper, a report: no Undo)
  | 'keeper_measures'
  | 'keeper_guard'
  // Work stage A: the emails closed with their task (source keeper, Undo for 72 hours)
  | 'work_close'
  // Work stage G: tasks closed from the looks-finished card (source keeper, Undo for 72 hours)
  | 'finished_close'
  // Triage: ideas released or dropped from the Triage section (source keeper, Undo for 72 hours)
  | 'triage_release'
  | 'triage_release_card'
  | 'triage_release_plan'
  | 'triage_drop'
  | 'triage_close_done'
  | 'triage_not_done'
  // Work stage E: work started from a session the owner said to track, and the one-time clear of old session questions (source keeper, Undo for 72 hours)
  | 'session_track'
  | 'work_stale_clear'
  // Work stage D: a source attached quietly to the work it clearly belongs to (source keeper, Undo for 72 hours)
  | 'work_attach'
  // Work stage B: a batch of mail recorded as handled, or a booked meeting that closed a request for a time (source keeper, Undo for 72 hours)
  | 'intake_close'
  // Slice 7b: a learned weight (source keeper, Undo for 7 days)
  | 'keeper_learned'
  | 'not_emergency_rule';

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

/** Slice 2c: one arc the keeper would make (or made) from the group Today would propose. */
export interface KeeperArcMake {
  /** The group Today would propose: "client:<uuid>" or "project:<uuid>". */
  group_key: string;
  name: string;
  client_id: string | null;
  project_id: string | null;
  /** His open tasks with no arc that it links (2 to 4), as task ids and titles in the same order. */
  task_ids: string[];
  task_titles: string[];
  /** The sentence Handled for you would show. */
  line: string;
}

/** Slice 2c: one arc the keeper would close (or closed). */
export interface KeeperArcClose {
  arc_id: string;
  name: string;
  /** all_done: every step is done. stale: nothing touched for 21 days. */
  reason: 'all_done' | 'stale';
  /** Open tasks still on the arc (0 for all_done). */
  open_tasks: number;
  line: string;
}

/** Slice 2c: the three switches in the owner's home_keeper_settings row (all false with no row). */
export interface KeeperArcSwitches {
  arcs_create: boolean;
  arcs_close: boolean;
  arcs_link_tasks: boolean;
}

/** Slice 2c: the dry run's `arcs` key. What the arc rules would do, shown whatever the switches say. Nothing is written. */
export interface KeeperArcsPreview {
  switches: KeeperArcSwitches;
  would_make: KeeperArcMake[];
  would_close: KeeperArcClose[];
}

/** Slice 2c: a real run's `arcs_written` key, present only when a switch is on. */
export interface KeeperArcsWritten {
  switches: KeeperArcSwitches;
  made: KeeperArcMake[];
  closed: KeeperArcClose[];
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
  /** Slice 2c, dry run only: the arcs it would make and close, under their own key. */
  arcs?: KeeperArcsPreview;
  /** Slice 2c, real run only, only when a switch is on: the arcs it made and closed. */
  arcs_written?: KeeperArcsWritten;
  /** Work stage A: the nightly catch-up of emails whose task finished (a dry run says how many it would close). */
  work_catchup?: { would_close: number; closed: number };
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
  /**
   * Slice 6a: save a "Not an emergency" choice as a rule (crisis mail and site down rows). Resolves true when it was saved.
   * Without it, or without item.not_emergency_scopes, Not an emergency is the one-time action.
   */
  onSaveRule?: (item: HomeItem, scope: HomeScopeChoice['scope'], reason: string) => Promise<boolean>;
  /** The "Done when" list on a task card: tick or untick one item, save an answer (comment + tick), save a note (comment). Without them the list is display only. */
  onChecklistTick?: (taskId: string, itemId: string, completed: boolean) => Promise<boolean>;
  onChecklistAnswer?: (taskId: string, itemId: string, answer: string) => Promise<boolean>;
  onChecklistNote?: (taskId: string, note: string) => Promise<boolean>;
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
