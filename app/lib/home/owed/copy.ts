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
  /** Slice 4c: the short holding draft is at most 2 sentences and 40 words. */
  shortWords: 40,
  shortSentences: 2,
} as const;

/** Slice 4c: the clock days, in business days from their newest message (the lead clock from lead_clock_from if later). */
export const OWED_CLOCK = {
  /** A client reply moves to the top of its People tile. */
  waitingDays: 3,
  /** Bast's draft is still unsent: the row becomes Needs thought and Bast adds a short holding draft. */
  thoughtDays: 5,
  /** Needs thought with no tap for this long: Bast drafts once along its suggested answer (never when it needs a commitment). */
  autoDraftDays: 3,
  /** A lead's reply clock. */
  leadDays: 2,
  /** After the clock, the lead comes back this often, even if parked, with a short draft. */
  leadRepeatDays: 2,
  /** At this age the row asks "Keep this lead or let it go?". */
  leadAskDays: 10,
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

// ============================================================================
// Slice 4c: clocks, wake, short drafts, keeping or letting go of a lead
// ============================================================================

/** The row says how long they have waited, from the third business day. */
export const waitingLine = (days: number): string => `Waiting ${days} days.`;

/** The lead clock as plain second-line text. It is the system's own clock, not a promise to anyone, and never the hard-date chip. */
export const leadDueLine = (weekday: string, past: boolean): string => (past ? `reply was due ${weekday}` : `reply due ${weekday}`);

export const WOKE_LINE = 'They wrote again.';
export const AUTO_DRAFT_LINE = 'Draft ready. Bast wrote it along its suggestion.';
export const SHORT_READY_LINE = 'Short draft ready';

export const LEAD_ASK = 'Keep this lead or let it go?';
export const NOT_LEAD_ASK = 'Treat it as a reply, or close it?';
export const TREAT_AS_REPLY_LABEL = 'Treat as a reply';
export const CLOSE_LEAD_LABEL = 'Close it';

/** Toasts for the new taps. */
export const KEEP_LEAD_MESSAGE = 'Kept. The clock starts again.';
export const TREAT_AS_REPLY_MESSAGE = 'Now a plain reply, not a lead.';
export const LET_LEAD_GO_MESSAGE = 'Let go. Marked no reply needed.';

/** The block title for the short holding draft on a card. */
export const SHORT_DRAFT_TITLE = 'The short one';

/** More "If you do nothing" lines, each shown only when true. */
export const IF_IGNORED_4C = {
  lead_past: 'Stays at the top of People. Bast refreshes its draft in your Gmail. Nothing is sent.',
  lead_past_stale: 'Stays at the top of People. Nothing is sent.',
  lead_ask: 'Stays here until you choose. Nothing is closed for you.',
  auto_draft: 'With no tap, Bast drafts along its suggestion into your Gmail after 3 business days. Nothing is sent.',
  short_ready: 'The short draft waits in your Gmail. Nothing is sent until you send it.',
} as const;

/** Handled for you: one line per run that wrote short holding drafts. */
export function shortDraftedLine(names: readonly string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return `Wrote a short holding reply to ${list[0]}. It is in your Gmail drafts.`;
  if (list.length === 2) return `Wrote short holding replies to ${list[0]} and ${list[1]}. They are in your Gmail drafts.`;
  return `Wrote short holding replies to ${list[0]} and ${list.length - 1} others. They are in your Gmail drafts.`;
}

/** "support@" from "support@becomeindelible.com"; any other text is shortened and left plain. */
export function repliedFromWords(from: string): string {
  const at = from.indexOf('@');
  const local = at > 0 ? from.slice(0, at + 1) : from;
  return local.replace(/[<>"]/g, '').trim().slice(0, 40) || 'someone on our side';
}

/** Handled for you: a joined thread already got an answer from our side. */
export function repliedElsewhereLine(name: string, from: string, weekday: string): string {
  return `${name.trim() || 'Someone'} got a reply from ${repliedFromWords(from)} on ${weekday}. Taken off your list.`;
}
