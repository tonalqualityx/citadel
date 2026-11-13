/**
 * Bast chat v2: the reach check (plan section 4.2, rules R1 to R7).
 *
 * The path this gate covers from the chat to a shell on Mike's machine is the citadel worker: every 10 minutes
 * ~/.local/bin/citadel-worker.sh runs the unblock sweep, asks spawn-gate.py whether there is work,
 * and if so runs a full agent session (with a shell) that reads Bast's tasks and the tasks in a delegate's queue.
 * Task text can come from client mail. So a chat change that would START such a session, or CHANGE what a queued one
 * reads, must become a proposal Mike confirms with one tap. This module decides that, as pure functions:
 * no database, no clock (the caller passes `now`), no prose (the tap card's words are composed
 * elsewhere from the data returned here).
 *
 * How it decides: it models what the worker will do with each task before and after the planned
 * change (`workerView`, a mirror of spawn-gate.py `run()` plus Citadel's `healBlockedTasks` sweep),
 * and reaches when
 *   - a task the worker would not act on becomes one it acts on (eligible, woken, or running), or
 *   - a task the worker acts on changes anything outside the safe set, or the way it is woken, or
 *   - a task Bast holds at all (parked, staged, review pending, chat parked) changes outside the
 *     safe set, because the next wake reads the changed text (R1, "any status"), or
 *   - a task a Bast task waits on closes, is approved, or changes text the dependent's session reads (R2),
 *   - a delegate (Sabeen) task becomes, or already is, woken by a human last comment (R3),
 *   - a wait whose owner resolves to Bast stays open and is moved, reassigned or resumed (R4).
 * Separately it reports what would newly show to a client (R5). Undo uses the same functions on the
 * state it would restore (R6). Unknown statuses, unknown fields, unknown operations and any input the
 * decision needs but was not given all reach, with a reason.
 *
 * NOT the only path (VERIFY-6 A4): other scheduled Bast sessions also run with a shell and read task text of any
 * assignee, mostly titles and lists: the email check (every minute; its `[bast-plan]` branch reads a task and flips it
 * to Bast through plan_approval.py), the gardener and the portfolio review (weekly), Sabeen's briefing (nightly) and the
 * meeting sync (hourly). They are outside this gate's scope and tracked separately. Writers other than the chat lane (a
 * person moving a Sabeen task back from review, an admin key or plan approval handing a task to Bast) are not gated
 * here either: out of scope by ruling.
 *
 * Sources mirrored (read 2026-11-10): spawn-gate.py `classify` 367 to 381, `has_open_blocker` 330 to 341,
 * `lease_is_live` 351 to 364, `wake_if_human_last_comment` 417 to 448, `wake_client_approved` 454 to 470,
 * `run` 513 to 581; gate.json; citadel-worker.sh 161 to 171 (unblock sweep before the gate);
 * lib/services/dependencies.ts `isBlockerSatisfied` 26 to 30 and `healBlockedTasks` 168 to 190;
 * the worker skill (~/.openclaw/workspace/skills/citadel-worker/SKILL.md) W1 342 to 363, W2 381 to 405,
 * W3 407 to 422; app/api/tasks/[id]/comments/route.ts 118 (hidden comments are not listed).
 */
import {
  BAST_USER_ID,
  BLOCKING_TAGS,
  CHAT_PARKED_TAGS,
  CLIENT_APPROVED_TAG,
  COCKPIT_OWNED_TAG,
  DELEGATE_QUEUE_STATUSES,
  DELEGATE_USER_IDS,
  SATISFIED_BLOCKER_STATUSES,
  TASK_STATUSES,
} from './gate-mirror';
import { isClientVisibleTask } from '@/lib/portal/visibility';
import { isShownInPortal, renderedFieldsTouched } from '@/lib/portal/client-rendered';

// ---------------------------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------------------------

/**
 * Who wrote the task's newest visible comment, as the gate sees it (spawn-gate.py 428 to 434):
 * `human` a staff user not in BOT_USER_IDS, `client` a comment with author_contact_id, `bot` a bot id
 * without author_contact_id, `none` no comment. Hidden (is_deleted) comments do not count.
 */
export type CommentAuthorKind = 'human' | 'client' | 'bot' | 'none';
export const COMMENT_AUTHOR_KINDS: readonly CommentAuthorKind[] = ['human', 'client', 'bot', 'none'];

export type DateLike = string | Date;

/** One entry of a task's `blocked_by`, with what both the gate and Citadel's unblock need. */
export interface BlockerRef {
  id: string;
  title?: string | null;
  status?: string;
  approved?: boolean;
  /** The blocker's project `dependencies_ordering_only`; null when the blocker has no project. */
  ordering_only?: boolean | null;
  /** Id of the blocker's newest comment (the worker's W3 reads it). Part of the tap's re-check. */
  last_comment_id?: string | null;
  /** Who holds the blocker. A Bast blocker's session reads this task's title in its `blocking` list (VERIFY-3 table). */
  assignee_id?: string | null;
}

/**
 * A task as it is now. Every field is optional so a caller can leave out what it did not load, but a
 * field the decision needs and was not given makes the result reach (`missing_data`). Load all of them
 * for the task routes; the dependents need the same fields.
 */
export interface ReachTask {
  id: string;
  assignee_id?: string | null;
  status?: string;
  tags?: readonly string[];
  title?: string | null;
  description?: string | null;
  requirements?: unknown;
  notes?: string | null;
  site_id?: string | null;
  project_id?: string | null;
  client_id?: string | null;
  sop_id?: string | null;
  arc_id?: string | null;
  needs_review?: boolean;
  approved?: boolean;
  client_approved_at?: DateLike | null;
  lease_until?: DateLike | null;
  last_comment_author?: CommentAuthorKind;
  /** Id of the newest comment on the task, ordered by created_at then id. Part of the tap's re-check (a new comment changes it). */
  last_comment_id?: string | null;
  blocked_by?: readonly BlockerRef[];
  /** This task's own project `dependencies_ordering_only` (null: no project). Decides whether closing it releases a blocked dependent. */
  ordering_only?: boolean | null;
  /** The project's status. The worker's queue has no project filter (Bast is not a tech user), so it never gates; carried for the card. */
  project_status?: string | null;
  client_visible?: boolean;
  requested_by_contact_id?: string | null;
  staging_preview_url?: string | null;
}

/** A task with the tasks that wait on it (Citadel `blocking`), each with its own full `blocked_by`. */
export interface ReachTaskWithDependents extends ReachTask {
  dependents?: readonly ReachTask[];
}

/**
 * The planned change to a task: the validated fields exactly as the route will write them. A key that
 * is absent is unchanged. `tags` is the full new list (the server builds it from tags_add and tags_remove).
 * Any key this module does not know reaches (`unknown_field`).
 */
