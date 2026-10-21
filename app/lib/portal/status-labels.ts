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

/**
 * Client words for a task. `awaitingClient` is true when the task is staged and not yet approved:
 * the work is finished on our side, so it must not read as Complete.
 */
export function taskStatusLabel(status: string | null | undefined, awaitingClient = false): string {
  if (awaitingClient) return AWAITING_YOU_LABEL;
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
