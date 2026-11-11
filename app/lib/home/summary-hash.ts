/**
 * Slice 2b: the stamp that ties a stored card summary to the description it was written from. Pure and small so the
 * screen (select.ts) and the keeper route use the same one. sha256 of the stored description string, hex.
 */

import { createHash } from 'crypto';

/** sha256 hex of Task.description as stored, or null when there is no description. */
export function descriptionHash(description: string | null | undefined): string | null {
  if (typeof description !== 'string' || description === '') return null;
  return createHash('sha256').update(description, 'utf8').digest('hex');
}

/** A stored card_checklist (JSON) as plain lines: a list of non-empty strings, else []. */
export function readStoredChecklist(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
}
