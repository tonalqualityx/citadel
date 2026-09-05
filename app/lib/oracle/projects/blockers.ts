import { BOT_USER_IDS, MIKE_USER_ID } from './gate-constants';

// Oracle Projects Tab Phase 2 — classifyProjectBlockers is a pure function: no Prisma, no
// React, no clock reads (now is always passed in). Every field it needs is plain data the
// route (app/api/oracle/projects/route.ts) gathers and shapes beforehand — this module
// only ever answers "given this project's world as of `now`, what's blocking it and who
// owns each blocker."

export interface BlockerProject {
  id: string;
  name: string;
  client: { id: string; name: string } | null;
}

export interface BlockerLastComment {
  id: string;
  user_id: string;
  user_name: string;
  created_at: string; // ISO
  content_excerpt: string;
}

export interface BlockerTask {
  id: string;
  title: string;
  status: string;
  tags: string[];
  needs_review: boolean;
  approved: boolean;
  assignee_id: string | null;
  assignee_name: string | null;
  sop_title: string | null;
  updated_at: string; // ISO
  blocked_by_ids: string[];
  phase_sort: number;
  sort_order: number;
  last_comment: BlockerLastComment | null;
  // MEDIUM-3: the arc this task is ALREADY attached to, if any — carried through onto
  // every task-sourced Blocker below so the pick-to-arc dialogs can flag "already in
  // arc X" instead of silently re-homing a task that's mid-flight in a different arc.
  arc: { id: string; name: string } | null;
}

export interface BlockerMention {
  id: string;
  task_id: string;
  author: { id: string; name: string };
  created_at: string; // ISO
  excerpt: string;
}

export interface BlockerSessionAsk {
  session_external_id: string;
  queue: string | null;
  text: string | null;
  severity: string | null;
  waiting_since: string | null; // ISO
}

export interface BlockerEmail {
  id: string;
  from: string;
  subject: string;
  gist: string | null;
  received_at: string; // ISO
  // Computed upstream: a later message from Mike exists in the thread, OR state != open.
  replied: boolean;
  // LOW-8: the EmailAsk's own Gmail deep_link — used as the blocker's source.url instead
  // of an API-only /email-asks/{id} path, which is nothing a human can actually open.
  deep_link: string;
}

export type ApprovalRequestStatus =
  | 'draft'
  | 'queued'
  // Phase 5 fixes (HIGH-1/MEDIUM-1, layer 2) — the machine-side sender's own claim,
  // stamped by PUT /api/approval-requests/:id/sending BEFORE gog is ever invoked. See
  // classifyClientApprovals below for how a row stuck here surfaces to Mike.
  | 'sending'
  | 'sent'
  | 'replied'
  | 'approved'
  | 'changes_requested'
  | 'cancelled';

export interface BlockerApprovalRequest {
  id: string;
  task_id: string;
  status: ApprovalRequestStatus;
  sent_at: string | null; // ISO
  chase_after_days: number;
  replied_at: string | null; // ISO
  // MEDIUM-7: always present (the row's own creation time) — the final fallback for
  // `since` so a draft/queued approval actually ages instead of reporting "now" forever.
  created_at: string; // ISO
  // Phase 5 fixes (HIGH-1/MEDIUM-1) — stamped only while status is 'sending'; null
  // otherwise. Drives the "stuck in flight" surfacing in classifyClientApprovals.
  send_attempt_at: string | null; // ISO
  contact: { id: string; name: string; email?: string | null } | null;
  // Spec polish (2026-09-04) — the recipient email on the row itself, when no
  // ClientContact was picked (a plain to_email). Feeds a follow-up chase's own
  // recipient when `contact` is null. Optional (defaults to null) so every pre-existing
  // test fixture in this module stays valid without a mechanical update.
  to_email?: string | null;
  // Spec polish (2026-09-04) — distinguishes an original approval request from a
  // follow-up chase (see the ApprovalRequestKind schema doc comment). A 'chase' row
  // never produces its OWN client_approval blocker — classifyClientApprovals below
  // skips it entirely, so a queued chase never appears as a second, duplicate blocker
  // for the same task. Optional, defaulting to 'approval' (every row was one before
  // this field existed).
  kind?: 'approval' | 'chase';
}

