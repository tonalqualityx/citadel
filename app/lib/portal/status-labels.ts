/**
 * Plain-language status labels for the client portal (portal MVP A5).
 *
 * Internal statuses never reach a client as raw enum values. Every portal payload maps through
 * these functions, so the wording lives in one place. Rules (writing standard): plain words, no
 * em dashes, no estimates, no mention of staff or tooling.
 *
 * Spec section 3: ready shows as Starting soon; in_progress and blocked as In progress; review
 * as In review; done as Complete.
 */

export const FALLBACK_STATUS_LABEL = 'In progress';

const PROJECT_LABELS: Record<string, string> = {
  ready: 'Starting soon',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Complete',
};

/** Client words for a project status. Hidden statuses (quote, queue, suspended, cancelled) fall back. */
export function projectStatusLabel(status: string | null | undefined): string {
  return PROJECT_LABELS[status ?? ''] ?? FALLBACK_STATUS_LABEL;
}

const TASK_LABELS: Record<string, string> = {
  not_started: 'Starting soon',
  in_progress: 'In progress',
  blocked: 'In progress',
  review: 'In review',
  done: 'Complete',
  abandoned: 'Closed',
};

/** Label shown when a task is waiting on the client to approve it. */
export const AWAITING_YOU_LABEL = 'Ready for your review';

/** Label once the client has approved staged work that is not yet live (status stays `review`). */
export const APPROVED_GOING_LIVE_LABEL = 'Approved. Going live soon.';

/** Tag the approve routes stamp beside `client_approved_at` (mirrors CLIENT_APPROVED_TAG). */
const APPROVED_TAG = 'client-approved';

/** True when the client approved it and the change is not live yet: status `review` plus the approval. */
export function isApprovedGoingLive(task: {
  status?: string | null;
  tags?: string[] | null;
  client_approved_at?: Date | string | null;
}): boolean {
  return task.status === 'review' && (Boolean(task.client_approved_at) || (task.tags ?? []).includes(APPROVED_TAG));
}

/**
 * Client words for a task. `awaitingClient` is true when the task is staged and not yet approved:
 * the work is finished on our side, so it must not read as Complete.
 */
export function taskStatusLabel(
  status: string | null | undefined,
  awaitingClient = false,
  approvedGoingLive = false
): string {
  if (awaitingClient) return AWAITING_YOU_LABEL;
  if (approvedGoingLive && status === 'review') return APPROVED_GOING_LIVE_LABEL;
  return TASK_LABELS[status ?? ''] ?? FALLBACK_STATUS_LABEL;
}

export type PhaseState = 'done' | 'current' | 'upcoming';

const PHASE_LABELS: Record<PhaseState, string> = {
  done: 'Done',
  current: 'Now',
  upcoming: 'Next',
};

export function phaseStateLabel(state: PhaseState): string {
  return PHASE_LABELS[state];
}

export type ActivityType = 'task_completed' | 'task_approved' | 'article_published';

const ACTIVITY_PREFIX: Record<ActivityType, string> = {
  task_completed: 'Completed',
  task_approved: 'You approved',
  article_published: 'Published',
};

export function activityLabel(type: ActivityType): string {
  return ACTIVITY_PREFIX[type];
}

// ---- Requests (portal phase B slice 1, spec 2.6) -------------------------------------------

export type ChipTone = 'attention' | 'moving' | 'done' | 'quiet' | 'urgent' | 'quote';

export interface RequestState {
  label: string;
  tone: ChipTone;
}

export interface RequestStateFields {
  status?: string | null;
  tags?: string[] | null;
  staging_preview_url?: string | null;
  approved?: boolean | null;
  client_approved_at?: Date | string | null;
}

export const REQUEST_LABELS = {
  closed: 'Closed',
  review: AWAITING_YOU_LABEL,
  approved: APPROVED_GOING_LIVE_LABEL,
  done: 'Done',
  answer: 'Needs your answer',
  quote: 'We will quote this',
  urgent: 'Urgent: the team is on it',
  progress: 'In progress',
  received: 'Received',
} as const;

/**
 * The client's word for where a request stands. First match wins (spec 2.6). Pure and
 * tag-aware: tags are read here and never leave the server.
 */
export function requestState(task: RequestStateFields): RequestState {
  const tags = task.tags ?? [];
  if (task.status !== 'abandoned' && isApprovedGoingLive(task)) {
    return { label: REQUEST_LABELS.approved, tone: 'moving' };
  }
  const staged =
    typeof task.staging_preview_url === 'string' &&
    task.staging_preview_url.length > 0 &&
    !task.approved &&
    !task.client_approved_at &&
    (task.status === 'review' || task.status === 'done');

  if (task.status === 'abandoned') return { label: REQUEST_LABELS.closed, tone: 'quiet' };
  if (staged) return { label: REQUEST_LABELS.review, tone: 'attention' };
  if (task.status === 'done' || task.client_approved_at) return { label: REQUEST_LABELS.done, tone: 'done' };
  if (tags.includes('awaiting-clarification')) return { label: REQUEST_LABELS.answer, tone: 'attention' };
  if (tags.includes('quote')) return { label: REQUEST_LABELS.quote, tone: 'quote' };
  if (tags.includes('emergency')) return { label: REQUEST_LABELS.urgent, tone: 'urgent' };
  if (task.status === 'in_progress' || task.status === 'blocked' || task.status === 'review') {
    return { label: REQUEST_LABELS.progress, tone: 'moving' };
  }
  return { label: REQUEST_LABELS.received, tone: 'quiet' };
}

/** True when a request is finished from the client's side (it belongs under "closed"). */
export function isRequestClosed(task: RequestStateFields): boolean {
  const s = requestState(task);
  return s.label === REQUEST_LABELS.closed || s.label === REQUEST_LABELS.done;
}
