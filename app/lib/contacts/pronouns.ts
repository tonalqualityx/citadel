import { z } from 'zod';

/**
 * Contact pronouns (2026-11-19). The value is free text ("he/him", "she/they"); the source says how
 * we know it:
 *   stated    the person, or Mike, told us
 *   signature read from the person's email signature
 *   assumed   a guess; never write it as fact
 * Both null means nobody has filled it yet. The local pronouns sweep checks the mail signature for a
 * new contact and fills it.
 */
export const PRONOUNS_SOURCES = ['stated', 'signature', 'assumed'] as const;
export type PronounsSource = (typeof PRONOUNS_SOURCES)[number];

export const PRONOUNS_SOURCE_LABELS: Record<PronounsSource, string> = {
  stated: 'Stated',
  signature: 'From signature',
  assumed: 'Assumed',
};

/** Zod fields shared by the contact create and update bodies. */
export const pronounsFields = {
  pronouns: z.string().trim().max(50).optional().nullable(),
  pronouns_source: z.enum(PRONOUNS_SOURCES).optional().nullable(),
};

/**
 * The pronoun columns to write for a create or update body. Rules:
 * - pronouns not sent: only an explicit pronouns_source is written (e.g. confirming an assumption).
 * - pronouns empty or null: both columns are cleared.
 * - pronouns sent without a source: the source is "stated" (a person typed it in).
 */
export function pronounsWrite(data: {
  pronouns?: string | null;
  pronouns_source?: PronounsSource | null;
}): { pronouns?: string | null; pronouns_source?: PronounsSource | null } {
  if (data.pronouns === undefined) {
    return data.pronouns_source === undefined ? {} : { pronouns_source: data.pronouns_source };
  }
  const value = (data.pronouns ?? '').trim();
  if (!value) return { pronouns: null, pronouns_source: null };
  return { pronouns: value, pronouns_source: data.pronouns_source ?? 'stated' };
}
