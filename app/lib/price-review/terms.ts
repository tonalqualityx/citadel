/**
 * The terms Mike approves in the price review approval step: the new amount, how often it is
 * billed, and the date it starts. This record is the ONLY source of a number in the client note.
 * It is written by PATCH /api/waits/:id (resolve, approved) when the signed-in user is Mike, and
 * read back by the send step. Nothing else can put a number into the mail.
 */
import { z } from 'zod';

export const PRICE_REVIEW_TEMPLATE_KEY = 'charter.price_review';
export const PRICE_REVIEW_APPROVAL_STEP = 2;

function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export const approvedTermsSchema = z
  .object({
    /** The new price in cents, for one billing period. Always more than zero. */
    new_amount_cents: z.number().int().min(1).max(100_000_000),
    period: z.enum(['monthly', 'annually']),
    /** The calendar date the new price starts, YYYY-MM-DD. */
    effective_on: z.string().refine(isRealDate, 'effective_on must be a real date, YYYY-MM-DD'),
  })
  .strict();

export type ApprovedTerms = z.infer<typeof approvedTermsSchema>;

/** What is stored on the approval wait: the terms plus who approved and when. */
export interface ApprovalRecord extends ApprovedTerms {
  approved_by: string;
  approved_at: string;
}

/** The terms inside a stored action_payload, or null when absent or malformed. */
export function readApprovedTerms(payload: unknown): ApprovedTerms | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as Record<string, unknown>).approved_terms;
  if (!raw || typeof raw !== 'object') return null;
  const { new_amount_cents, period, effective_on } = raw as Record<string, unknown>;
  const parsed = approvedTermsSchema.safeParse({ new_amount_cents, period, effective_on });
  return parsed.success ? parsed.data : null;
}
