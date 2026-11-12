/**
 * Work stage E: the words on the owner's screen (and in a session's answers) for sessions. Plain words, no em or en dash, and a stored
 * title goes through displayText. The home dash guard scans this folder.
 */

import { displayText } from '@/lib/home/copy';

const q = (s: string): string => `"${displayText(s) || 'a task'}"`;

export const SESSION_FINISHED = {
  whyNow: 'Each task has proof of its own from the session that the work happened. Nothing closes until you tap.',
  ifIgnored: 'Stays here. Nothing closes on its own.',
  reason: 'A session reported commits or files that match these tasks.',
  byHand: 'Close it yourself on the task page.',
  securityHead: (n: number) => `Security tasks (${n}). Close each yourself on its task page.`,
} as const;

/** The card title: `This session's work looks done: Hosting comparison (commit 3f2a1c, file delivered). Close it?` */
export function sessionCardTitle(rows: readonly { title: string; proof: string }[]): string {
  if (rows.length === 0) return "This session's work looks done. Close it?";
  const shown = rows.slice(0, 3).map((r) => `${displayText(r.title) || 'A task'}${r.proof ? ` (${r.proof})` : ''}`);
  const more = rows.length > 3 ? ` and ${rows.length - 3} more` : '';
  return `This session's work looks done: ${shown.join('; ')}${more}. ${rows.length === 1 ? 'Close it?' : 'Close them?'}`;
}

/** The short proof words of one row: `commit 3f2a1c, file delivered`. */
export function proofWords(kinds: readonly { kind: string; ref: string }[]): string {
  const parts: string[] = [];
  const commit = kinds.find((k) => k.kind === 'commit');
  if (commit) parts.push(`commit ${displayText(commit.ref.split('@')[0]).slice(0, 7)}`);
  if (kinds.some((k) => k.kind === 'delivered_file')) parts.push('file delivered');
  return parts.join(', ');
}

/** The in-session answer to a close that has no proof. */
export const NO_PROOF_MESSAGE = 'No proof yet. It stays open.';
export const CLOSE_MESSAGES = {
  no_proof: NO_PROOF_MESSAGE,
  security: 'A security task is closed by you on its task page, never from a session.',
  unticked: 'It has a checklist item that is not ticked. It stays open.',
  not_linked: 'This session is not linked to that task. It stays open.',
} as const;

/** The internal note on a task when a session reported only partial proof: nothing closes and no card is made. */
export function partialNote(line: string): string {
  return `A session reported something that may belong to this task: ${displayText(line).replace(/[.\s]+$/, '')}. That is not enough to say the work is done.`;
}

/** The internal comment on a task closed from a session. */
export function sessionCloseComment(line: string): string {
  return `Closed from a session after your yes: ${displayText(line).replace(/[.\s]+$/, '')}.`;
}

export const TRACK_MESSAGES = {
  noClient: 'No client could be found for this session. Say which project it belongs to.',
  notLive: 'That project is finished or not active. Pick a live one.',
  notProject: 'Track it takes a project, or nothing for new work.',
} as const;

/** The Handled line for work started from a session: `Started tracking "Hosting comparison" from the session.` */
export function trackedFromSessionLine(name: string, count: number): string {
  return count > 1 ? `Started tracking ${q(name)} with ${count} tasks from the session.` : `Started tracking ${q(name)} from the session.`;
}

/** The Handled line for the one-time clear: `Cleared 357 old session questions.` */
export function staleClearedLine(n: number): string {
  return n === 1 ? 'Cleared 1 old session question.' : `Cleared ${n} old session questions.`;
}

export const STALE_MESSAGES = {
  restored: (n: number) => (n === 1 ? 'Brought back 1 session question.' : `Brought back ${n} session questions.`),
} as const;

/** The session card's one-line note for the session-side context. */
export function stillLinkedLine(name: string): string {
  return `Still linked to ${q(name)}.`;
}