export interface TaskChange {
  status?: string;
  title?: string;
  description?: string | null;
  requirements?: unknown;
  notes?: string | null;
  assignee_id?: string | null;
  project_id?: string | null;
  client_id?: string | null;
  site_id?: string | null;
  sop_id?: string | null;
  arc_id?: string | null;
  tags?: readonly string[];
  blocked_by_connect?: readonly BlockerRef[];
  blocked_by_disconnect?: readonly string[];
  needs_review?: boolean;
  approved?: boolean;
  client_visible?: boolean;
  due_date?: DateLike | null;
  promised_to?: string | null;
  priority?: number;
  is_focus?: boolean;
  energy_estimate?: number | null;
  mystery_factor?: string;
  battery_impact?: string;
  /** Context, not a write: the new project's `dependencies_ordering_only` when `project_id` changes. */
  ordering_only_after?: boolean | null;
  [key: string]: unknown;
}

/** Where the check is called from. `undo` marks every hit `via_undo` (R6). */
export type ReachOrigin = 'chat' | 'undo' | 'tap';

/** Non-task operations of POST /api/bast-chat/worker/ops (plan 2.2). */
export type ReachOp =
  | { op: 'home_act' }
  /**
   * A Triage release made from the chat. `cards` are the released cards that END assigned to Bast and open (not closed as done);
   * `client_text` says whether the card carries text a client may have written (a client email, the portal, a client's comment).
   * Plan rule: a release acts at once when the text is Mike's or an agent's, and taps when it carries client text.
   */
  | { op: 'triage_release'; cards: { task_id: string; client_text?: boolean }[] }
  | { op: 'email_ask_state'; ask_id?: string }
  | { op: 'project_status'; project_id: string; status_before?: string; status_after?: string }
  | {
      op: 'wait_change';
      wait_id: string;
      /** redate, extend, pause, resume, reassign, complete, cancel. */
      action?: string;
      /**
       * The wait is still open after the change (a paused wait is open). For `complete`: the chain has a next step
       * and finishing this one opens it.
       */
      open_after?: boolean;
      /** `resolveWaitOwner` (lib/waits/sweeper.ts 233) gives Bast after the change. */
      owner_is_bast_after?: boolean;
      /** For `complete`: the action of the step it opens (`task`, `send`, `proceed`, `escalate`). */
      next_action?: string;
    };

// ---------------------------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------------------------

/** How the worker holds a task. Mirrors the gate's lists and wake kinds. */
export type WorkerView =
  | 'eligible' // Bast, not_started, no blocking tag, no open blocker: W2 picks it
  | 'wake_parked_reply'
  | 'wake_stale_in_progress'
  | 'wake_review_reply'
  | 'wake_client_approved'
  | 'wake_delegate_comment'
  | 'in_progress_leased' // a live session holds it now; it wakes as stale when the lease runs out
  | 'in_progress_cockpit' // the worker's W0.5 liveness check may release it to not_started
  | 'parked' // Bast, blocking tag, open blocker or blocked: quiet, a human comment wakes it
  | 'chat_parked' // chat-clarifying: dropped by the gate until the tag goes
  | 'staged' // Bast, review: quiet until the client approves
  | 'review_pending' // Bast, done, needs_review, not approved: quiet until a human comment
  | 'delegate_quiet' // Sabeen's open task, last comment not human
  | 'none'; // not read by the worker

/** Views where a session starts, is running, or will start without any further human act. */
export const ACTIVE_VIEWS: readonly WorkerView[] = [
  'eligible',
  'wake_parked_reply',
  'wake_stale_in_progress',
  'wake_review_reply',
  'wake_client_approved',
  'wake_delegate_comment',
  'in_progress_leased',
  'in_progress_cockpit',
];

/** Views of a task Bast holds: the worker reads it now or on its next wake. */
export const BAST_HELD_VIEWS: readonly WorkerView[] = [
  'eligible',
  'wake_parked_reply',
  'wake_stale_in_progress',
  'wake_review_reply',
  'wake_client_approved',
  'in_progress_leased',
  'in_progress_cockpit',
  'parked',
  'chat_parked',
  'staged',
  'review_pending',
];

/**
 * VERIFY-6 G1: the ONE rule for "a task a Bast session may read" around a changed task. A task Bast holds (any view in
 * BAST_HELD_VIEWS) and a task in a delegate's queue (quiet or woken: the delegate pass reads it and may hand it to Bast)
 * are judged alike as the blocker or dependent of the task a chat change writes, so the two cannot drift apart.
 */
export const SESSION_READ_VIEWS: readonly WorkerView[] = [...BAST_HELD_VIEWS, 'delegate_quiet', 'wake_delegate_comment'];

export function sessionMayRead(v: WorkerView): boolean {
  return SESSION_READ_VIEWS.includes(v);
}

/** Whose tasks a Bast session reads at all: Bast's own and each delegate's (spawn-gate.py `delegate_user_ids`). */
export function isSessionHolder(assigneeId: string | null | undefined): boolean {
  return assigneeId === BAST_USER_ID || (typeof assigneeId === 'string' && DELEGATE_USER_IDS.includes(assigneeId));
}

/** Who holds a task a hit names: Bast, or a delegate (the card names her queue). */
export type SessionHolder = 'bast' | 'delegate';
const holderOf = (assigneeId: string | null | undefined): SessionHolder => (assigneeId === BAST_USER_ID ? 'bast' : 'delegate');

export type ReachRule =
  | 'hand_to_bast' // R1: the change gives the task to Bast, and the worker will hold it
  | 'create_for_bast' // R7 and 1.3: a new task the worker will hold
  | 'starts_bast_task' // R1: a Bast task becomes eligible, woken or running because of this change
  | 'resteers_bast_task' // R1: a task the worker acts on changes outside the safe set, or how it is woken
  | 'edits_held_bast_task' // R1: a Bast task the worker holds quietly changes outside the safe set
  | 'comment_on_bast_task' // a comment lands on a task Bast holds: every session reads the thread
  | 'releases_dependent' // R2: a Bast task that waits on this one starts, or wakes differently
  | 'changes_blocker_text' // R2: a Bast task waits on this one and its session reads this text (W3 line 415)
  | 'changes_dependent_title' // this task waits on a Bast task, whose GET lists this task's title (`blocking`)
  | 'edits_delegate_text' // VERIFY-5 Z3: text on a task in a delegate's queue, which Bast's delegate pass reads and may take over
  | 'hands_chat_text_to_delegate' // VERIFY-5 Z3: a task carrying chat-written text goes into a delegate's queue
  | 'wakes_delegate' // R3: a delegate task becomes woken by a human last comment
  | 'edits_woken_delegate_task' // R3: a woken delegate task changes what its session reads
  | 'wait_for_bast' // R4
  | 'unknown_field'
  | 'unknown_status'
  | 'unknown_op'
  | 'missing_data';