export interface BlockerCalendarEvent {
  id: string;
  title: string;
  starts_at: string; // ISO
}

export interface BlockerTimeEntry {
  started_at: string; // ISO
}

export interface BlockerDismissal {
  kind: string;
  source_id: string;
  source_marker: string | null;
  dismissed_at: string; // ISO
}

// The graph's chosen next-step task, with a best-available "since" proxy for how long its
// assignee has held it (the caller passes the task's own updated_at — see
// next-step-candidate.ts and the route's assembly of this input).
export interface BlockerNextStepCandidate {
  task_id: string;
  assignee_id: string | null;
  assignee_name: string | null;
  since: string; // ISO
}

export interface ClassifyProjectBlockersInput {
  project: BlockerProject;
  tasks: BlockerTask[];
  // Pre-filtered upstream: comments mentioning Mike with no LATER reply by Mike.
  mentions: BlockerMention[];
  session_asks: BlockerSessionAsk[];
  // Pre-filtered/shaped upstream: `replied` already accounts for a later Mike message OR
  // state != open — this module only asks "is replied false."
  emails: BlockerEmail[];
  approval_requests: BlockerApprovalRequest[];
  // Pre-filtered upstream to events with the client in the next 3 days.
  calendar_events: BlockerCalendarEvent[];
  time_entries: BlockerTimeEntry[];
  dismissals: BlockerDismissal[];
  next_step_candidate: BlockerNextStepCandidate | null;
  // From movement.ts's lastMovement(...).at, computed upstream — null if there has never
  // been positive movement on this project.
  last_movement_at: string | null;
  stale_muted_until: string | null; // ISO
}

export type BlockerKind =
  | 'decision'
  | 'clarification'
  | 'review'
  | 'session_ask'
  | 'mention'
  | 'client_email'
  | 'client_approval'
  | 'someone_else'
  | 'stale'
  | 'meeting_risk';

export interface BlockerOwner {
  id: string;
  name: string;
  is_mike: boolean;
}

export interface BlockerSource {
  type: string;
  id: string;
  url: string;
}

export type BlockerAction =
  | 'reply'
  | 'approve'
  | 'request_changes'
  | 'resolve_ask'
  | 'dismiss'
  | 'pick'
  | 'open_task'
  | 'open_email'
  | 'send_approval'
  | 'mark_approved'
  | 'nudge'
  | 'refresh_next_step'
  | 'suspend'
  // Phase 5 tail fixes (MEDIUM-A) — the two Mike-gated manual overrides for a
  // 'sending' row stuck past SENDING_STUCK_THRESHOLD_MINUTES. See
  // classifyClientApprovals below and ApprovalPanel.tsx (which is where these are
  // actually actioned once Mike opens the task) for the full guard these belong to.
  | 'mark_sent_manually'
  | 'release_to_draft';

