import { BAST_USER_ID, BOT_USER_IDS } from './gate-constants';

// Oracle Projects Tab Phase 2 — "positive movement" is the signal the stale/meeting_risk
// blockers key off of. Pure module: no Prisma, no clock reads except through the `now`
// parameter callers pass in.
//
// What counts as movement:
//   - any time entry logged against the project (by anyone)
//   - a task status change or comment by a HUMAN (i.e. user_id not in BOT_USER_IDS)
//   - a Bast-authored activity-log status change to done on any task — Bast actually
//     finishing work, independent of whatever the accompanying comment (if any) says
//     (MEDIUM-3). C4 (Phase 3 carry-over): this used to also credit a status change to
//     in_progress — narrowed to done only, since starting a task isn't itself completed
//     movement and in_progress can be flipped back without anything having shipped.
//   - a comment BY BAST that is NOT an escalation (its first sentence/line, up to 160
//     chars, doesn't match ESCALATION_RE — unless that first sentence/line OPENS with
//     "done"/"shipped"/"completed"/"published", which counts as non-escalation
//     regardless of anything later in the body) AND coincides with a Bast-authored task
//     status change to done on the SAME task within 10 minutes — this is Bast actually
//     doing work, not just parking a card with a note
// What never counts: emails, calendar events, a bot other than Bast, or any Bast
// activity-log entry that isn't a status change to done. A Bast comment that
// doesn't clear the non-escalation + coinciding-progress bar (e.g. a plain "parking
// this, needs-mike" note) still doesn't count via the comment path — though the SAME
// underlying event may still register via the activity-log path above if Bast also
// flipped the task's status to done.
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
// MEDIUM-3: a comment declaring itself DONE right up front ("@Mike done. ... cannot ...")
// is a completion, not an escalation, no matter what shows up later in the body — the
// leading word wins outright, skipping the ESCALATION_RE check entirely. An optional
// "@name" (or "@name," / "@name:") prefix is allowed before it.
const LEADING_COMPLETION_RE = /^\s*(?:@\S+[,:]?\s*)?(done|shipped|completed|published)\b/i;
// The escalation test only ever looks at the comment's first sentence/line — the first
// 160 chars up to (not including) the first '.' or newline. A comment that OPENS with
// "Tests pass, gates green, nothing blocked." still matches "blocked" in that first
// clause (this alone doesn't save it — see the activity-log status_changed credit
// below, which is what actually covers that shape) but a comment whose escalation-
// sounding word only shows up several sentences later (e.g. "...cannot..." after an
// opening "done.") is no longer wrongly penalized for it.
const FIRST_SEGMENT_MAX_CHARS = 160;
const COINCIDENCE_WINDOW_MS = 10 * 60 * 1000;
// C4 (Phase 3 carry-over): done only — in_progress no longer independently credits
// Bast with movement (see the module doc comment above).
const PROGRESS_STATUSES = new Set(['done']);

function firstSegment(content: string): string {
  const stopIndex = content.search(/[.\n]/);
  const cut = stopIndex === -1 ? content : content.slice(0, stopIndex);
  return cut.slice(0, FIRST_SEGMENT_MAX_CHARS);
}

function isEscalationComment(content: string): boolean {
  const segment = firstSegment(content);
  if (LEADING_COMPLETION_RE.test(segment)) return false;
  return ESCALATION_RE.test(segment);
}

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
    if (BOT_USER_IDS.includes(log.user_id)) {
      // MEDIUM-3/C4: Bast actually moving a task to done is real work, not a parked
      // note — it counts as movement in its own right, independent of whatever its
      // accompanying comment (if any) says. Every other bot's activity, any other
      // action from Bast, and a Bast status change to in_progress are all still
      // skipped entirely.
      const isBastProgressChange =
        log.user_id === BAST_USER_ID &&
        log.action === 'status_changed' &&
        !!log.status_to &&
        PROGRESS_STATUSES.has(log.status_to);
      if (!isBastProgressChange) continue;
      candidates.push({ at: log.created_at, who: log.user_name, what: describeActivity(log) });
      continue;
    }
    candidates.push({ at: log.created_at, who: log.user_name, what: describeActivity(log) });
  }

  for (const comment of input.comments) {
    if (!BOT_USER_IDS.includes(comment.user_id)) {
      candidates.push({ at: comment.created_at, who: comment.user_name, what: 'commented' });
      continue;
    }
    if (comment.user_id !== BAST_USER_ID) continue; // only Bast's comments ever get bot credit
    if (isEscalationComment(comment.content)) continue;
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
