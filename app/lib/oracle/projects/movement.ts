import { BAST_USER_ID, BOT_USER_IDS } from './gate-constants';

// Oracle Projects Tab Phase 2 — "positive movement" is the signal the stale/meeting_risk
// blockers key off of. Pure module: no Prisma, no clock reads except through the `now`
// parameter callers pass in.
//
// What counts as movement:
//   - any time entry logged against the project (by anyone)
//   - a task status change or comment by a HUMAN (i.e. user_id not in BOT_USER_IDS)
//   - a comment BY BAST that is NOT an escalation (doesn't match ESCALATION_RE) AND
//     coincides with a Bast-authored task status change to done/in_progress on the SAME
//     task within 10 minutes — this is Bast actually doing work, not just parking a card
//     with a note
// What never counts: emails, calendar events. Bast comments that don't clear the
// non-escalation + coinciding-progress bar (e.g. a plain "parking this, needs-mike" note)
// don't count either — that's the whole point of the stale signal existing.
export interface MovementTimeEntry {
  user_id: string;
  user_name: string;
  started_at: string; // ISO
}

export interface MovementActivityLogEntry {
  id: string;
  user_id: string;
  user_name: string;
  action: string; // e.g. 'status_changed'
  entity_type: string; // e.g. 'task'
  entity_id: string;
  created_at: string; // ISO
  // Only meaningful for action: 'status_changed' — the new status value.
  status_to: string | null;
}

export interface MovementComment {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string; // ISO
}

export interface LastMovementInput {
  time_entries: MovementTimeEntry[];
  activity_log: MovementActivityLogEntry[];
  comments: MovementComment[];
}

export interface Movement {
  at: string; // ISO
  who: string;
  what: string;
}

const ESCALATION_RE = /needs-mike|awaiting-clarification|can't|cannot|blocked|parking|escalat/i;
const COINCIDENCE_WINDOW_MS = 10 * 60 * 1000;
const PROGRESS_STATUSES = new Set(['done', 'in_progress']);

function describeActivity(log: MovementActivityLogEntry): string {
  if (log.action === 'status_changed' && log.status_to) {
    return `moved ${log.entity_type} to ${log.status_to}`;
  }
  return log.action.replace(/_/g, ' ');
}

function bastCommentCoincidesWithProgress(
  comment: MovementComment,
  activityLog: MovementActivityLogEntry[]
): boolean {
  const commentTime = new Date(comment.created_at).getTime();
  return activityLog.some(
    (log) =>
      log.user_id === BAST_USER_ID &&
      log.entity_type === 'task' &&
      log.entity_id === comment.task_id &&
      log.action === 'status_changed' &&
      !!log.status_to &&
      PROGRESS_STATUSES.has(log.status_to) &&
      Math.abs(new Date(log.created_at).getTime() - commentTime) <= COINCIDENCE_WINDOW_MS
  );
}

export function lastMovement(input: LastMovementInput): Movement | null {
  const candidates: Movement[] = [];

  for (const te of input.time_entries) {
    candidates.push({ at: te.started_at, who: te.user_name, what: 'logged time' });
  }

  for (const log of input.activity_log) {
    if (BOT_USER_IDS.includes(log.user_id)) continue; // human-authored log entries only here
    candidates.push({ at: log.created_at, who: log.user_name, what: describeActivity(log) });
  }

  for (const comment of input.comments) {
    if (!BOT_USER_IDS.includes(comment.user_id)) {
      candidates.push({ at: comment.created_at, who: comment.user_name, what: 'commented' });
      continue;
    }
    if (comment.user_id !== BAST_USER_ID) continue; // only Bast's comments ever get bot credit
    if (ESCALATION_RE.test(comment.content)) continue;
    if (!bastCommentCoincidesWithProgress(comment, input.activity_log)) continue;
    candidates.push({ at: comment.created_at, who: comment.user_name, what: 'made progress' });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return candidates[0];
}

export function daysSince(at: string | null, now: Date): number {
  if (!at) return Infinity;
  return Math.floor((now.getTime() - new Date(at).getTime()) / (24 * 60 * 60 * 1000));
}

const STALE_DAYS_THRESHOLD = 7;

export function isStale(input: LastMovementInput, now: Date): boolean {
  const movement = lastMovement(input);
  return daysSince(movement?.at ?? null, now) >= STALE_DAYS_THRESHOLD;
}
