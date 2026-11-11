/**
 * Home Slice 9a: the evidence rules for what his sent mail says (one copy; the machine job checks only the shape of the model's JSON).
 * Pure: no I/O. Citadel decides every rule here from its own data and never trusts the machine's opinion.
 *
 * - checkQuote: the quote is his own new words (word for word inside new_part, at most 2 sentences and 400 characters).
 * - tenseOf: done / hedged / none for a quote.
 * - commitmentHit: money, time and scope patterns, imported from the owed-reply checks (not copied).
 * - plainQuote: a dash in his words is shown as " - ".
 */
import { OWED_CHECK } from '../owed/checks';

export const QUOTE_MAX_CHARS = 400;
export const QUOTE_MAX_SENTENCES = 2;

const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

/** Whitespace collapsed to single spaces, curly quotes straightened, ends trimmed. Used only to compare, never to store. */
export function collapse(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentences of a text: split after . ! ? followed by space, and on line breaks. Empty pieces dropped. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A dash inside his own quoted words is shown as " - " (the screen has no em or en dash). */
export function plainQuote(q: string): string {
  return q
    .replace(new RegExp(`\\s*[${EN_DASH}${EM_DASH}]\\s*`, 'g'), ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type QuoteRefusal = 'quote_not_new' | 'quote_long';
export type QuoteCheck = { ok: true } | { ok: false; reason: QuoteRefusal };

/**
 * Rule 5. `quotedPart` is optional: the machine sends only a hash of the quoted text (it is never stored here), so Citadel
 * checks it when a caller has it (the fixture, tests) and otherwise relies on the machine's splitter plus the in-new_part check.
 */
export function checkQuote(quote: string, newPart: string, quotedPart?: string | null): QuoteCheck {
  const q = collapse(quote);
  if (q.length === 0) return { ok: false, reason: 'quote_not_new' };
  if (q.length > QUOTE_MAX_CHARS || sentences(q).length > QUOTE_MAX_SENTENCES) return { ok: false, reason: 'quote_long' };
  if (!collapse(newPart).includes(q)) return { ok: false, reason: 'quote_not_new' };
  if (quotedPart && collapse(quotedPart).includes(q)) return { ok: false, reason: 'quote_not_new' };
  return { ok: true };
}

const HEDGE: RegExp[] = [
  /\bwill\b/i,
  /\b\w+'ll\b/i,
  /\bgoing to\b/i,
  /\bplan(?:s|ned|ning)?\b/i,
  /\bhop(?:e|es|ed|ing)\b/i,
  /\bshould\b/i,
  /\bcould\b/i,
  /\bmight\b/i,
  /\bmay\b/i,
  /\b(?:try|trying|tried)\b/i,
  /\btomorrow\b/i,
  /\bnext\b/i,
  /\bsoon\b/i,
  /\blater\b/i,
  /\bonce\b/i,
  /\bwhen I\b/i,
  /\bif\b/i,
  /\bnot yet\b/i,
  /\bhaven't\b/i,
  /\bdidn't\b/i,
  /\bstill\b/i,
  /\?/,
];

const IRREGULAR = 'sent|built|made|did|wrote|set|put|took|got|ran|found|gave|had|left|won|paid|kept|cut|shipped|uploaded|deleted|removed|fixed';
const COMPLETE: RegExp[] = [
  new RegExp(`\\b(?:I|we)(?:'ve|\\s+have|\\s+had)?\\s+(?:just\\s+|already\\s+|now\\s+|also\\s+)?(?:\\w+ed|${IRREGULAR})\\b`, 'i'),
  /\bis (?:done|live|up|fixed)\b/i,
  /\bare (?:done|live|up|fixed)\b/i,
  /\bhas been\b/i,
  /\bhave been\b/i,
  /\bhere is\b/i,
  /\bhere's\b/i,
  /\battached\b/i,
];

/** Rule 6. 'hedged' wins over 'done': a quote with any hedge or future word is never a completed statement. */
export function tenseOf(quote: string): 'done' | 'hedged' | 'none' {
  const q = collapse(quote);
  if (HEDGE.some((r) => r.test(q))) return 'hedged';
  if (COMPLETE.some((r) => r.test(q))) return 'done';
  return 'none';
}

/** Rule 8: the owed-reply money, time and scope patterns. Returns the first match, or null. */
export function commitmentHit(text: string): string | null {
  const t = text.replace(/[‘’]/g, "'");
  for (const group of [OWED_CHECK.money, OWED_CHECK.time, OWED_CHECK.scope] as readonly (readonly RegExp[])[]) {
    for (const p of group) {
      const m = p.exec(t);
      if (m) return m[0];
    }
  }
  return null;
}

/** Words of a text lowercased, for the overlap of a sentence with the quote. */
function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9']{4,}/g) ?? []));
}

/**
 * The sentences of `newPart` that bear on the quote: the quote's own sentences, and any sentence that shares two or more
 * longer words with it. Rule 8 runs on these.
 */
export function relatedSentences(quote: string, newPart: string): string[] {
  const qw = words(quote);
  const q = collapse(quote);
  return sentences(newPart).filter((s) => {
    if (q.includes(collapse(s)) || collapse(s).includes(q)) return true;
    let shared = 0;
    for (const w of words(s)) if (qw.has(w)) shared += 1;
    return shared >= 1;
  });
}

export type DoneEvidence = { ok: true } | { ok: false; reason: string };

/** Rules 5, 6 and 8 together, for a completion statement (the fixture's `ok`). */
export function doneEvidence(quote: string, newPart: string, quotedPart?: string | null): DoneEvidence {
  const q = checkQuote(quote, newPart, quotedPart);
  if (!q.ok) return { ok: false, reason: q.reason };
  const tense = tenseOf(quote);
  if (tense !== 'done') return { ok: false, reason: tense === 'hedged' ? 'hedged' : 'not_done' };
  for (const s of relatedSentences(quote, newPart)) {
    const hit = commitmentHit(s);
    if (hit) return { ok: false, reason: 'commitment' };
  }
  return { ok: true };
}
