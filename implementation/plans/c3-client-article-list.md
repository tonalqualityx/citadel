# Feature: [C3] Client Portal — client article list (their ready-for-review only)

## Overview
A magic-link-authed client-portal page (the `/portal` landing the C1 login redirects to) that lists
the logged-in client's articles that are ready for their review (`status = in_review`), client-scoped,
projected through the A2 client-view article projection (`formatArticleForClient`). Only their articles,
only ready-for-review. No other client's data, no internal fields.

## Impact Analysis
- **Codebase:** Purely additive. New API route, new portal page, one appended registry entry. No
  existing module imports or signatures change → nothing downstream breaks.
- **Tests:** No existing test asserts on the new paths. `registry.test.ts` only checks
  `apiRegistry.length > 50` and per-endpoint validity (GET endpoints need a `responseExample`) — the
  new entry must include one. No count to bump.

## Files to Create
- [ ] `app/app/api/portal/articles/route.ts` — `GET /api/portal/articles`: `requireClientAuth()` →
      `session.clientId`; list `in_review`, non-deleted articles for that client; project via
      `formatArticleForClient`; return `{ articles }`. Scope is implicit (clientId from session, not
      params) so no cross-client read is possible.
- [ ] `app/app/api/portal/articles/__tests__/route.test.ts` — 401 (no session), 200 (lists only the
      session client's `in_review` via the projection), where-clause assertions (client_id + status +
      is_deleted), no-internal-field-leak.
- [ ] `app/app/(portal)/portal/page.tsx` — client component listing the articles (title, status,
      updated date), 401 → `/portal/login`, loading/empty/error states. Each row links toward the C4
      review screen (`/portal/articles/<id>`), which C4 will build.

## Files to Modify
- [ ] `app/lib/api/registry/portal.ts` — append the `/api/portal/articles` GET entry.

## Implementation Steps
1. API route + projection wiring.
2. Registry entry.
3. Portal list page.
4. Unit tests for the route (isolation + projection + no-leak).
5. Gates: tsc, full test suite, production build.

## Tests to Update (from Impact Analysis)
- None — no existing assertions reference the new paths.

## Tests to Write
- [ ] 401 when no client session.
- [ ] 200 returns only the session client's `in_review` articles, projected (allow-list shape).
- [ ] Prisma `where` scopes to `client_id` (session), `status: in_review`, `is_deleted: false`.
- [ ] No internal field (e.g. `research_summary`, `check_report`, `client_id`) leaks in the response.

## Verification Checklist
- [ ] Client sees only their in_review articles; no other client's data; no internal fields.
- [ ] TypeScript compiles without errors.
- [ ] Unit tests pass; full suite green.
- [ ] Production build succeeds.