export interface Blocker {
  kind: BlockerKind;
  id: string;
  title: string;
  detail: string;
  owner: BlockerOwner;
  source: BlockerSource;
  since: string; // ISO
  actions: BlockerAction[];
  // MEDIUM-3: the arc this blocker's task is already attached to, when source.type is
  // 'task' and that task has one. Always null for a non-task-sourced blocker (nothing to
  // re-home yet — a task doesn't exist until the pick creates one).
  arc: { id: string; name: string } | null;
  // Phase 5 — client_approval only: when the ApprovalRequest is 'sent', the instant the
  // chase clock runs out (sent_at + chase_after_days business days). Null for every
  // other kind, and for a client_approval blocker that hasn't been sent yet (draft/
  // queued/replied have no chase clock running).
  chase_due_at: string | null; // ISO
  // Phase 5 — client_approval only, and only once chase_due_at has passed: a short,
  // plain chase-email draft ApprovalPanel/NudgePanel can offer as a starting point.
  // Never sent from here — this module never performs I/O.
  chase_draft: { subject: string; body: string } | null;
  // Spec polish (2026-09-04) — populated in lockstep with chase_draft (same overdueChase
  // gate; null whenever chase_draft is null): what the UI needs to actually queue a
  // chase without re-deriving it — the task to attach the new ApprovalRequest row to,
  // and who it goes to (a ClientContact id when one was picked, else a plain email).
  // BlockerRow's "Queue chase from my Gmail" reuses this to POST /api/approval-requests
  // {task_id, contact_id, to_email, subject, body, kind:'chase'} then PATCH .../[id]
  // {status:'queued'} — the same two existing endpoints, just a new kind value.
  chase_target: { task_id: string; contact_id: string | null; email: string | null } | null;
  // Phase 5 — the EXACT (kind, source_id, source_marker) triple this blocker's own
  // isDismissed(...) call above checks, so BlockerRow's Dismiss control never has to
  // re-derive or duplicate that mapping (and can't drift from it). Null for every kind
  // DISMISSAL_KIND_BY_BLOCKER_KIND doesn't cover (decision, clarification,
  // client_approval, someone_else) — those resolve only through their own state
  // changes, never a bare dismiss.
  dismiss: { kind: string; source_id: string; source_marker: string | null } | null;
}

const STALE_DAYS_THRESHOLD = 7;
const MEETING_RISK_WINDOW_DAYS = 3;
// Phase 5 fixes (HIGH-1/MEDIUM-1, layer 2) — how long a 'sending' row can sit claimed
// with no PUT .../sent on file before it stops being "the sender is presumably still
// mid-flight" and starts being "something went wrong and nobody's looking at it."
// Exported: PATCH /api/approval-requests/[id] (Phase 5 tail fixes, MEDIUM-A) imports
// this SAME constant to gate its two Mike-only manual overrides — the blocker's own
// "past due" line and the route's own "old enough to safely override" line must never
// drift apart.
export const SENDING_STUCK_THRESHOLD_MINUTES = 30;
const MEETING_RISK_STILLNESS_DAYS = 5;
// HIGH-1: decision/clarification/mention are asks for a LIVE task — a task already
// done or abandoned can't still be waiting on Mike's word, no matter what its last
// comment or an old @-mention says. Review is the mirror image (it only ever fires on
// `done`, checked in classifyReview itself) — these two rules together are what keeps a
// finished task from generating a blocker forever.
// WARNING: 'ready' is NOT a value of the Prisma `TaskStatus` enum (not_started,
// in_progress, review, done, blocked, abandoned — see prisma/schema.prisma) and a
// task's `status` field can never equal it. It must never be sent as a query value to
// `GET /api/tasks?statuses=...` — the machine-side next-step job hit exactly this bug
// (a bare `ready` in its status list 500'd every real call, fixed separately in
// next-step-refresh.py). Removed from this Set (K5): nothing in this repo's tests
// depends on it being present, and leaving a non-enum value in a status allowlist is a
// standing invitation for someone to copy it into a real query param.
const OPEN_TASK_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'review']);
// Blocker kinds a human can explicitly dismiss (mirrors prisma's BlockerDismissalKind
// enum, which deliberately excludes decision/clarification/client_approval/someone_else —
// those resolve only through their own state changes: a tag/comment change, an approval
// status change, or a reassignment/completion, never a bare "hide this" click).
const DISMISSAL_KIND_BY_BLOCKER_KIND: Partial<Record<BlockerKind, string>> = {
  mention: 'mention',
  client_email: 'email',
  session_ask: 'session_ask',
  review: 'task',
  meeting_risk: 'meeting_risk',
  stale: 'stale',
};

// Client emails asking "any update?" get flagged distinctly when there's also been no
// time logged since they arrived — that combination ("asked, and nothing's moved") is
// the actually-alarming case, not just any status-shaped subject line.
const STATUS_ASK_RE = /status|update|where are we|any news/i;

function mikeOwner(): BlockerOwner {
  return { id: MIKE_USER_ID, name: 'Mike', is_mike: true };
}

