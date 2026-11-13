/**
 * Triage (operating model S3): every sentence the Triage section and its Handled lines say. Plain words, no dashes.
 */

export const TRIAGE_UNDO_HOURS = 72;

export const TRIAGE_HEADING = 'Triage';
export const TRIAGE_SUBHEAD = 'Ideas parked for your release. Nothing here is worked until you release it.';
export const TRIAGE_EMPTY = 'Nothing in Triage. Tell Bast and it lands here.';

/** The server's 409 card_changed sentence. Lives here (not in triage-version.ts, which needs node:crypto) so the browser can match it. */
export const CARD_CHANGED_MESSAGE = 'That card changed after you read it. Nothing was released. Look at it again.';
/** Shown on the card itself after a refused Release, once the new line is on screen. */
export const CARD_CHANGED_NOTE = 'This card changed after you read it. Nothing was released. Read the new line above, then tap Release again.';

/** What Bast thinks a card is, in plain words. null = not sorted yet. */
export const TRIAGE_KIND_LABELS: Record<string, string> = {
  project_setup: 'New project',
  task: 'Single task',
  project_addition: 'Addition to a project',
  reusable_tool: 'Reusable tool',
  rule_proposal: 'Rule proposal',
  question_only: 'Question only',
};
export const NOT_SORTED_LABEL = 'Not sorted yet';
export function kindLabel(kind: string | null | undefined): string {
  return (kind && TRIAGE_KIND_LABELS[kind]) || NOT_SORTED_LABEL;
}

export const ASKED_AFTER_RELEASE_HEADING = 'Asked after release';
export const ASKED_AFTER_RELEASE_HINT = 'Released cards that now have a question for you.';
export const LOOKS_DONE_BADGE = 'Looks done';
export const ON_RELEASE = 'On release:';
export const DETAILS_LABEL = 'Details';
export const RELEASE_OFF_UNSORTED = 'Bast has not sorted this yet. Talk about it and Bast will propose what it is.';
export const RELEASE_OFF_PREFIX = 'Release is off.';

/** The tile's label: `in Triage`, with the question count when there is one. */
export function triageTileLabel(count: number, questions: number): string {
  const base = 'in Triage';
  return questions > 0 ? `${base}, ${questions} ${questions === 1 ? 'question' : 'questions'}` : base;
}

export const TRIAGE_BUTTONS = {
  release: 'Release',
  releasePlan: 'Release plan',
  drop: 'Drop',
  closeDone: 'Close as done',
  notDone: 'Not done',
  talk: 'Talk about this',
  questions: 'Questions',
  showAll: 'Show all',
  showLess: 'Show fewer',
  hideQuestions: 'Hide questions',
} as const;

export const TRIAGE_MESSAGES = {
  stillQuote: 'That project is still a quote. Nothing was released.',
  nothingChanged: 'Nothing changed. Those ideas were already moved.',
  notYours: 'Triage is not available for this user.',
  gone: 'That group is not in Triage any more.',
} as const;

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function releasedLine(count: number, skipped: number): string {
  const base = `Released ${n(count, 'idea', 'ideas')} from Triage.`;
  return skipped > 0 ? `${base} ${n(skipped, 'was', 'were')} left because ${skipped === 1 ? 'it' : 'they'} changed or ${skipped === 1 ? 'is' : 'are'} on a quote.` : base;
}

export function releasedPlanLine(count: number, projectNames: string[], madeReady: string[]): string {
  const where = projectNames.length === 1 ? ` on ${projectNames[0]}` : '';
  const ready = madeReady.length > 0 ? ` ${madeReady.length === 1 ? madeReady[0] : n(madeReady.length, 'project', 'projects')} is now ready.` : '';
  return `Released the plan: ${n(count, 'idea', 'ideas')}${where}.${ready}`;
}

/** What the release did with the open questions on the released cards, or '' when there were none. */
export function questionsLine(defaulted: number, waiting: number): string {
  const parts: string[] = [];
  if (defaulted > 0) parts.push(`${defaulted} ${defaulted === 1 ? 'question goes' : 'questions go'} with the recommendation`);
  if (waiting > 0) parts.push(`${waiting} ${waiting === 1 ? 'waits' : 'wait'} for you`);
  if (parts.length === 0) return '';
  const joined = parts.join(', ');
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

export const QUESTIONS_HEADING = 'Questions';
export const QUESTION_BUTTONS = {
  questions: 'Questions',
  context: 'Context',
  hideContext: 'Hide context',
  change: 'Change',
  other: 'Other answer',
  send: 'Send answer',
  cancel: 'Cancel',
  recommended: 'Recommended',
} as const;

export function droppedLine(count: number): string {
  return `Dropped ${n(count, 'idea', 'ideas')} from Triage.`;
}

/** How long a card has waited: `today`, `1 day old`, `5 days old`, `3 weeks old`, `4 months old`. Empty when the date is missing. */
export function ageLine(createdAt: string | undefined, nowMs: number = Date.now()): string {
  if (!createdAt) return '';
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return '';
  return ageFromDays(Math.max(0, Math.floor((nowMs - t) / 86_400_000)));
}

/** The same words from a whole number of days (the card payload carries age_days, so the screen and the server agree). */
export function ageFromDays(days: number): string {
  if (days < 1) return 'today';
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} old`;
  if (days < 60) return `${Math.floor(days / 7)} weeks old`;
  return `${Math.floor(days / 30)} months old`;
}

export const LOOKS_DONE_HEADING = 'Looks done';
export const LOOKS_DONE_HINT = 'Someone says these are already finished. Check the proof, then close them or leave them.';
export const LOOKS_DONE_NO_NOTE = 'Marked as done, but no note was left.';

/** The count line's tail: `2 look done`. */
export function lookDoneCount(count: number): string {
  return `${count} ${count === 1 ? 'looks' : 'look'} done`;
}

export function closedDoneLine(count: number): string {
  return count === 1 ? 'Closed 1 idea as done from Triage.' : `Closed ${count} ideas as done from Triage.`;
}

export function notDoneLine(count: number): string {
  return count === 1 ? 'Left 1 idea in Triage. It is not done.' : `Left ${count} ideas in Triage. They are not done.`;
}

/** The internal comment a close writes. `evidenceId` is the Looks done comment it relied on, when there was one. */
export function closedDoneComment(evidenceId: string | null, evidence: string | null): string {
  if (!evidenceId || !evidence) return 'Closed as done from Triage. No Looks done note was on the card.';
  const short = evidence.length > 240 ? `${evidence.slice(0, 239).trimEnd()}\u2026` : evidence;
  return `Closed as done from Triage. Evidence: comment ${evidenceId}: ${short}`;
}

export const NOT_DONE_COMMENT = 'Not done: the Looks done note was checked and the card stays in Triage.';
export const CLOSE_UNDONE_COMMENT = 'The close was undone: the card is back in Triage with its Looks done mark.';

export const TRIAGE_UNDONE = 'Put back in Triage.';

/** The chat panel's About line for a group, and the seam note it sends until the one-chat-per-card API exists (slice S4). */
export function talkAboutLine(label: string, count: number): string {
  return `Triage: ${label} (${n(count, 'idea', 'ideas')})`;
}
