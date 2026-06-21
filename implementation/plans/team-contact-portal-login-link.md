# Feature: Team action — get a client's portal login link (copy OR send)

Citadel task `9a1c9d9d` ([Loop] Team action: get a client review/login link — copy OR send on Mike's behalf).

## Overview
Today the client magic-link login is **client-initiated only** — there is no team-side way to
invite a contact in. Add a team action on each client contact to obtain that contact's portal
**login link**, two ways:
1. **Copy** — returns the URL so Mike pastes it into his own email.
2. **Send** — Citadel emails the contact the link (neutral Indelible voice; never reveals Bast).

Per-task/article *approval* links already have endpoints (`approval-link` = copy,
`notify-requestor` = send), so this task fills the genuine gap: the **login** link, surfaced on the
contact. Scoped to the contact surface (the acceptance's "on a client/contact").

### Key design decision — TTL
The self-service magic link is single-use with a **15-minute** TTL. That's too short for the
copy-paste case (Mike copies the link, writes his own email, the client may click hours later → an
expired link is a bad client-facing surprise). Team-generated invite links therefore use a longer,
clearly-named `TEAM_INVITE_TTL_DAYS = 7` window. Still single-use, still client-scoped. Documented
for Mike's review.

## Files to Create
- [ ] `app/app/api/contacts/[id]/portal-login-link/route.ts` — `POST` (pm/admin): mint a login link
      for the contact; `{ send?: boolean }`. send=false → return URL (copy); send=true → email it.
- [ ] `app/app/api/contacts/[id]/portal-login-link/__tests__/route.test.ts` — route tests.

## Files to Modify
- [ ] `app/lib/services/client-auth.ts` — add `createContactPortalLoginLink({ contactId, send,
      ipAddress, userAgent })`; add `TEAM_INVITE_TTL_DAYS`. Mints a `PortalSession`
      (token_type='client_session', action='invite'), builds URL, optionally emails. Returns
      `{ url, expiresAt, contact, sent }` or `null` if the contact is missing/deleted.
- [ ] `app/lib/services/email.ts` — generalize `sendClientMagicLinkEmail` with optional
      `expiresLabel?: string` (overrides the "N minutes" phrasing); backward compatible.
- [ ] `app/lib/hooks/use-client-contacts.ts` — add `useContactPortalLoginLink()` mutation.
- [ ] `app/components/domain/clients/client-contacts-tab.tsx` — per-contact **Copy login link** and
      **Send login link** actions (Send behind a confirm — it emails the client).
- [ ] `app/lib/api/registry/contacts.ts` — register the new endpoint.

## Implementation Steps
1. Service: `createContactPortalLoginLink` + `TEAM_INVITE_TTL_DAYS` in client-auth.ts.
2. Email: optional `expiresLabel` in `sendClientMagicLinkEmail`.
3. API route + registry entry.
4. Hook + UI buttons (copy via clipboard, send via confirm).
5. Tests; gates.

## Tests to Update (from Impact Analysis)
- [ ] `app/lib/services/__tests__/client-auth.test.ts` — add `clientContact.findUnique` to the
      prisma mock (new fn uses it). Existing `requestClientMagicLink` test uses `toMatchObject`
      (partial) and is unchanged by the new `action='invite'` value on the new path.

## Tests to Write
- [ ] Service: mints link + returns URL (send:false, no email); emails when send:true; null when
      contact missing/deleted.
- [ ] Route: copy (200, sent:false, url present); send (200, sent:true); 404 when service null;
      role enforcement (requireRole called with pm/admin).

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test:run` — new + affected suites green
- [ ] `npm run build` succeeds
- [ ] Reversible commit referencing task; auto_deploy=true → push to main.
