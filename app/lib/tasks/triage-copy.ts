/**
 * Triage (operating model S3): every sentence the Triage section and its Handled lines say. Plain words, no dashes.
 */

export const TRIAGE_UNDO_HOURS = 72;

export const TRIAGE_HEADING = 'Triage';
export const TRIAGE_SUBHEAD = 'Ideas parked for your release. Nothing here is worked until you release it.';

export const TRIAGE_BUTTONS = {
  release: 'Release',
  releasePlan: 'Release plan',
  drop: 'Drop',
  talk: 'Talk about this',
  questions: 'Questions',
  showAll: 'Show all',
  showLess: 'Show fewer',
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

export const TRIAGE_UNDONE = 'Put back in Triage.';

/** The chat panel's About line for a group, and the seam note it sends until the one-chat-per-card API exists (slice S4). */
export function talkAboutLine(label: string, count: number): string {
  return `Triage: ${label} (${n(count, 'idea', 'ideas')})`;
}
