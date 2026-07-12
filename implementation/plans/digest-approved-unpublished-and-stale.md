# Feature: Digest coverage — approved/unpublished + stale client review

## Overview
Extend the needs-attention digest with three more article buckets so nothing that
needs Mike's attention around publishing/client stalls fails silently.

## Files to Modify
- [ ] `lib/services/needs-attention-digest.ts`
- [ ] `lib/services/__tests__/needs-attention-digest.test.ts`

## Implementation Steps
1. Add `export const STALE_CLIENT_REVIEW_DAYS = 5;`
2. `DigestArticleItem` gains an optional `reason?: string`.
3. `NeedsAttentionData` gains `approvedUnscheduled`, `pastDueUnpublished`,
   `staleClientReview: DigestArticleItem[]`. `DigestSummary.counts` mirrors them.
4. `gatherNeedsAttention`: keep the existing `{status:'in_review', approved_at:null}`
   query (now also selecting `updated_at`) — it already carries what
   `staleClientReview` needs (a subset filter, not a new query). Add ONE more query:
   `{is_deleted:false, status:{in:['approved','scheduled']}}` selecting
   `scheduled_date`, `published_url`, `status` — covers both `approvedUnscheduled`
   (`status==='approved' && scheduled_date==null`) and `pastDueUnpublished`
   (`scheduled_date != null && scheduled_date < now && !published_url`).
5. `buildDigestEmail`: generalize the hand-inlined articles block into an
   `addArticleSection(heading, items)` helper (renders `reason` under the title when
   present); call it for all four article buckets. `total` sums all seven buckets
   (note: `staleClientReview` is a subset of `articlesAwaitingReview` by
   construction — an article there is deliberately double-surfaced in the digest
   with more urgency; documented in a code comment, not deduped out of `total`).
6. `sendNeedsAttentionDigest`: after building/sending the digest, if
   `data.staleClientReview.length > 0`, call the (feature 4) client-reminder sender
   in a try/catch so a reminder failure never breaks the digest send.

## Tests to Update
- `needs-attention-digest.test.ts`: the `empty` object and the "non-empty" /
  buildDigestEmail fixtures gain the three new empty/populated array fields
  (TypeScript requires them once `NeedsAttentionData` is extended).

## Tests to Write
- `gatherNeedsAttention`: approvedUnscheduled populated when `status='approved'` +
  null `scheduled_date`; excluded when a date is set.
- `gatherNeedsAttention`: pastDueUnpublished populated when `scheduled_date` is in
  the past and unpublished; excluded when in the future or already published.
- `gatherNeedsAttention`: staleClientReview populated only past
  `STALE_CLIENT_REVIEW_DAYS`, with a `reason` naming the day count.
- `buildDigestEmail`: renders the three new sections with reasons; counts sum
  correctly.

## Verification Checklist
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run lib/services/__tests__/needs-attention-digest.test.ts`
- [ ] `npx vitest run app/api/cron/needs-attention-digest/__tests__/route.test.ts`
      (unchanged contract — should still pass untouched)
