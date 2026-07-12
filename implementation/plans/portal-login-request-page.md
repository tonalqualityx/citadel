# Feature: Client Portal Magic-Link Login (Request Page)

## Overview
The client-portal magic-link flow already has working API endpoints — `POST
/api/portal/login/request` (non-enumerating, rate-limited 10/min/IP) issues a
link, and `GET /api/portal/login/[token]` redeems it, redirecting failures to
`/portal/login?error=invalid`. That destination page does not exist yet, and
the portal home page (`app/(portal)/portal/page.tsx`) also `router.replace`s
to `/portal/login` on a 401. This feature adds the missing page: an email
request form, a non-revealing confirmation state, a 429 message, and an
`error=invalid` banner read from the query string. It also adds a small
cross-link from the team login page for client users who land there by
mistake.

This is additive only — no existing API, schema, or service code changes.

## Impact Analysis (informal — small, additive surface)
- **Codebase impact**: No existing code imports or calls into a
  `/portal/login` page component (it doesn't exist yet), so nothing can break
  from adding it. Two existing call sites already assume its existence as a
  redirect target: `app/api/portal/login/[token]/route.ts` (redirect on
  invalid/expired token) and `app/(portal)/portal/page.tsx` (redirect on 401).
  Neither needs modification — they already point at the right URL and query
  param (`?error=invalid`).
- **Test impact**: No existing test references `/portal/login` or renders a
  page from `app/(portal)/portal/login/`. `app/api/portal/login/__tests__/request.test.ts`
  covers the API route already and is untouched by this change. No existing
  test file needs modification.

## Files to Create
- [ ] `app/(portal)/portal/login/page.tsx` — the request form / confirmation /
      error-banner page (client component).
- [ ] `app/(portal)/portal/login/__tests__/page.test.tsx` — component test for
      the new page.

## Files to Modify
- [ ] `app/(auth)/login/page.tsx` — add a small "Client? Request a magic
      sign-in link" link pointing to `/portal/login`, placed near the existing
      "Forgot password?" link. No structural changes to the rest of the page.

## Implementation Steps
1. Build `PortalLoginPage` as a default export that renders a `<Suspense>`
   boundary around an inner `PortalLoginForm` component, since the inner
   component reads `useSearchParams()` (Next.js app-router requirement —
   mirrors the existing pattern in `app/(auth)/reset-password/page.tsx`).
2. `PortalLoginForm` state machine:
   - `idle`/form state: email input + submit button.
   - `submitted` state: shown after any 2xx response from
     `POST /api/portal/login/request` (or after a non-429 network/fetch
     failure — per spec, the confirmation must not reveal whether the email
     matched, so we show the same reassuring copy even on a request-level
     error, reserving distinct handling only for 429).
   - `429` handling: caught before flipping to submitted state; shows a
     distinct "Too many requests" message and leaves the form visible/re-
     submittable.
   - Reads `error` search param once on mount; if `=invalid`, renders a banner
     above the form with the expired-link copy. The banner is independent of
     submission state and only concerns the initial page load.
3. Styling: follow the established **portal** visual convention (plain
   elements + token classes), not the team-app `Card`/`Input`/`Button` kit —
   matches `app/(portal)/portal/msa/[token]/page.tsx` and
   `app/(portal)/portal/task-approval/[token]/page.tsx`:
   `rounded-lg border border-border bg-surface p-*`, `text-text-main`,
   `text-text-secondary`, `text-text-tertiary`, `bg-brand-primary` for the
   primary button, `bg-status-error/10` + `border-status-error/30` (or
   `text-status-error`) for error/banner treatments — mirroring the existing
   `bg-status-success/10` success-panel pattern used elsewhere in the portal.
4. Accessibility: `<label htmlFor>` on the email field, `autoComplete="email"`,
   an `aria-live="polite"` region wrapping the area that swaps between
   form/confirmation/error text so screen readers announce the state change,
   visible focus (rely on the existing focus-visible ring utility classes
   already used across the portal's plain `<input>`/`<button>` elements).
5. Wire the fetch: `POST /api/portal/login/request` with
   `{ 'Content-Type': 'application/json' }` and `JSON.stringify({ email })`;
   branch on `res.status === 429` vs `res.ok` vs other non-ok; parse body
   defensively with `.catch(() => ({}))` per the existing portal fetch
   convention (see `task-approval/[token]/page.tsx`'s `postAction`).
6. Add the cross-link in `app/(auth)/login/page.tsx`'s `CardFooter`, right
   below the existing "Forgot password?" `Link`, same `text-sm text-text-sub
   hover:text-primary` treatment, `href="/portal/login"`.

## Tests to Update (from Impact Analysis)
- None — no existing test asserts on the previous (non-existent) state of
  `/portal/login` or on `app/(auth)/login/page.tsx`'s exact link count/markup
  in a way this addition would break. (Confirmed no `*.test.tsx` under
  `app/(auth)/login/` exists.)

## Tests to Write
- [ ] `app/(portal)/portal/login/__tests__/page.test.tsx`:
  1. Initial render: shows the heading "Sign in to the client portal", the
     email input (`getByLabelText`), and the submit button; no confirmation
     text present.
  2. Submitting a valid-looking email flips to the confirmation state and
     shows the "Check your inbox" copy; the email input is no longer
     rendered.
  3. A 429 response from the mocked fetch keeps the form visible and shows
     the "Too many requests" message instead of the confirmation state.
  4. Rendering with `useSearchParams` mocked to return `error=invalid` shows
     the expired-link banner copy.
  - Mock `global.fetch` per-test (vi.fn) and mock `next/navigation`'s
    `useSearchParams` (pattern: `vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(...) }))`), following the
    existing `vi.mock('next/navigation', ...)` style seen in
    `app/(app)/clients/__tests__/page.test.tsx` and
    `app/(app)/sites/__tests__/page.test.tsx`.

## Verification Checklist
- [ ] Feature works as expected (manual reasoning — no dev server smoke test
      performed as part of this pass; API contract already exercised by
      `app/api/portal/login/__tests__/request.test.ts`)
- [ ] `npx tsc --noEmit` passes
- [ ] New test file passes (`npm test -- --run app/(portal)/portal/login/__tests__/page.test.tsx`)
- [ ] No regressions in existing tests touched by this change (none expected —
      no existing test file overlaps the modified/created files)