function isDismissed(
  dismissals: BlockerDismissal[],
  blockerKind: BlockerKind,
  sourceId: string,
  marker: string | null
): boolean {
  const dismissalKind = DISMISSAL_KIND_BY_BLOCKER_KIND[blockerKind];
  if (!dismissalKind) return false; // this kind is never dismissible
  return dismissals.some(
    (d) => d.kind === dismissalKind && d.source_id === sourceId && (d.source_marker ?? '') === (marker ?? '')
  );
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

// Simple deterministic djb2 string hash, hex-encoded — used as a stable "has this ask's
// text changed" marker for session_ask dismissals. Session asks have no row id of their
// own that changes when the ask text changes, so the text itself (hashed, to bound
// length/avoid embedding raw ask content in the dismissal ledger) is the marker.
function hashAskText(text: string | null): string {
  const input = text ?? '';
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

// Business-day arithmetic (Mon-Fri only, no holiday calendar — a deliberate simplification
// documented in the Phase 2 notes) for the approval-chase overdue check.
function businessDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

function taskSource(taskId: string): BlockerSource {
  return { type: 'task', id: taskId, url: `/tasks/${taskId}` };
}

// Phase 5 — the inverse of businessDaysBetween: adds N business days (Mon-Fri only, same
// no-holiday-calendar simplification) to a starting instant. Used to compute the
// client_approval blocker's chase_due_at, so the UI can show "chase due Sep 10" rather
// than only the after-the-fact "N days overdue" detail text.
function addBusinessDays(from: Date, days: number): Date {
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  let added = 0;
  while (added < days) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return cur;
}

// Phase 5 — the short, plain chase-email draft attached to an overdue client_approval
// blocker. Never sent by itself: ApprovalPanel/NudgePanel offer it as a starting point
// for a fresh queued send. Kept here (not imported from lib/services/approval-requests.ts)
// so this pure module stays free of any non-pure dependency; the two templates are
// deliberately the same shape as lib/services/approval-requests.ts's buildChaseEmailDraft,
// which the approval-requests API routes use for the same purpose server-side.
function buildChaseEmailDraft(taskTitle: string, chaseAfterDays: number): { subject: string; body: string } {
  const subject = `Following up: ${taskTitle}`;
  const body = [
    `Hi,`,
    ``,
    `Checking in on ${taskTitle}. I sent this over ${chaseAfterDays} business day${
      chaseAfterDays === 1 ? '' : 's'
    } ago and have not heard back.`,
    ``,
    `Let me know if you have questions, or if this is ready to approve.`,
    ``,
    `Mike`,
  ].join('\n');
  return { subject, body };
}

// Returns both the blockers AND the set of comment ids they were built from — MEDIUM-4
// needs that set so classifyMentions never ALSO emits a mention blocker for the exact
// same comment (a comment that's both a task's last comment, tagged needs-mike/
// awaiting-clarification, AND happens to @-mention Mike would otherwise double-count).
function classifyDecisionAndClarification(
  input: ClassifyProjectBlockersInput
): { blockers: Blocker[]; consumedCommentIds: Set<string> } {
  const out: Blocker[] = [];
  const consumedCommentIds = new Set<string>();
  for (const task of input.tasks) {
    if (!OPEN_TASK_STATUSES.has(task.status)) continue; // HIGH-1: never on a done/abandoned task
    if (!task.last_comment) continue;
    if (!BOT_USER_IDS.includes(task.last_comment.user_id)) continue;

    let kind: BlockerKind | null = null;
    if (task.tags.includes('needs-mike')) {
      kind = 'decision';
    } else if (task.tags.includes('awaiting-clarification')) {
      kind = 'clarification';
    }
    if (!kind) continue;

    consumedCommentIds.add(task.last_comment.id);
    out.push({
      kind,
      id: `${kind}:${task.id}`,
      title: task.title,
      detail: task.last_comment.content_excerpt,
      owner: mikeOwner(),
      source: taskSource(task.id),
      since: task.last_comment.created_at,
      actions: ['reply', 'open_task'],
      arc: task.arc,
      chase_due_at: null,
      chase_draft: null,
      chase_target: null,
      dismiss: null,
    });
  }
  return { blockers: out, consumedCommentIds };
}

function classifyReview(input: ClassifyProjectBlockersInput): Blocker[] {
  const out: Blocker[] = [];
  for (const task of input.tasks) {
    if (task.status !== 'done' || !task.needs_review || task.approved) continue;
    if (isDismissed(input.dismissals, 'review', task.id, task.updated_at)) continue;

    out.push({
      kind: 'review',
      id: `review:${task.id}`,
      title: task.title,
      detail:
        task.last_comment?.content_excerpt ??
        `Marked done. Needs your review${task.sop_title ? ` (${task.sop_title})` : ''}.`,
      owner: mikeOwner(),
      source: taskSource(task.id),
      since: task.updated_at,
      actions: ['approve', 'request_changes', 'open_task', 'dismiss'],
      arc: task.arc,
      chase_due_at: null,
      chase_draft: null,
      chase_target: null,
      dismiss: { kind: 'task', source_id: task.id, source_marker: task.updated_at },
    });
  }
  return out;
}

function classifySessionAsks(input: ClassifyProjectBlockersInput): Blocker[] {
  const out: Blocker[] = [];
  for (const ask of input.session_asks) {
    const marker = hashAskText(ask.text);
    if (isDismissed(input.dismissals, 'session_ask', ask.session_external_id, marker)) continue;

    out.push({
      kind: 'session_ask',
      id: `session_ask:${ask.session_external_id}`,
      title: ask.text ?? 'A session is waiting on you',
      detail: ask.text ?? '',
      owner: mikeOwner(),
      // LOW-8: /oracle/sessions/{id} is an API-only path, nothing a human can open. The
      // Needs Reshi surface (/oracle) is where session asks actually render; the session
      // id rides along as a query param for the UI to pick up and deep-link into later.
      source: { type: 'session', id: ask.session_external_id, url: `/oracle?session=${ask.session_external_id}` },
      since: ask.waiting_since ?? new Date(0).toISOString(),
      actions: ['reply', 'resolve_ask', 'dismiss'],
      arc: null,
      chase_due_at: null,
      chase_draft: null,
      chase_target: null,
      dismiss: { kind: 'session_ask', source_id: ask.session_external_id, source_marker: marker },
    });
  }
  return out;
}

function classifyMentions(input: ClassifyProjectBlockersInput, consumedCommentIds: Set<string>): Blocker[] {
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const out: Blocker[] = [];
  for (const mention of input.mentions) {
    if (consumedCommentIds.has(mention.id)) continue; // MEDIUM-4: already a decision/clarification

    const task = taskById.get(mention.task_id);
    // HIGH-1: fail-safe — an unknown task is treated as not-open, same as done/abandoned.
    if (!task || !OPEN_TASK_STATUSES.has(task.status)) continue;

    if (isDismissed(input.dismissals, 'mention', mention.id, mention.id)) continue;

    out.push({
      kind: 'mention',
      id: `mention:${mention.id}`,
      title: `${mention.author.name} mentioned you`,
      detail: mention.excerpt,
      owner: mikeOwner(),
      source: taskSource(mention.task_id),
      since: mention.created_at,
      actions: ['reply', 'open_task', 'dismiss'],
      arc: task.arc,
      chase_due_at: null,
      chase_draft: null,
      chase_target: null,
      dismiss: { kind: 'mention', source_id: mention.id, source_marker: mention.id },
    });
  }
  return out;
}

function classifyClientEmails(input: ClassifyProjectBlockersInput): Blocker[] {
  const out: Blocker[] = [];
  for (const email of input.emails) {
    if (email.replied) continue;
    if (isDismissed(input.dismissals, 'client_email', email.id, email.received_at)) continue;

    const askedForStatus = STATUS_ASK_RE.test(`${email.subject} ${email.gist ?? ''}`);
    const receivedAt = new Date(email.received_at);
    const noTimeSince = !input.time_entries.some((te) => new Date(te.started_at) > receivedAt);
    const flag = askedForStatus && noTimeSince;

    out.push({
      kind: 'client_email',
      id: `client_email:${email.id}`,
      title: email.subject,
      detail: flag
        ? `${email.gist ?? email.subject}. Asks for status. No time logged since.`
        : (email.gist ?? email.subject),
      owner: mikeOwner(),
      // LOW-8: /email-asks/{id} is an API-only path — the deep_link is the actual Gmail
      // message a human can open.
      source: { type: 'email', id: email.id, url: email.deep_link },
      since: email.received_at,
      actions: ['reply', 'open_email', 'dismiss'],
      arc: null,
      chase_due_at: null,
      chase_draft: null,
      chase_target: null,
      dismiss: { kind: 'email', source_id: email.id, source_marker: email.received_at },
    });
  }
  return out;
}

function classifyClientApprovals(input: ClassifyProjectBlockersInput, now: Date): Blocker[] {
  const out: Blocker[] = [];
  const openStatuses: ApprovalRequestStatus[] = ['draft', 'queued', 'sent', 'replied'];
  for (const ar of input.approval_requests) {
    // Spec polish (2026-09-04) — a 'chase' row is a follow-up ATTACHED to the original
    // approval, never a client_approval blocker in its own right (see the
    // ApprovalRequestKind schema doc comment and BlockerApprovalRequest.kind above). A
    // queued chase is sent by the exact same machine-side sender as any other row —
    // this skip only affects what shows up as a BLOCKER on the Projects tab, never
    // whether the row actually gets sent.
    if ((ar.kind ?? 'approval') === 'chase') continue;
    // Phase 5 fixes (HIGH-1/MEDIUM-1, layer 2) — a 'sending' row is the machine-side
    // sender actively mid-flight (or, per its own layer-3 retry-recording, an email it
    // already confirmed delivered but hasn't finished RECORDING as sent yet) — not a
    // blocker on its own. Only surface it once it's been claimed for longer than the
    // stuck threshold with no PUT .../sent on file: "Approval send unconfirmed," owned
    // by Mike.
    //
    // Phase 5 TAIL fixes (MEDIUM-A) — this used to carry actions:[] on the theory that
    // nobody, human or machine, should blindly resend an id that may already have gone
    // out, and Mike's only remedy was to check gog/Gmail directly with no button at all
    // — which left a row stuck here with NO human exit whatsoever (PATCH refuses every
    // transition, no blocker action, no way out short of a raw DB edit). Now carries
    // ['mark_sent_manually', 'release_to_draft'] — both still require Mike to have
    // actually checked Gmail first (the actions are a route into
    // PATCH /api/approval-requests/[id]'s two Mike-gated overrides, never an auto-
    // resend), and both are additionally gated server-side on send_attempt_at being
    // older than SENDING_STUCK_THRESHOLD_MINUTES (a live send can't be interrupted by
    // either). The real UI for these is ApprovalPanel.tsx, once Mike opens the task —
    // this blocker's own row-level actions are the discovery path, not a second
    // implementation of the transition itself.
    if (ar.status === 'sending') {
      const attemptAt = ar.send_attempt_at ? new Date(ar.send_attempt_at) : new Date(ar.created_at);
      const stuckMinutes = (now.getTime() - attemptAt.getTime()) / 60000;
      if (stuckMinutes < SENDING_STUCK_THRESHOLD_MINUTES) continue;

      const taskTitle = input.tasks.find((t) => t.id === ar.task_id)?.title ?? 'this';
      out.push({
        kind: 'client_approval',
        id: `client_approval:${ar.id}`,
        title: 'Client approval',
        detail: `Approval send unconfirmed for ${taskTitle}. The sender claimed this row over ${SENDING_STUCK_THRESHOLD_MINUTES} minutes ago with no confirmed delivery. Check gog/Gmail before acting; do not resend.`,
        owner: mikeOwner(),
        source: { type: 'approval_request', id: ar.id, url: `/tasks/${ar.task_id}` },
        since: attemptAt.toISOString(),
        actions: ['mark_sent_manually', 'release_to_draft'],
        arc: null,
        chase_due_at: null,
        chase_draft: null,
        chase_target: null,
        dismiss: null,
      });
      continue;
    }
    if (!openStatuses.includes(ar.status)) continue;

    const overdueChase =
      ar.status === 'sent' && !!ar.sent_at && businessDaysBetween(new Date(ar.sent_at), now) >= ar.chase_after_days;
    const mikeOwns = ar.status === 'draft' || ar.status === 'queued' || ar.status === 'replied' || overdueChase;

    const owner: BlockerOwner = mikeOwns
      ? mikeOwner()
      : ar.contact
        ? { id: ar.contact.id, name: ar.contact.name, is_mike: false }
        : mikeOwner();

    const detail = mikeOwns
      ? ar.status === 'replied'
        ? 'Client replied. Read the reply, then approve or request changes.'
        : overdueChase
          ? `Sent, no reply after ${ar.chase_after_days} business day${ar.chase_after_days === 1 ? '' : 's'}. Chase it.`
          : 'Draft ready to send for approval'
      : `Awaiting ${ar.contact?.name ?? 'the client'}'s reply`;

    // Phase 5 — the chase clock. chase_due_at is only meaningful once the request has
    // actually been sent (draft/queued/replied have no clock running); chase_draft is
    // only populated once that clock has actually run out (overdueChase), matching the
    // detail text's own "Chase it" branch above.
    const chaseDueAt = ar.status === 'sent' && ar.sent_at ? addBusinessDays(new Date(ar.sent_at), ar.chase_after_days) : null;
    const taskTitle = input.tasks.find((t) => t.id === ar.task_id)?.title ?? 'this';

    out.push({
      kind: 'client_approval',
      id: `client_approval:${ar.id}`,
      title: 'Client approval',
      detail,
      owner,
      source: { type: 'approval_request', id: ar.id, url: `/tasks/${ar.task_id}` },
      // MEDIUM-7: created_at (never null) is the final fallback, not `now` — a draft/
      // queued approval that's never been sent has no sent_at/replied_at, and falling
      // back to `now` made it look freshly-minted on every single request forever.
      since: ar.sent_at ?? ar.replied_at ?? ar.created_at,
      actions: mikeOwns ? ['send_approval', 'mark_approved'] : ['nudge'],
      arc: null,
      chase_due_at: chaseDueAt ? chaseDueAt.toISOString() : null,
      chase_draft: overdueChase ? buildChaseEmailDraft(taskTitle, ar.chase_after_days) : null,
      // Spec polish (2026-09-04) — populated in lockstep with chase_draft: the target
      // (task + recipient) a "Queue chase from my Gmail" click needs. Prefers the
      // original request's own ClientContact; falls back to its plain to_email when no
      // contact was picked.
      chase_target: overdueChase
        ? { task_id: ar.task_id, contact_id: ar.contact?.id ?? null, email: ar.contact?.email ?? ar.to_email ?? null }
        : null,
      // client_approval resolves only through its own ApprovalRequest status changes
      // (PATCH /api/approval-requests/[id]) — never a bare dismiss.
      dismiss: null,
    });
  }
  return out;
}

function classifySomeoneElse(input: ClassifyProjectBlockersInput, now: Date): Blocker[] {
  const c = input.next_step_candidate;
  if (!c || !c.assignee_id) return [];
  if (c.assignee_id === MIKE_USER_ID || BOT_USER_IDS.includes(c.assignee_id)) return [];

  const days = Math.max(0, daysBetween(new Date(c.since), now));
  const task = input.tasks.find((t) => t.id === c.task_id);
  return [
    {
      kind: 'someone_else',
      id: `someone_else:${c.task_id}`,
      title: c.assignee_name ?? 'A teammate',
      detail: `has had it ${days} day${days === 1 ? '' : 's'}`,
      owner: { id: c.assignee_id, name: c.assignee_name ?? 'A teammate', is_mike: false },
      source: taskSource(c.task_id),
      since: c.since,
      actions: ['nudge', 'pick'],
      arc: task?.arc ?? null,
      chase_due_at: null,
      chase_draft: null,
      chase_target: null,
      dismiss: null,
    },
  ];
}

function classifyStale(
  input: ClassifyProjectBlockersInput,
  now: Date,
  blockersSoFar: Blocker[]
): Blocker | null {
  if (input.stale_muted_until && new Date(input.stale_muted_until) > now) return null;

  const daysSinceMovement = input.last_movement_at ? daysBetween(new Date(input.last_movement_at), now) : Infinity;
  if (daysSinceMovement < STALE_DAYS_THRESHOLD) return null;

  // Suppressed when the only other live blockers are client-owned client_approval rows —
  // the project isn't silently stalling, it's just waiting on the client's reply, and
  // that's already a fully-formed blocker in its own right.
  const onlyClientOwnedApprovals =
    blockersSoFar.length > 0 && blockersSoFar.every((b) => b.kind === 'client_approval' && !b.owner.is_mike);
  if (onlyClientOwnedApprovals) return null;

  const marker = input.last_movement_at ?? '';
  if (isDismissed(input.dismissals, 'stale', input.project.id, marker)) return null;

  return {
    kind: 'stale',
    id: `stale:${input.project.id}`,
    title: input.project.name,
    detail:
      daysSinceMovement === Infinity
        ? 'No recorded movement on this project'
        : `No movement in ${daysSinceMovement} days`,
    owner: mikeOwner(),
    source: { type: 'project', id: input.project.id, url: `/projects/${input.project.id}` },
    since: input.last_movement_at ?? now.toISOString(),
    actions: ['refresh_next_step', 'nudge', 'dismiss', 'suspend'],
    arc: null,
    chase_due_at: null,
    chase_draft: null,
    chase_target: null,
    dismiss: { kind: 'stale', source_id: input.project.id, source_marker: marker },
  };
}

function classifyMeetingRisk(input: ClassifyProjectBlockersInput, now: Date): Blocker[] {
  const daysSinceMovement = input.last_movement_at ? daysBetween(new Date(input.last_movement_at), now) : Infinity;
  if (daysSinceMovement < MEETING_RISK_STILLNESS_DAYS) return [];

  const out: Blocker[] = [];
  for (const event of input.calendar_events) {
    const daysToMeeting = daysBetween(now, new Date(event.starts_at));
    if (daysToMeeting < 0 || daysToMeeting > MEETING_RISK_WINDOW_DAYS) continue; // defensive; caller pre-filters
    if (isDismissed(input.dismissals, 'meeting_risk', event.id, event.starts_at)) continue;

    out.push({
      kind: 'meeting_risk',
      id: `meeting_risk:${event.id}`,
      title: event.title,
      detail: `Meeting with ${input.project.client?.name ?? 'the client'} in ${daysToMeeting} day${
        daysToMeeting === 1 ? '' : 's'
      }, no recent movement`,
      owner: mikeOwner(),
      source: { type: 'calendar_event', id: event.id, url: `/projects/${input.project.id}` },
      since: input.last_movement_at ?? now.toISOString(),
      actions: ['refresh_next_step', 'nudge', 'dismiss'],
      arc: null,
      chase_due_at: null,
      chase_draft: null,
      chase_target: null,
      dismiss: { kind: 'meeting_risk', source_id: event.id, source_marker: event.starts_at },
    });
  }
  return out;
}

export function classifyProjectBlockers(input: ClassifyProjectBlockersInput, now: Date): Blocker[] {
  const { blockers: decisionAndClarification, consumedCommentIds } = classifyDecisionAndClarification(input);
  const blockers: Blocker[] = [
    ...decisionAndClarification,
    ...classifyReview(input),
    ...classifySessionAsks(input),
    ...classifyMentions(input, consumedCommentIds),
    ...classifyClientEmails(input),
    ...classifyClientApprovals(input, now),
    ...classifySomeoneElse(input, now),
  ];

  const stale = classifyStale(input, now, blockers);
  if (stale) blockers.push(stale);

  blockers.push(...classifyMeetingRisk(input, now));

  return blockers;
}

export function ownerIsMike(blockers: Blocker[]): boolean {
  return blockers.some((b) => b.owner.is_mike);
}
