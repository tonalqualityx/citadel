/**
 * Slice 4a: owed-reply constants and every string Mike reads about Bast's drafts. Kept out of rules.ts on purpose.
 * Plain words. No dash, and never the three banned words (copy-guard and the tests enforce it).
 */

export const OWED = {
  perRun: 6,
  perDay: 40,
  maxWords: 180,
  maxChars: 1200,
  readWords: 40,
  suggestedWords: 30,
  freshHours: 2,
  failCap: 3,
} as const;

export type OwedCategory = 'money' | 'time' | 'scope';

/** Bast's read when the reply needs an answer only Mike has. Written by code, never by the model. */
export const NEEDS_FROM_YOU: Record<OwedCategory, string> = {
  money: 'The reply needs a price from you.',
  time: 'The reply needs a date from you.',
  scope: 'The reply needs a scope answer from you.',
};

/** The suggested answer line when the reply needs a commitment, by what is missing. */
export const NO_SUGGESTION: Record<OwedCategory, string> = {
  money: 'Suggested answer: none. This needs your price answer.',
  time: 'Suggested answer: none. This needs your date answer.',
  scope: 'Suggested answer: none. This needs your scope answer.',
};

/** The second line of a row, after the age. */
export const OWED_SECOND_LINE = {
  draft_ready: 'Draft ready',
  drafting: 'Bast is drafting',
  his_draft: 'You started a draft',
  needs_thought: 'Needs thought',
} as const;

/** Shown on the row when his edit stands and their newer message came after it. */
export const NEW_MESSAGE_AFTER_DRAFT = 'Their new message came after your draft.';

/** "If you do nothing" lines, each shown only when true (state.ts picks). */
export const IF_IGNORED = {
  no_draft_fresh: 'Bast drafts a reply into your Gmail within the hour. Nothing is sent.',
  draft_ready: 'The draft waits in your Gmail. Nothing is sent until you send it.',
  needs_thought: 'Stays here with Bast\'s read. Nothing is sent.',
  his_draft: 'Your draft waits in Gmail. Nothing is sent.',
  stays_here: 'Stays here. Nothing is sent.',
  update_fresh: 'Bast updates its draft in your Gmail within the hour. Nothing is sent.',
} as const;

/** Bast's read line and suggested answer line on a needs-thought card. */
export const bastReadLine = (read: string): string => `Bast's read: ${read}`;
export const suggestedAnswerLine = (answer: string): string => `Suggested answer: ${answer}`;

/** Handled for you: one line per run that drafted something, e.g. "Drafted replies to Jessica Everlith and 2 others. They are in your Gmail drafts." */
export function draftedLine(names: readonly string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return `Drafted a reply to ${list[0]}. It is in your Gmail drafts.`;
  if (list.length === 2) return `Drafted replies to ${list[0]} and ${list[1]}. They are in your Gmail drafts.`;
  const rest = list.length - 1;
  return `Drafted replies to ${list[0]} and ${rest} others. They are in your Gmail drafts.`;
}
