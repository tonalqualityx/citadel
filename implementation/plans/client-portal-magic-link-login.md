# Feature: [C1] Client Portal — magic-link login + 7-day client-scoped session

Task: 6270db81-acbc-456e-a259-7e9947db46c1 (SECURITY-CRITICAL)

## Overview
A ClientContact requests a magic link by email → receives a tokened link → clicking it
issues a **7-day client-scoped PortalSession** (browse mode). A `requireClientAuth` middleware
enforces the session can ONLY access its own client's data — never another client's, never
Indelible internals. Reuse the existing `PortalSession` model with `token_type='client_session'`,
`entity_id=client_id`, tied to the contact.

## Design decisions
- **Reuse `PortalSession`** (per Mike's explicit instruction). It is today an audit-log table;
  add nullable session columns so existing audit rows are untouched:
  `contact_id`, `magic_token` (unique), `magic_token_expires_at`, `session_token` (unique),
  `expires_at`, `consumed_at`. A login is one row: magic-link phase (magic_token set,
  session_token null) → consume phase (session_token + expires_at + consumed_at set, single-use).
- **Two tokens:** short-lived (15 min) single-use magic_token (emailed); long-lived (7 day)
  session_token (httpOnly cookie `client_session`). Mirrors password-reset + internal-login cookie patterns.
- **No email enumeration:** `/request` always returns 200 regardless of whether the email matches.
- **Multi-client email:** the same email can be a contact for >1 client (`@@unique[client_id,email]`).
  Issue one magic link per matching active contact → each consumes to that contact's own client scope.
- **Consume via GET route handler** (email links are GET): validates, sets cookie, 303-redirects to `/portal`.
  Known tradeoff (documented, not silent): email-prefetch could consume a link; short TTL bounds it; revisit if needed.
- Scope guard: `requireClientAuth()` → `{ clientId, contactId }` or 401; `assertClientScope(session, clientId)` → 403 on mismatch.

## Files to Create
- [ ] `prisma/migrations/2026..._client_portal_session/migration.sql` — additive columns + indexes
- [ ] `lib/services/client-auth.ts` — token gen, request/consume, validate, requireClientAuth, assertClientScope
- [ ] `app/api/portal/login/request/route.ts` — POST { email } → always 200
- [ ] `app/api/portal/login/[token]/route.ts` — GET consume → cookie + redirect
- [ ] `app/api/portal/clients/[clientId]/route.ts` — GET example client-scoped resource (proves middleware)
- [ ] tests: `lib/services/__tests__/client-auth.test.ts`,
      `app/api/portal/login/__tests__/request.test.ts`,
      `app/api/portal/clients/__tests__/route.test.ts`

## Files to Modify
- [ ] `prisma/schema.prisma` — PortalSession new fields + ClientContact.portal_sessions relation
- [ ] `lib/services/email.ts` — `sendClientMagicLinkEmail()` (neutral Indelible voice)
- [ ] `lib/api/registry/` — register the 3 new portal endpoints

## Tests to Update (from Impact Analysis)
- None: PortalSession columns are additive/nullable; `logPortalSession` unchanged. No existing
  test references the new fields. Verify full suite stays green.

## Tests to Write
- [ ] consume issues 7-day session; second consume of same token fails (single-use)
- [ ] expired magic_token rejected; expired session rejected by validate
- [ ] `/login/request` returns 200 for unknown email (no enumeration)
- [ ] scoped route: own client → 200, other client → 403, no session → 401

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npx prisma migrate dev` applies; schema valid
- [ ] full `vitest run` green (zero broken)
- [ ] `next build` succeeds
- [ ] one reversible commit; push to main (auto_deploy); CI green
