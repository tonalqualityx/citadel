/**
 * Slice 4a: the commitment checks. The model must never promise a price, a date, a scope or a turnaround in Mike's
 * voice, so every draft body, read and suggested answer passes through here, in Citadel (this file) and on the machine
 * (checks.py). Both run the same cases from one fixture, __tests__/fixtures/commitment-cases.json, copied byte for byte.
 * Pure: no I/O.
 *
 * Categories, in the order they are tried: money, time, scope, shape. A URL or email address that is not in the context
 * bundle is refused by the machine only (the bundle is not here), so Citadel does not look for one.
 */

import { OWED } from './copy';

export type CheckCategory = 'money' | 'time' | 'scope' | 'shape';
export type CheckResult = { ok: true } | { ok: false; category: CheckCategory; match: string };

const WEEKDAYS = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
/** Case sensitive on purpose: "may" the verb is not a month. */
const MONTHS = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';

export const OWED_CHECK = {
  money: [
    /[$€£]/,
    /\bUSD\b/i,
    /\bdollars?\b/i,
    /\b\d+(?:\.\d+)?k\b/i,
    /\b(?:price[sd]?|pricing|costs?|quote[ds]?|estimates?|fees?|rates?|discount|invoice|retainer|hourly|budget)\b/i,
    /\bfree of charge\b/i,
    /\bno charge\b/i,
  ],
  time: [
    new RegExp(`\\b${WEEKDAYS}\\b`, 'i'),
    new RegExp(`\\b${MONTHS}\\b`),
    /\b(?:today|tonight|tomorrow|this week|next week|end of (?:the )?(?:day|week|month)|EOD|EOW|ASAP|shortly|soon)\b/i,
    /\bwithin \d+/i,
    /\bwithin (?:a|an|the|one|two|three|four|five|a few|a couple)\b/i,
    /\b\d+\s*(?:business |working )?(?:hours?|days?|weeks?|months?)\b/i,
    /\b(?:turnaround|deadline|ETA|timeline)\b/i,
    /\bby (?:then|next|the end)\b/i,
  ],
  scope: [
    /\b(?:I|we)(?:'ll| will| can| could| promise| guarantee)\b[\s\S]{0,60}\b(?:build|include|add|deliver|finish|launch|fix|redesign|migrate|ship|set up|handle)\b/i,
    /\b(?:guarantee[sd]?|promise[sd]?|unlimited|included)\b/i,
  ],
  /** Shape: a dash, Markdown, a placeholder, a self-reference. Applies to every text. */
  dash: new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`),
  markdown: [/[*#`]/, /^\s*[-+]\s+\S/m, /^\s*>/m, /\]\(/, /__/, /~~/],
  placeholder: [/\[\[/, /\]\]/, /\{\{/, /\}\}/, /<<<|>>>/],
  selfReference: [/\bBast\b/i, /\bAI\b/, /\bassistant\b/i, /\bartificial intelligence\b/i],
  /** Words that never reach Mike's screen. */
  banned: /\b(?:priorit(?:y|ies)|overdue)\b/i,
} as const;

function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'");
}

function firstMatch(patterns: readonly RegExp[], text: string): string | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function shape(text: string, maxWords: number, maxChars: number): CheckResult {
  if (text.trim().length === 0) return { ok: false, category: 'shape', match: 'empty' };
  if (wordCount(text) > maxWords) return { ok: false, category: 'shape', match: 'too many words' };
  if (text.length > maxChars) return { ok: false, category: 'shape', match: 'too many characters' };
  const dash = OWED_CHECK.dash.exec(text);
  if (dash) return { ok: false, category: 'shape', match: dash[0] };
  const hit =
    firstMatch(OWED_CHECK.markdown, text) ??
    firstMatch(OWED_CHECK.placeholder, text) ??
    firstMatch(OWED_CHECK.selfReference, text) ??
    firstMatch([OWED_CHECK.banned], text);
  if (hit !== null) return { ok: false, category: 'shape', match: hit.trim() || hit };
  return { ok: true };
}

function commitments(text: string): CheckResult {
  const t = normalize(text);
  const money = firstMatch(OWED_CHECK.money, t);
  if (money !== null) return { ok: false, category: 'money', match: money };
  const time = firstMatch(OWED_CHECK.time, t);
  if (time !== null) return { ok: false, category: 'time', match: time };
  const scope = firstMatch(OWED_CHECK.scope, t);
  if (scope !== null) return { ok: false, category: 'scope', match: scope };
  return { ok: true };
}

/** A draft body Mike's client would read: no commitments, plain, at most 180 words and 1,200 characters. */
export function checkDraftBody(text: string): CheckResult {
  const c = commitments(text);
  if (!c.ok) return c;
  return shape(text, OWED.maxWords, OWED.maxChars);
}

/** The number of sentences in a text (runs ending in . ! or ?, plus a trailing run without one). */
export function sentenceCount(text: string): number {
  return text
    .split(/[.!?]+(?:\s+|$)/)
    .map((x) => x.trim())
    .filter(Boolean).length;
}

/**
 * Slice 4c: the short holding draft. The same commitment and shape checks as a full draft, with the tighter cap: at most
 * 2 sentences and 40 words.
 */
export function checkShortDraft(text: string): CheckResult {
  const c = commitments(text);
  if (!c.ok) return c;
  const s = shape(text, OWED.shortWords, OWED.maxChars);
  if (!s.ok) return s;
  if (sentenceCount(text) > OWED.shortSentences) return { ok: false, category: 'shape', match: 'too many sentences' };
  return { ok: true };
}

/**
 * Bast's read of the decision being avoided. It may name what is missing ("a price"), so no commitment words are
 * checked; it must be plain, at most 40 words and 400 characters (the column).
 */
export function checkRead(text: string): CheckResult {
  return shape(text, OWED.readWords, 400);
}

/** The suggested answer: itself free of commitments, plain, at most 30 words and 300 characters (the column). */
export function checkSuggested(text: string): CheckResult {
  const c = commitments(text);
  if (!c.ok) return c;
  return shape(text, OWED.suggestedWords, 300);
}
