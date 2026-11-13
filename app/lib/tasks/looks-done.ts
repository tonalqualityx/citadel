/**
 * "Looks done" (the Triage close-out loop): the contract an agent follows to say a Triage card looks finished, and the pure helpers
 * both the server (lib/tasks/triage.ts) and the screens use. No database and no React in this file.
 *
 *   Marking   an agent adds the tag `triage:looks-done` (task PATCH, tags only) and an internal comment whose text starts with
 *             "Looks done: " followed by what was done and where to see it (links, commit, deploy). Marking never moves the card.
 *   Closing   only Mike's session or the chat lane closes it (the "Close as done" act), or sends it back ("Not done").
 */

export const LOOKS_DONE_TAG = 'triage:looks-done';
export const LOOKS_DONE_PREFIX = 'Looks done: ';
export const EVIDENCE_MAX = 600;

/** The evidence line of a "Looks done: " comment (the text after the prefix), or null when the comment is not one. */
export function evidenceOf(content: string | null | undefined): string | null {
  if (typeof content !== 'string' || !content.startsWith(LOOKS_DONE_PREFIX)) return null;
  const text = content.slice(LOOKS_DONE_PREFIX.length).replace(/\s+/g, ' ').trim();
  if (text.length === 0) return null;
  return text.length > EVIDENCE_MAX ? `${text.slice(0, EVIDENCE_MAX - 1).trimEnd()}…` : text;
}

export interface EvidencePart {
  text: string;
  /** Present only for an http or https address. Nothing else is ever made clickable. */
  href?: string;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const TRAILING = /[.,;:!?]+$/;

/** Splits an evidence line into plain text and web addresses, so a card can make the addresses clickable without trusting the text. */
export function evidenceParts(text: string): EvidencePart[] {
  const parts: EvidencePart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const url = raw.replace(TRAILING, '');
    if (start > last) parts.push({ text: text.slice(last, start) });
    let ok = false;
    try {
      const u = new URL(url);
      ok = u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      ok = false;
    }
    parts.push(ok ? { text: url, href: url } : { text: url });
    if (raw.length > url.length) parts.push({ text: raw.slice(url.length) });
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
