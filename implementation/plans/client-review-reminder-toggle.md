# Feature: Client review reminder emails (toggled OFF)

## Overview
Optional, throttled reminder email to a client's primary contact for articles stuck
in `staleClientReview`. Gated behind `CLIENT_REVIEW_REMINDERS_ENABLED === 'true'`
(absent/default = off) — Mike is not ready to auto-email clients yet.

## Files to Create
- [ ] `lib/services/client-review-reminders.ts` — `sendClientReviewReminders(articleIds)`
- [ ] `lib/services/__tests__/client-review-reminders.test.ts`

## Files to Modify
- [ ] `lib/services/needs-attention-digest.ts` — call the sender from
      `sendNeedsAttentionDigest()` (wrapped in try/catch)

## Implementation Steps
1. `sendClientReviewReminders(articleIds: string[])`: no-op (`{sent:0,
   skipped: articleIds.length}`) unless `CLIENT_REVIEW_REMINDERS_ENABLED === 'true'`.
2. When enabled: load `{id, title, client_id}` for the ids. For each: check a
   throttle via `PortalSession` (`token_type: 'review_reminder', entity_id:
   articleId, created_at >= now - 5d`) — skip if found. Resolve recipient: primary
   `ClientContact` for the client, else `Client.email`. Skip if neither exists. Send
   via `sendEmail` (neutral voice, links to `/portal/login`). Record a
   `review_reminder` PortalSession row after sending (throttle marker).
3. Wire into `sendNeedsAttentionDigest`: `if (data.staleClientReview.length) { try {
   await sendClientReviewReminders(data.staleClientReview.map(a => a.id)); } catch
   { /* never break the digest */ } }`

## Tests to Write
- OFF by default (no env var): sends nothing, doesn't touch prisma/email.
- ON: sends to the primary contact; falls back to `Client.email` when no primary
  contact; skips (no send) when a `review_reminder` row exists within 5 days;
  sends again once the throttle window has passed.

## Verification Checklist
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run lib/services/__tests__/client-review-reminders.test.ts`
