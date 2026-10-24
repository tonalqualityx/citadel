/**
 * The one rule for ending the price review approval wait (charter.price_review, step 2).
 *
 * Only two things may end it: an approval that carries Mike's terms, or a denial by Mike. Both
 * must have been recorded from Mike's signed-in browser session (never a Bearer token or API
 * key). Any other resolution, whatever route it comes from, is refused here. This runs inside
 * resolveWait, the single close path used by PATCH /api/waits/:id, the Oracle "Mark handled"
 * button, placement events and the sweeper, so no caller can step around it.
 *
 * There is no approval screen yet. Until one exists, nothing can pass this guard through the
 * app, and the chain stops at Mike's approval wait on purpose.
 */
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { PRICE_REVIEW_APPROVAL_STEP, PRICE_REVIEW_TEMPLATE_KEY, readApprovedTerms } from './terms';

export class PriceReviewResolutionRefused extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'PriceReviewResolutionRefused';
  }
}

export const NOT_JUST_MARKED_HANDLED =
  'This is the price review approval. It ends only when Mike approves it with the new amount and start date, or denies it. It cannot be marked handled.';

type WaitLike = { template_key: string; step: number; action_payload: unknown };

export function isPriceReviewApproval(w: Pick<WaitLike, 'template_key' | 'step'>): boolean {
  return w.template_key === PRICE_REVIEW_TEMPLATE_KEY && w.step === PRICE_REVIEW_APPROVAL_STEP;
}

function payloadOf(w: WaitLike): Record<string, unknown> {
  return w.action_payload && typeof w.action_payload === 'object' ? (w.action_payload as Record<string, unknown>) : {};
}

/** True when the stored denial is Mike's, from his session. */
export function hasValidDenial(w: WaitLike): boolean {
  const d = payloadOf(w).price_review_denial as { denied_by?: unknown; denied_via?: unknown } | undefined;
  return !!d && d.denied_by === MIKE_USER_ID && d.denied_via === 'session';
}

/** True when the stored approval is complete: valid terms, written by Mike, from his session. */
export function hasValidApproval(w: WaitLike): boolean {
  const raw = payloadOf(w).approved_terms as { approved_by?: unknown; approved_via?: unknown } | undefined;
  return !!readApprovedTerms(w.action_payload) && raw?.approved_by === MIKE_USER_ID && raw?.approved_via === 'session';
}

/** Throws PriceReviewResolutionRefused unless this resolution may end the wait. */
export function assertPriceReviewResolution(w: WaitLike, resolution: string): void {
  if (!isPriceReviewApproval(w)) return;
  if (resolution === 'approved' && hasValidApproval(w)) return;
  if (resolution === 'declined' && hasValidDenial(w)) return;
  throw new PriceReviewResolutionRefused(NOT_JUST_MARKED_HANDLED);
}