export interface ReachHit {
  rule: ReachRule;
  /** A short machine reason (views, fields, what was missing). Not shown to Mike as is. */
  reason: string;
  /** The task the worker would start or read differently. For `releases_dependent` it is the dependent. */
  task_id: string | null;
  wait_id?: string;
  /** The fields of the planned change that caused it (`comments` for a comment op). */
  fields: string[];
  view_before?: WorkerView;
  view_after?: WorkerView;
  /** True when the check ran on an Undo's restore (R6). */
  via_undo: boolean;
  /** For a blocker or dependent rule: whose task it is (VERIFY-6 G1). */
  holder?: SessionHolder;
}

/** The exact text the worker would read from one task after the change, for the tap card. */
export interface WorkerReads {
  task_id: string;
  view: WorkerView;
  title: string | null;
  description: string | null;
  requirements: unknown;
  notes: string | null;
  tags: string[] | null;
  status: string | null;
  site_id: string | null;
  project_id: string | null;
  client_id: string | null;
  sop_id: string | null;
  arc_id: string | null;
  blocked_by: { id: string; title: string | null; status: string | null; last_comment_id: string | null }[] | null;
  last_comment_author: CommentAuthorKind | null;
  /** Newest comment id on the task, so the fingerprint notices any comment added or hidden since the proposal. */
  last_comment_id: string | null;
  /** Which of these this change writes. For a dependent: `blocker:<id>:<field>`. */
  changed: string[];
  /** Read fields the caller did not pass: load them before the card is shown. */
  not_given: string[];
}

export type ClientShowRule = 'shares_task' | 'wait_sends' | 'moves_visible_task' | 'edits_visible_task' | 'project_goes_live' | 'unknown_status' | 'missing_data';

export interface ClientShowHit {
  rule: ClientShowRule;
  reason: string;
  task_id?: string;
  project_id?: string;
  fields: string[];
  via_undo: boolean;
}

export interface ReachResult {
  /** True when the change would start or re-steer the worker (`starts` is not empty). */
  reaches: boolean;
  /** True when Mike must tap: reaches, or shows something to a client. */
  needs_tap: boolean;
  /** The proposal kind to store: a Bast start wins over a client show. Null when nothing taps. */
  proposal_kind: 'bast_start' | 'client_show' | null;
  starts: ReachHit[];
  /** One entry per task in `starts` with a task id: what the worker would read. */
  reads: WorkerReads[];
  shows_client: ClientShowHit[];
}

// ---------------------------------------------------------------------------------------------
// Field sets
// ---------------------------------------------------------------------------------------------

/**
 * Plan 4.2 R1 safe set (the owner's ruling on 0e7e26c: the chat is not neutered). Every member is a typed value that
 * cannot carry words (a date, a number, a flag, a fixed choice), so on a task Bast holds the chat changes it without a
 * tap; the field table proves each one refuses a sentence. None of them enters the worker's eligibility (spawn-gate.py
 * `classify` reads assignee, status, tags, blockers and the lease), so none can start or release work; priority only
 * orders work that is already eligible. `client_visible` is judged by the client rule (R5). `promised_to` is free text
 * the session reads, so it is NOT here (VERIFY-3 X2).
 */
export const SAFE_FIELDS: readonly string[] = ['due_date', 'priority', 'is_focus', 'energy_estimate', 'mystery_factor', 'battery_impact', 'client_visible'];
/** Safe on a Bast task (an existing arc, by id: W2 and W3 do not read the arc); read, so a tap, on a woken delegate task (W1 line 345). */
const ARC_FIELD = 'arc_id';
/** Fields the session reads that have no rule of their own: on a task Bast holds, changing one taps. */
const READ_ONLY_FIELDS: readonly string[] = ['promised_to'];
/** Statuses that only park or close: safe as a field; the view model still catches a wake (blocked with a human comment, the sweep). */
const PARKING_STATUSES: readonly string[] = ['triage', 'blocked', 'done', 'abandoned'];
/** Tags whose meaning to the worker is known to be "do not act": adding one is safe. */
const PARKING_TAGS: readonly string[] = [...BLOCKING_TAGS, ...CHAT_PARKED_TAGS];
/** The task text a session reads (W3 line 417, W1 line 343) and that a card shows. */
const READ_TEXT_FIELDS: readonly string[] = ['title', 'description', 'requirements', 'notes'];
/** Changes to a task that can change what a Bast dependent does or reads. */
const DEPENDENT_RELEVANT: readonly string[] = ['status', 'approved', 'project_id', 'comments', ...READ_TEXT_FIELDS];
/** Changes that can change what a client sees. */
const CLIENT_RELEVANT: readonly string[] = ['client_visible', 'status', 'approved', 'client_id', 'project_id', 'site_id', 'title', 'description', 'requirements', 'tags'];
const CLIENT_VISIBILITY_FIELDS = ['client_visible', 'requested_by_contact_id', 'staging_preview_url', 'status', 'approved'] as const;
/** Fields of a change that are context for the check, never a write. */
const CONTEXT_KEYS: readonly string[] = ['ordering_only_after'];
/** Task fields copied from a change onto the after-state. */
const TASK_WRITE_KEYS: readonly string[] = [
  'status',
  'title',
  'description',
  'requirements',
  'notes',
  'assignee_id',
  'project_id',
  'client_id',
  'site_id',
  'sop_id',
  'arc_id',
  'tags',
  'needs_review',
  'approved',
  'client_visible',
];
/** Every change key with a rule. Anything else reaches. */
export const KNOWN_CHANGE_KEYS: readonly string[] = [
  ...TASK_WRITE_KEYS,
  'blocked_by_connect',
  'blocked_by_disconnect',
  ...SAFE_FIELDS.filter((f) => f !== 'client_visible'),
  ...READ_ONLY_FIELDS,
  ...CONTEXT_KEYS,
];

/** lib/portal/access.ts 37, PORTAL_HIDDEN_PROJECT_STATUSES (not imported: that module loads Prisma). */
export const PORTAL_HIDDEN_PROJECT_STATUSES: readonly string[] = ['quote', 'queue', 'suspended', 'cancelled'];
/** prisma/schema.prisma `enum ProjectStatus`. */
export const PROJECT_STATUSES: readonly string[] = ['quote', 'queue', 'ready', 'in_progress', 'review', 'done', 'suspended', 'cancelled'];

/** Wait actions that only stop or close a wait. */
const WAIT_STOP_ACTIONS: readonly string[] = ['pause', 'cancel'];
/** Wait actions that keep or bring it due (plan 4.2 R4). */
const WAIT_MOVE_ACTIONS: readonly string[] = ['redate', 'extend', 'resume', 'reassign'];

// ---------------------------------------------------------------------------------------------
// The worker model
// ---------------------------------------------------------------------------------------------

export interface ViewResult {
  view: WorkerView;
  /** Inputs the view needed and was not given. Non-empty means the caller must treat it as reaching. */
  missing: string[];
}

export function isActiveView(v: WorkerView): boolean {
  return ACTIVE_VIEWS.includes(v);
}

export function isBastHeldView(v: WorkerView): boolean {
  return BAST_HELD_VIEWS.includes(v);
}

function toTime(v: DateLike | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Citadel's own rule for unblocking a `blocked` dependent (dependencies.ts 26 to 30). */
function citadelBlockerState(b: BlockerRef): 'satisfied' | 'open' | 'unknown' {
  if (b.status === undefined) return 'unknown';
  if (b.status !== 'done') return 'open';
  if (b.ordering_only === true || b.approved === true) return 'satisfied';
  if (b.approved === undefined || b.ordering_only === undefined) return 'unknown';
  return 'open';
}

/**
 * What the worker does with this task, at `now`. Mirrors spawn-gate.py `run()`; a Bast `blocked` task
 * whose blockers all satisfy Citadel's rule (or that has none) is read as not_started, because the runner
 * calls /api/tasks/unblock-sweep before the gate on every tick (citadel-worker.sh 161 to 171).
 */
export function workerView(t: ReachTask, now: Date): ViewResult {
  const missing: string[] = [];
  const out = (view: WorkerView): ViewResult => ({ view, missing });
  if (t.assignee_id === undefined) return { view: 'none', missing: ['assignee_id'] };
  const isBast = t.assignee_id === BAST_USER_ID;
  const isDelegate = t.assignee_id !== null && DELEGATE_USER_IDS.includes(t.assignee_id);
  if (!isBast && !isDelegate) return out('none');
  if (t.status === undefined) return { view: 'none', missing: ['status'] };
  if (!TASK_STATUSES.includes(t.status)) return { view: 'none', missing: [`status (unknown value ${t.status})`] };

  const humanLast = (): boolean => {
    const a = t.last_comment_author;
    if (a === undefined || !COMMENT_AUTHOR_KINDS.includes(a)) {
      missing.push('last_comment_author');
      return true;
    }
    return a === 'human' || a === 'client';
  };

  if (isDelegate) {
    // spawn-gate.py 274 to 276 and 545: not_started, blocked, in_progress only; tags do not gate.
    if (!DELEGATE_QUEUE_STATUSES.includes(t.status)) return out('none');
    return out(humanLast() ? 'wake_delegate_comment' : 'delegate_quiet');
  }

  if (t.tags === undefined) return { view: 'none', missing: ['tags'] };
  const tags = t.tags;
  const clientApproved = (): boolean => {
    if (tags.includes(CLIENT_APPROVED_TAG)) return true;
    if (t.client_approved_at === undefined) {
      missing.push('client_approved_at');
      return true;
    }
    return t.client_approved_at !== null;
  };

  switch (t.status) {
    case 'abandoned':
      return out('none');
    case 'triage':
      // An idea parked for Mike: the worker fetches tasks by status and never reads triage, so filing one starts no
      // session. Releasing it (a move to another status) is judged as the change it is: that one starts Bast.
      return out('none');
    case 'done': {
      if (t.needs_review === undefined || t.approved === undefined) {
        missing.push('needs_review and approved');
        return out('review_pending');
      }
      if (!(t.needs_review && !t.approved)) return out('none');
      if (clientApproved()) return out('wake_client_approved');
      return out(humanLast() ? 'wake_review_reply' : 'review_pending');
    }
    case 'review':
      return out(clientApproved() ? 'wake_client_approved' : 'staged');
    case 'in_progress': {
      if (t.lease_until === undefined) {
        missing.push('lease_until');
        return out('in_progress_leased');
      }
      const until = toTime(t.lease_until);
      if (until !== null && until > now.getTime()) return out('in_progress_leased');
      if (tags.includes(COCKPIT_OWNED_TAG)) return out('in_progress_cockpit');
      return out('wake_stale_in_progress');
    }
    default: {
      // not_started or blocked
      if (tags.some((x) => CHAT_PARKED_TAGS.includes(x))) return out('chat_parked');
      if (t.blocked_by === undefined) {
        missing.push('blocked_by');
        return out('parked');
      }
      let status = t.status;
      if (status === 'blocked') {
        const states = t.blocked_by.map(citadelBlockerState);
        if (states.includes('unknown')) {
          missing.push('blocked_by (status, approved, ordering_only)');
          return out('parked');
        }
        if (states.every((s) => s === 'satisfied')) status = 'not_started';
      }
      if (status === 'not_started') {
        if (t.blocked_by.some((b) => b.status === undefined)) {
          missing.push('blocked_by (status)');
          return out('parked');
        }
        const openBlocker = t.blocked_by.some((b) => !SATISFIED_BLOCKER_STATUSES.includes(b.status as string));
        const blockingTag = tags.some((x) => BLOCKING_TAGS.includes(x));
        if (!openBlocker && !blockingTag) return out('eligible');
      }
      return out(humanLast() ? 'wake_parked_reply' : 'parked');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function stableStringify(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** The planned fields that differ from the task as it is now. A field the task was not given counts as changed. */
function changedFields(current: ReachTask, change: TaskChange): string[] {
  const cur = current as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const key of Object.keys(change)) {
    const value = change[key];
    if (value === undefined || CONTEXT_KEYS.includes(key)) continue;
    if (key === 'blocked_by_connect') {
      const ids = (value as readonly BlockerRef[]).map((b) => b.id);
      if (current.blocked_by === undefined || ids.some((id) => !current.blocked_by!.some((b) => b.id === id))) out.push(key);
      continue;
    }
    if (key === 'blocked_by_disconnect') {
      const ids = value as readonly string[];
      if (current.blocked_by === undefined || ids.some((id) => current.blocked_by!.some((b) => b.id === id))) out.push(key);
      continue;
    }
    if (!KNOWN_CHANGE_KEYS.includes(key)) {
      out.push(key);
      continue;
    }
    const before = cur[key];
    if (before === undefined) {
      out.push(key);
      continue;
    }
    if (key === 'tags') {
      if (!Array.isArray(before) || !sameTags(before as string[], value as readonly string[])) out.push(key);
      continue;
    }
    if (stableStringify(before) !== stableStringify(value)) out.push(key);
  }
  return out;
}

function applyChange(current: ReachTask, change: TaskChange): ReachTask {
  const after = { ...current } as unknown as Record<string, unknown>;
  delete after.dependents;
  for (const key of TASK_WRITE_KEYS) {
    if (change[key] !== undefined) after[key] = change[key];
  }
  if (change.blocked_by_connect !== undefined || change.blocked_by_disconnect !== undefined) {
    if (current.blocked_by === undefined) {
      after.blocked_by = undefined;
    } else {
      const drop = new Set(change.blocked_by_disconnect ?? []);
      const add = change.blocked_by_connect ?? [];
      const kept = current.blocked_by.filter((b) => !drop.has(b.id) && !add.some((a) => a.id === b.id));
      after.blocked_by = [...kept, ...add];
    }
  }
  if (change.project_id !== undefined && change.project_id !== current.project_id) {
    after.ordering_only = change.ordering_only_after;
  }
  return after as unknown as ReachTask;
}

/** Which changed fields fall outside the safe set for this task. */
function nonSafeFields(changed: string[], before: ReachTask | null, after: ReachTask): string[] {
  const afterIsDelegate = typeof after.assignee_id === 'string' && DELEGATE_USER_IDS.includes(after.assignee_id);
  const out: string[] = [];
  for (const f of changed) {
    if (SAFE_FIELDS.includes(f)) continue;
    if (f === ARC_FIELD) {
      if (afterIsDelegate) out.push(f);
      continue;
    }
    if (f === 'status') {
      if (!PARKING_STATUSES.includes(after.status ?? '')) out.push(f);
      continue;
    }
    if (f === 'tags') {
      const was = before?.tags;
      const now = after.tags ?? [];
      if (was === undefined) {
        out.push(f);
        continue;
      }
      const removed = was.filter((t) => !now.includes(t));
      const added = now.filter((t) => !was.includes(t));
      if (removed.length > 0 || added.some((t) => !PARKING_TAGS.includes(t))) out.push(f);
      continue;
    }
    // A connected blocker is new text the session reads (its title, its thread: W3), open or not (VERIFY-4 R10).
    if (f === 'blocked_by_connect') {
      out.push(f);
      continue;
    }
    if (f === 'needs_review') {
      if (after.needs_review !== false) out.push(f);
      continue;
    }
    if (f === 'approved') {
      if (after.approved !== true) out.push(f);
      continue;
    }
    out.push(f);
  }
  return out;
}

function readsOf(t: ReachTask, view: WorkerView, changed: string[]): WorkerReads {
  const notGiven: string[] = [];
  const pick = <K extends keyof ReachTask>(k: K): ReachTask[K] | null => {
    if (t[k] === undefined) {
      notGiven.push(k);
      return null;
    }
    return t[k];
  };
  const reads: WorkerReads = {
    task_id: t.id,
    view,
    title: pick('title') as string | null,
    description: pick('description') as string | null,
    requirements: pick('requirements'),
    notes: pick('notes') as string | null,
    tags: t.tags === undefined ? null : [...t.tags],
    status: pick('status') as string | null,
    site_id: pick('site_id') as string | null,
    project_id: pick('project_id') as string | null,
    client_id: pick('client_id') as string | null,
    sop_id: pick('sop_id') as string | null,
    arc_id: pick('arc_id') as string | null,
    blocked_by:
      t.blocked_by === undefined
        ? null
        : t.blocked_by.map((b) => ({ id: b.id, title: b.title ?? null, status: b.status ?? null, last_comment_id: b.last_comment_id ?? null })),
    last_comment_author: t.last_comment_author ?? null,
    last_comment_id: t.last_comment_id ?? null,
    changed: [...changed],
    not_given: notGiven,
  };
  if (t.tags === undefined) notGiven.push('tags');
  if (t.blocked_by === undefined) notGiven.push('blocked_by');
  if (t.last_comment_author === undefined) notGiven.push('last_comment_author');
  return reads;
}

class Acc {
  starts: ReachHit[] = [];
  reads: WorkerReads[] = [];
  client: ClientShowHit[] = [];
  constructor(private readonly viaUndo: boolean) {}

  hit(rule: ReachRule, taskId: string | null, reason: string, fields: string[], extra: Partial<ReachHit> = {}): void {
    this.starts.push({ rule, reason, task_id: taskId, fields: uniq(fields), via_undo: this.viaUndo, ...extra });
  }

  read(r: WorkerReads): void {
    const existing = this.reads.find((x) => x.task_id === r.task_id);
    if (existing) {
      existing.changed = uniq([...existing.changed, ...r.changed]);
      return;
    }
    this.reads.push(r);
  }

  show(rule: ClientShowRule, reason: string, fields: string[], ids: { task_id?: string; project_id?: string }): void {
    this.client.push({ rule, reason, fields: uniq(fields), via_undo: this.viaUndo, ...ids });
  }

  result(): ReachResult {
    const reaches = this.starts.length > 0;
    const shows = this.client.length > 0;
    return {
      reaches,
      needs_tap: reaches || shows,
      proposal_kind: reaches ? 'bast_start' : shows ? 'client_show' : null,
      starts: this.starts,
      reads: this.reads,
      shows_client: this.client,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

/** R1, R3 and R7 on the changed task itself. */
function evaluateSelf(
  acc: Acc,
  before: ReachTask | null,
  after: ReachTask,
  changed: string[],
  change: TaskChange,
  now: Date,
  chatWritten = false,
): void {
  if (changed.length === 0) return;
  const nonSafe = nonSafeFields(changed, before, after);
  const vb: ViewResult = before ? workerView(before, now) : { view: 'none', missing: [] };
  const va = workerView(after, now);
  const readChanged = changed.filter((f) => !SAFE_FIELDS.includes(f));
  const missing = uniq([...vb.missing, ...va.missing]);
  if (missing.length > 0) {
    acc.hit('missing_data', after.id, `missing: ${missing.join(', ')}`, changed, { view_before: vb.view, view_after: va.view });
    acc.read(readsOf(after, va.view, readChanged));
    return;
  }
  const aActive = isActiveView(va.view);
  const bActive = isActiveView(vb.view);
  const toBast = after.assignee_id === BAST_USER_ID && (before === null || before.assignee_id !== BAST_USER_ID);
  const delegateWakeAfter = va.view === 'wake_delegate_comment';
  const onlyComments = nonSafe.length > 0 && nonSafe.every((f) => f === 'comments');

  let rule: ReachRule | null = null;
  let fields = nonSafe;
  if (aActive && !bActive) {
    fields = changed;
    if (before === null) rule = 'create_for_bast';
    else if (delegateWakeAfter) rule = 'wakes_delegate';
    else if (toBast) rule = 'hand_to_bast';
    else rule = 'starts_bast_task';
  } else if (aActive && bActive && (va.view !== vb.view || nonSafe.length > 0)) {
    fields = nonSafe.length > 0 ? nonSafe : changed;
    if (delegateWakeAfter) rule = vb.view === 'wake_delegate_comment' ? 'edits_woken_delegate_task' : 'wakes_delegate';
    else if (toBast) rule = 'hand_to_bast';
    else rule = onlyComments ? 'comment_on_bast_task' : 'resteers_bast_task';
  } else if (isBastHeldView(va.view) && nonSafe.length > 0) {
    if (before === null) rule = 'create_for_bast';
    else if (toBast) rule = 'hand_to_bast';
    else rule = onlyComments ? 'comment_on_bast_task' : 'edits_held_bast_task';
  } else if (va.view === 'delegate_quiet' && nonSafe.some((f) => DELEGATE_TEXT_FIELDS.includes(f))) {
    fields = nonSafe.filter((f) => DELEGATE_TEXT_FIELDS.includes(f));
    rule = 'edits_delegate_text';
  } else if (
    va.view === 'delegate_quiet' &&
    chatWritten &&
    (before === null || before.assignee_id !== after.assignee_id || workerView(before, now).view !== 'delegate_quiet')
  ) {
    fields = changed;
    rule = 'hands_chat_text_to_delegate';
  } else if (
    // Plan 4.2 R1 (any status) and acceptance item 9: rewriting a closed Bast task taps too, because the reopen that
    // follows shows the edited text and the card should have flagged it. Only a rewrite of the text counts: tags,
    // comments and a bare status change between closed states are not what the worker will read as the task's text.
    before !== null &&
    vb.view === 'none' &&
    va.view === 'none' &&
    before.assignee_id === BAST_USER_ID &&
    after.assignee_id === BAST_USER_ID &&
    (after.status === 'done' || after.status === 'abandoned') &&
    nonSafe.some((f) => READ_TEXT_FIELDS.includes(f))
  ) {
    rule = 'edits_held_bast_task';
  }
  if (rule === null) return;
  acc.hit(rule, after.id, `view ${vb.view} to ${va.view}; fields ${fields.join(', ')}`, fields, {
    view_before: vb.view,
    view_after: va.view,
  });
  acc.read(readsOf(after, va.view, readChanged));
}

function blockerRefOf(t: ReachTask): BlockerRef {
  return { id: t.id, title: t.title, status: t.status, approved: t.approved, ordering_only: t.ordering_only, last_comment_id: t.last_comment_id, assignee_id: t.assignee_id };
}

function withBlocker(d: ReachTask, ref: BlockerRef): ReachTask {
  if (d.blocked_by === undefined) return d;
  return { ...d, blocked_by: [...d.blocked_by.filter((b) => b.id !== ref.id), ref] };
}

/**
 * R2 on the tasks that wait on the changed task: each one a Bast session may read (Bast's, or one in a delegate's queue:
 * `sessionMayRead`, VERIFY-6 G1).
 */
function evaluateDependents(acc: Acc, before: ReachTaskWithDependents, after: ReachTask, changed: string[], now: Date): void {
  const relevant = changed.filter((f) => DEPENDENT_RELEVANT.includes(f));
  if (relevant.length === 0) return;
  if (before.dependents === undefined) {
    acc.hit('missing_data', before.id, 'missing: dependents (the tasks that wait on this one)', relevant);
    return;
  }
  const textChanged = relevant.filter((f) => f === 'comments' || READ_TEXT_FIELDS.includes(f));
  const releaseFields = relevant.filter((f) => !textChanged.includes(f));
  const refBefore = blockerRefOf(before);
  const refAfter = blockerRefOf(after);
  for (const d of before.dependents) {
    if (d.assignee_id === undefined) {
      acc.hit('missing_data', d.id, 'missing: assignee_id of a dependent', relevant);
      continue;
    }
    if (!isSessionHolder(d.assignee_id)) continue;
    const holder = holderOf(d.assignee_id);
    const db = withBlocker(d, refBefore);
    const da = withBlocker(d, refAfter);
    const vb = workerView(db, now);
    const va = workerView(da, now);
    const missing = uniq([...vb.missing, ...va.missing]);
    const readChanged = textChanged.map((f) => `blocker:${before.id}:${f}`);
    if (missing.length > 0) {
      acc.hit('missing_data', d.id, `dependent of ${before.id}, missing: ${missing.join(', ')}`, relevant, {
        view_before: vb.view,
        view_after: va.view,
        holder,
      });
      acc.read(readsOf(da, va.view, readChanged));
      continue;
    }
    const opened = isActiveView(va.view) && (!isActiveView(vb.view) || va.view !== vb.view);
    if (opened && releaseFields.length > 0) {
      acc.hit('releases_dependent', d.id, `waits on ${before.id}; view ${vb.view} to ${va.view}`, releaseFields, {
        view_before: vb.view,
        view_after: va.view,
        holder,
      });
      acc.read(readsOf(da, va.view, readChanged));
    } else if (sessionMayRead(va.view) && textChanged.length > 0) {
      acc.hit('changes_blocker_text', d.id, `waits on ${before.id}, whose ${textChanged.join(', ')} its session reads`, textChanged, {
        view_before: vb.view,
        view_after: va.view,
        holder,
      });
      acc.read(readsOf(da, va.view, readChanged));
    }
  }
}

/** R5 for a task. */
function evaluateClient(acc: Acc, before: ReachTask | null, after: ReachTask, changed: string[]): void {
  if (before !== null && !changed.some((f) => CLIENT_RELEVANT.includes(f))) return;
  if (before !== null) {
    const missing = CLIENT_VISIBILITY_FIELDS.filter((k) => before[k] === undefined);
    if (missing.length > 0) {
      acc.show('missing_data', `missing: ${missing.join(', ')}`, changed.filter((f) => CLIENT_RELEVANT.includes(f)), {
        task_id: after.id,
      });
      return;
    }
  }
  const visBefore = before ? isClientVisibleTask(before) : false;
  const visAfter = isClientVisibleTask(after);
  if (visAfter && !visBefore) {
    acc.show('shares_task', 'the task becomes visible in the client portal', changed, { task_id: after.id });
  } else if (before !== null && (visAfter || isShownInPortal(before)) && (changed.includes('client_id') || changed.includes('project_id') || changed.includes('site_id'))) {
    acc.show('moves_visible_task', 'a portal-visible task changes client, project or site', changed.filter((f) => f === 'client_id' || f === 'project_id' || f === 'site_id'), {
      task_id: after.id,
    });
  }
  // A task a client can read today (visible by any portal rule, or in their history) whose text, checklist or portal tags change: what the client reads
  // changes, so it is the owner's tap, whoever steered the chat. The fields are the list in lib/portal/client-rendered.ts.
  if (before !== null && isShownInPortal(before)) {
    const touched = renderedFieldsTouched(changed, { before: before.tags, after: after.tags }).filter((f) => f !== 'client_id' && f !== 'project_id' && f !== 'site_id');
    if (touched.length > 0) acc.show('edits_visible_task', 'a portal-visible task changes what the client reads', touched, { task_id: after.id });
  }
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export interface TaskChangeInput {
  current: ReachTaskWithDependents;
  change: TaskChange;
  now: Date;
  origin?: ReachOrigin;
  /** The task already carries text the chat lane wrote (a record, the from-chat tag, a chat comment). VERIFY-5 Z3. */
  chat_written?: boolean;
}

/**
 * VERIFY-5 Z3, from the worker skill (SKILL.md W1 342 to 363) and spawn-gate.py (`fetch_delegate_tasks`, statuses
 * not_started, blocked and in_progress): the delegate pass reads the whole thread, the description (and the source email
 * it links) and the arc of a task in a delegate's queue as soon as a person writes on it, and for content work it hands
 * the task to Bast and does it, reading all of it. So on a task in that queue, woken or quiet, the chat's TEXT is text a
 * Bast session may act on. These are the text fields; typed fields stay free (the owner's ruling), and the arc taps
 * only on a woken task (the delegate pass reads it then).
 */
const DELEGATE_TEXT_FIELDS: readonly string[] = ['title', 'description', 'requirements', 'notes', 'promised_to', 'tags', 'comments'];

/**
 * A PATCH of one task (S1-C4), or the restore an Undo would write (S1-C5, pass origin 'undo'), or a
 * stored plan recomputed at tap time. `current` is the row as read now, with its dependents.
 */
export function checkTaskChange(input: TaskChangeInput): ReachResult {
  const acc = new Acc(input.origin === 'undo');
  const { current, change } = input;
  if (!current || typeof current.id !== 'string') {
    acc.hit('missing_data', null, 'missing: the current task', Object.keys(change ?? {}));
    return acc.result();
  }
  for (const key of Object.keys(change)) {
    if (change[key] !== undefined && !KNOWN_CHANGE_KEYS.includes(key)) {
      acc.hit('unknown_field', current.id, `field ${key} has no reach rule`, [key]);
    }
  }
  if (current.status !== undefined && !TASK_STATUSES.includes(current.status)) {
    acc.hit('unknown_status', current.id, `current status ${current.status}`, ['status']);
  }
  if (change.status !== undefined && !TASK_STATUSES.includes(change.status)) {
    acc.hit('unknown_status', current.id, `planned status ${change.status}`, ['status']);
  }
  const after = applyChange(current, change);
  const changed = changedFields(current, change);
  evaluateSelf(acc, current, after, changed, change, input.now, input.chat_written === true);
  evaluateDependents(acc, current, after, changed, input.now);
  evaluateDependentTitle(acc, current, changed);
  evaluateClient(acc, current, after, changed);
  return acc.result();
}

/**
 * The reverse of R2 (VERIFY-3 field table): a session on a Bast task reads, in GET /api/tasks/:id, the titles of the
 * tasks that wait on it (`blocking`); so does the delegate pass on a task in a delegate's queue (VERIFY-6 G1). So
 * retitling a task that waits on such a task re-steers it. The same rule for both holders (`isSessionHolder`): any of
 * their blockers counts, closed ones too (a done task in review can wake, a delegate's task can be reopened).
 */
function evaluateDependentTitle(acc: Acc, current: ReachTask, changed: string[]): void {
  if (!changed.includes('title')) return;
  if (current.blocked_by === undefined) {
    acc.hit('missing_data', current.id, 'missing: blocked_by (whose session lists this title)', ['title']);
    return;
  }
  for (const b of current.blocked_by) {
    if (b.assignee_id === undefined) {
      acc.hit('missing_data', b.id, 'missing: assignee_id of a task this one waits on', ['title']);
      continue;
    }
    if (isSessionHolder(b.assignee_id)) acc.hit('changes_dependent_title', b.id, `waits on ${b.id}, whose session lists this title`, ['title'], { holder: holderOf(b.assignee_id) });
  }
}

/** Undo (R6): the same check on the state the Undo would restore. `restore` is the before-values it writes. */
export function checkUndo(input: { current: ReachTaskWithDependents; restore: TaskChange; now: Date; chat_written?: boolean }): ReachResult {
  return checkTaskChange({ current: input.current, change: input.restore, now: input.now, origin: 'undo', chat_written: input.chat_written });
}

export interface TaskCreateInput {
  /** The new row as the route will write it. `id` may be a placeholder. */
  task: ReachTask;
  /**
   * True when `task.assignee_id` is the assignee the route resolved (POST /api/tasks auto-assigns from
   * the project's function, the SOP's function or the arc when no assignee is sent, route.ts 452 to 480).
   */
  assignee_resolved: boolean;
  now: Date;
  origin?: ReachOrigin;
}

const CREATE_DEFAULTS: Partial<ReachTask> = {
  status: 'not_started',
  tags: [],
  needs_review: false,
  approved: false,
  client_approved_at: null,
  lease_until: null,
  last_comment_author: 'none',
  blocked_by: [],
  client_visible: false,
  requested_by_contact_id: null,
  staging_preview_url: null,
};

/** POST /api/tasks from the chat (1.3), and start_project and start_quote records (R7). */
export function checkTaskCreate(input: TaskCreateInput): ReachResult {
  const acc = new Acc(input.origin === 'undo');
  const given = input.task as unknown as Record<string, unknown>;
  const defined = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined));
  const after = { ...CREATE_DEFAULTS, ...defined } as ReachTask;
  if (after.assignee_id === undefined) after.assignee_id = null;
  if (!input.assignee_resolved && !after.assignee_id && (after.project_id || after.arc_id || after.sop_id)) {
    acc.hit('missing_data', after.id, 'missing: the assignee the route resolves (project function, SOP or arc)', ['assignee_id']);
  }
  if (after.status !== undefined && !TASK_STATUSES.includes(after.status)) {
    acc.hit('unknown_status', after.id, `planned status ${after.status}`, ['status']);
  }
  const changed = Object.keys(defined).filter((k) => k !== 'id' && k !== 'dependents');
  if (after.assignee_id && !changed.includes('assignee_id')) changed.push('assignee_id');
  evaluateSelf(acc, null, after, changed.length > 0 ? changed : ['assignee_id'], {}, input.now);
  evaluateClient(acc, null, after, changed);
  return acc.result();
}

export interface CommentInput {
  task: ReachTaskWithDependents;
  /** `add` a new comment, or `hide` one (is_deleted, how Undo removes a chat comment). */
  action: 'add' | 'hide';
  /** Author of an added comment. Chat comments are written by the Bast user, so `bot` (the default). */
  added_author?: CommentAuthorKind;
  /** For `hide`: who wrote the newest comment that is still visible once this one is hidden. */
  last_comment_author_after?: CommentAuthorKind;
  /** For `hide`: the newest visible comment id once this one is hidden (null when none). */
  last_comment_id_after?: string | null;
  now: Date;
  origin?: ReachOrigin;
}

/** The `task_comment` op and its Undo. Every session reads the thread (W2 line 398, W3 line 417). */
export function checkComment(input: CommentInput): ReachResult {
  const acc = new Acc(input.origin === 'undo');
  const { task } = input;
  const lastAfter = input.action === 'add' ? (input.added_author ?? 'bot') : input.last_comment_author_after;
  if (lastAfter === undefined) {
    acc.hit('missing_data', task.id, 'missing: last_comment_author_after for a hidden comment', ['comments']);
  }
  // An added comment has no id yet: mark it on top of the id it lands after, so another comment that slips in
  // before the tap still changes the fingerprint. A hidden one carries the id that becomes newest.
  const lastIdAfter =
    input.action === 'add'
      ? `${task.last_comment_id ?? ''}+new`
      : input.last_comment_id_after !== undefined
        ? input.last_comment_id_after
        : `${task.last_comment_id ?? ''}-hidden`;
  const after: ReachTask = { ...task, last_comment_author: lastAfter, last_comment_id: lastIdAfter };
  delete (after as ReachTaskWithDependents).dependents;
  evaluateSelf(acc, task, after, ['comments'], {}, input.now);
  evaluateDependents(acc, task, after, ['comments'], input.now);
  return acc.result();
}

export interface OpInput {
  op: ReachOp;
  now: Date;
  origin?: ReachOrigin;
}

/** Non-task ops (S1-C6). Undo of an op passes the inverse op with origin 'undo'. */
export function checkOp(input: OpInput): ReachResult {
  const acc = new Acc(input.origin === 'undo');
  const op = input.op;
  switch (op.op) {
    case 'home_act':
      // runHomeAct writes only the owner's home rows (lib/home/act.ts 8 to 12); the worker never reads them.
      break;
    case 'triage_release': {
      // Same rule as a task change that hands a task to Bast (R1 hand_to_bast), judged on the text: only client-written text taps.
      for (const c of op.cards) {
        if (c.client_text === undefined) acc.hit('missing_data', c.task_id, 'missing: whether the card carries client text', ['status', 'assignee_id']);
        else if (c.client_text) acc.hit('hand_to_bast', c.task_id, 'a Triage release hands a card with client mail text to Bast', ['status', 'assignee_id', 'tags']);
      }
      break;
    }
    case 'email_ask_state':
      // No worker session reads ask state; the classifier only marks drafts and resolves asks mechanically.
      break;
    case 'project_status': {
      // The worker's queue query has no project filter for Bast (not a tech user): no worker reach.
      const after = op.status_after;
      if (after === undefined || !PROJECT_STATUSES.includes(after)) {
        acc.show('unknown_status', `planned project status ${String(after)}`, ['status'], { project_id: op.project_id });
        break;
      }
      // A project status never stops the chat for the portal (Mike, 2026-11-13: nothing is refused only because the portal would show it).
      break;
    }
    case 'wait_change': {
      const action = op.action;
      if (action !== undefined && WAIT_STOP_ACTIONS.includes(action)) break;
      if (action === 'complete') {
        // `completed` advances the chain: resolveWait opens the next step, which may file a Bast task or send to a client.
        if (!op.open_after) break;
        if (op.owner_is_bast_after === undefined) {
          acc.hit('missing_data', null, 'missing: owner_is_bast_after of the next step', [action], { wait_id: op.wait_id });
          break;
        }
        if (op.owner_is_bast_after) {
          acc.hit('wait_for_bast', null, 'wait complete: the next step of the chain opens owned by Bast', [action], { wait_id: op.wait_id });
        }
        if (op.next_action === 'send') {
          acc.show('wait_sends', 'wait complete: the next step of the chain sends to a client', [action], {});
        }
        break;
      }
      if (action === undefined || !WAIT_MOVE_ACTIONS.includes(action)) {
        acc.hit('unknown_op', null, `wait action ${String(action)} has no reach rule`, ['action'], { wait_id: op.wait_id });
        break;
      }
      if (op.open_after === undefined || op.owner_is_bast_after === undefined) {
        acc.hit('missing_data', null, 'missing: open_after or owner_is_bast_after of the wait', [action], { wait_id: op.wait_id });
        break;
      }
      if (op.open_after && op.owner_is_bast_after) {
        acc.hit('wait_for_bast', null, `wait ${action}: open and owned by Bast, so its task step files a Bast task`, [action], {
          wait_id: op.wait_id,
        });
      }
      break;
    }
    default: {
      const unknown = op as { op?: unknown };
      acc.hit('unknown_op', null, `operation ${String(unknown.op)} has no reach rule`, []);
    }
  }
  return acc.result();
}

export type ReachInput =
  | ({ kind: 'task_patch' } & TaskChangeInput)
  | ({ kind: 'task_create' } & TaskCreateInput)
  | ({ kind: 'comment' } & CommentInput)
  | ({ kind: 'op' } & OpInput);

/** One entry point for every caller: the task routes, the ops route, Undo and the tap. */
export function checkReach(input: ReachInput): ReachResult {
  switch (input.kind) {
    case 'task_patch':
      return checkTaskChange(input);
    case 'task_create':
      return checkTaskCreate(input);
    case 'comment':
      return checkComment(input);
    case 'op':
      return checkOp(input);
    default: {
      const acc = new Acc(false);
      acc.hit('unknown_op', null, `input kind ${String((input as { kind?: unknown }).kind)} has no reach rule`, []);
      return acc.result();
    }
  }
}

/**
 * A stable fingerprint of what a result starts, reads and shows. The tap (plan 4.2 step 3) recomputes the
 * reach from the current rows and refuses unless this equals the stored one: a retitle, a rewrite, a status
 * change or a new dependent between the proposal and the tap changes it.
 */
export function reachFingerprint(r: ReachResult): string {
  const starts = r.starts
    .map((h) => [h.rule, h.task_id ?? '', h.wait_id ?? '', h.view_after ?? ''].join('|'))
    .sort();
  const reads = [...r.reads]
    .sort((a, b) => a.task_id.localeCompare(b.task_id))
    .map((x) => ({
      id: x.task_id,
      view: x.view,
      title: x.title,
      description: x.description,
      requirements: x.requirements,
      notes: x.notes,
      tags: x.tags ? [...x.tags].sort() : null,
      status: x.status,
      site_id: x.site_id,
      project_id: x.project_id,
      client_id: x.client_id,
      sop_id: x.sop_id,
      blocked_by: x.blocked_by ? x.blocked_by.map((b) => `${b.id}:${b.status ?? ''}:${b.last_comment_id ?? ''}`).sort() : null,
      last: x.last_comment_author,
      last_id: x.last_comment_id,
    }));
  const shows = r.shows_client.map((c) => [c.rule, c.task_id ?? '', c.project_id ?? ''].join('|')).sort();
  return stableStringify({ starts, reads, shows });
}
