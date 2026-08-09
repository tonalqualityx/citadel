# Feature: Portal v2 Phase 1 (Client Account Home)

Citadel quest 17a80983. Mike green-lit 2026-08-09 (ops review Q5-Q7). Additive-only migration.
Team-side auth (tech/pm/admin login/roles) is untouched — only the client_session (magic-link
portal) surface is extended, which is explicitly in scope per the approved decision.

## Overview

1. Extend `client_session` cookie TTL 7d → 30d sliding (refreshed on activity), capped at 90d from
   session creation.
2. `GET /api/portal/home` — one payload: client identity, pending approvals (in_review articles w/
   thread + tasks awaiting client approval w/ staging preview), open projects, open/unbilled
   amounts (client-safe), recent activity feed.
3. `GET /api/portal/tasks` — session-scoped list (awaiting approval + recently approved), mirroring
   `GET /api/portal/articles`. `POST /api/portal/tasks/:id/approve` and
   `POST /api/portal/tasks/:id/request-changes` — session-scoped, reusing the token-flow mutation
   logic (extracted into shared service functions).
4. `site_stats_snapshots` table (additive) + `POST /api/cron/site-stats` (CRON_SECRET-gated
   machine ingest) + `GET /api/portal/stats` (session-scoped read, client-safe projection).
5. `/portal/home` page — matches existing `(portal)` route conventions exactly.

## Files to Create

- [ ] `prisma/migrations/<ts>_portal_v2_phase1_site_stats/migration.sql` — additive, via `prisma migrate dev`
- [ ] `app/api/portal/home/route.ts` — GET, session-scoped aggregate payload
- [ ] `app/api/portal/home/__tests__/route.test.ts`
- [ ] `app/api/portal/tasks/route.ts` — GET, session-scoped list
- [ ] `app/api/portal/tasks/__tests__/route.test.ts`
- [ ] `app/api/portal/tasks/[id]/approve/route.ts` — POST, session-scoped
- [ ] `app/api/portal/tasks/[id]/approve/__tests__/route.test.ts`
- [ ] `app/api/portal/tasks/[id]/request-changes/route.ts` — POST, session-scoped
- [ ] `app/api/portal/tasks/[id]/request-changes/__tests__/route.test.ts`
- [ ] `app/api/cron/site-stats/route.ts` — POST, CRON_SECRET-gated ingest (documents payload contract)
- [ ] `app/api/cron/site-stats/__tests__/route.test.ts`
- [ ] `app/api/portal/stats/route.ts` — GET, session-scoped read
- [ ] `app/api/portal/stats/__tests__/route.test.ts`
- [ ] `app/(portal)/portal/home/page.tsx` — client home UI
- [ ] `__tests__/e2e/portal-home.spec.ts` — Playwright coverage (seeded client_session cookie)

## Files to Modify

- [ ] `prisma/schema.prisma` — add `SiteStatsSnapshot` model + `Site.stats_snapshots` back-relation
- [ ] `lib/services/client-auth.ts` — `SESSION_TTL_DAYS` 7→30 (proper export, not just `__testing`),
      add `MAX_SESSION_TTL_DAYS = 90`, sliding refresh inside `requireClientAuth()`
      (`findActiveSessionRow` + `slideSessionExpiry` helpers; `validateClientSession()`'s external
      contract is unchanged)
- [ ] `app/api/portal/login/[token]/route.ts` — import `SESSION_TTL_DAYS` instead of the duplicated
      hardcoded `7 * 24 * 60 * 60` constant (fixes the sync footgun the two constants had)
- [ ] `lib/services/portal.ts` — extract `recordTaskClientApproval()` and
      `recordTaskClientRequestChanges()` shared service functions from the existing
      token-route inline logic, used by BOTH the token routes and the new session routes
- [ ] `app/api/portal/tasks/[token]/approve/route.ts` — call the extracted shared function (no
      behavior change)
- [ ] `app/api/portal/tasks/[token]/request-changes/route.ts` — call the extracted shared function
      (no behavior change)
- [ ] `lib/api/client-projections.ts` — add `formatSiteStatsForClient()`, extend task/article
      comment doc if needed (no field changes to existing projections)
- [ ] `lib/api/registry/portal.ts` — register 5 new endpoints
- [ ] `lib/api/registry/misc.ts` — register `/api/cron/site-stats`

## Implementation Steps

1. Schema: add `SiteStatsSnapshot` (id, site_id FK→Site, captured_at, period, payload Json, source,
   created_at), index `[site_id, captured_at]`, unique `[site_id, period, captured_at]` for
   idempotent re-push. Run `npx prisma migrate dev --name portal_v2_phase1_site_stats`.
2. `client-auth.ts`: sliding-session refactor (see Files to Modify). Update
   `login/[token]/route.ts` to import the shared constant.
3. `lib/services/portal.ts`: extract shared task-approval/request-changes service functions;
   rewire the two existing token routes to call them (behavior-preserving refactor).
4. New session-scoped task routes: list + approve + request-changes, mirroring the
   `articles` session pattern (`requireClientAuth()`, no `assertClientScope` needed since scope is
   implicit via `client_id` in the query — matching the articles list's own comment on this).
5. `site_stats_snapshots` ingest (`/api/cron/site-stats`, CRON_SECRET) + read
   (`/api/portal/stats`, session-scoped, latest snapshot per client site).
6. `/api/portal/home`: aggregate read — parallel Prisma queries (Promise.all): client identity,
   in_review articles (with thread), pending-approval tasks (portal_token minted, not yet
   client-approved) + recently-approved tasks, open projects (status in ready/in_progress/review),
   client-safe open-amount summary (Task.billing_amount where is_billable && !invoiced, + Milestone
   billing_status='triggered'), recent activity (derived: recent done/client_approved tasks +
   recently published articles — NOT the raw `ActivityLog`, which carries internal diffs like
   assignee changes that aren't client-safe; see judgment call below), latest stats snapshot
   summary if present.
7. `/portal/home` page: `'use client'`, matches `(portal)/portal/page.tsx` conventions exactly
   (fetch on mount, loading/error/empty states, existing card/placeholder classes, no new UI
   primitives).
8. Registry updates for all 5 new endpoints + response shape docs (payload contract for
   `site_stats_snapshots.payload` documented in the ingest route's own comments/types).
9. Tests: one API test file per new/modified route; extend `client-auth.test.ts` for TTL changes;
   Playwright spec for `/portal/home` seeding a real `client_session` row against local Postgres
   (no existing portal Playwright coverage to extend — first of its kind, documented as a judgment
   call).
10. Run all 4 gates. Commit in logical chunks. Push to `main` only if everything is green (that IS
    this repo's deploy — confirmed via `.github/workflows/deploy.yml`, no separate deploy step).

## Tests to Update (Impact Analysis)

- `lib/services/__tests__/client-auth.test.ts` — `requireClientAuth` describe block: the two tests
  whose mocked `portalSession.findFirst` row lacks `id`/`created_at` need those fields added (the
  sliding-refresh path now reads `row.created_at`); the shared file-level `prisma` mock needs
  `portalSession.update: vi.fn()` added; the two tests' mocked `cookies()` return needs a `set:
  vi.fn()` (the refresh path calls `cookieStore.set()`); `consumeClientMagicLink` test asserting
  "~7-day session" changes to ~30-day (that's the value `SESSION_TTL_DAYS` now drives). No other
  describe block (`validateClientSession`, `requestClientMagicLink`, `createContactPortalLoginLink`,
  `assertClientScope`) changes — `validateClientSession`'s public return shape is untouched.
- `app/api/portal/tasks/[token]/approve/__tests__/route.test.ts` and
  `.../request-changes/__tests__/route.test.ts` (if they exist — verify) — must still pass
  unchanged after the extraction refactor (behavior-preserving); only internal call path changes.

## Tests to Write

- `client-auth.test.ts`: new assertions for sliding refresh (extends near-expiry sessions, does NOT
  extend a freshly-maxed session — debounce), and the 90-day absolute cap (a session created 89
  days ago requesting a 30-day slide is capped at the 90-day mark, not given the full 30).
- `/api/portal/home`: 401 no session; scoped correctly (only session client's data, via query
  `where` assertions); no internal-field leakage (billing internals, worker identities, internal
  `approved` flag) on any sub-object; empty-state shape when nothing pending.
- `/api/portal/tasks` (list): 401; scoping; only tasks with an unexpired portal_token and no
  client_approved_at (pending) + recently-approved, client-safe projection.
- `/api/portal/tasks/:id/approve` and `/request-changes`: 401; 403 cross-client; idempotent
  approve; same side effects as the token-flow equivalents (verifies the extraction didn't drift
  behavior).
- `/api/cron/site-stats`: 401 missing/wrong secret; 200 + upsert on valid secret + payload; 400 on
  malformed envelope (missing site_id/period).
- `/api/portal/stats`: 401; scoping to the client's sites; empty/placeholder when no snapshot
  exists yet; latest-snapshot-per-site selection when multiple periods exist.
- Playwright: `/portal/home` — logged-out redirect behavior (existing broken `/portal/login`
  redirect target — out of scope to fix, just don't regress it), logged-in render of the home page
  with seeded pending approvals + a stats snapshot, and the quiet placeholder when stats are empty.

## Judgment Calls (to document in the final report)

1. **Task session-routes reuse the token-flow mutation logic via extracted shared functions**
   (`recordTaskClientApproval`/`recordTaskClientRequestChanges` in `lib/services/portal.ts`) rather
   than either duplicating logic or leaving tasks token-only. This satisfies "reuse the EXISTING
   token-flow logic server-side" literally — same code path, session-authenticated instead of
   token-authenticated. The session routes additionally call `assertClientScope` for defense in
   depth (the token routes have no session to scope against; the session routes do, so they use it).
2. **Recent activity feed is derived, not read from `ActivityLog`.** `ActivityLog.changes` is a
   free-form diff blob (assignee changes, reviewer changes, etc.) never designed for client
   exposure — projecting it client-safe would mean either a new allow-list per entity type (scope
   creep for phase 1) or risk of leaking an internal field through a diff. Instead the feed is
   synthesized directly from client-safe fields already being fetched for the home payload:
   recently-done/client-approved tasks and recently-published articles, sorted by timestamp,
   capped at N. Simpler, zero new leak surface, matches the literal ask ("task status changes,
   articles published").
3. **`site_stats_snapshots.payload` is `Json` with no server-side nested-shape enforcement** beyond
   documenting the expected `SiteStatsPayload` TypeScript contract in the ingest route. The
   collectors are explicitly out of scope for this build; over-constraining the shape now would
   just need loosening later. Top-level envelope (site_id, period, captured_at, source) IS
   validated via Zod.
4. **Cron-auth pattern chosen: `CRON_SECRET` / `x-cron-secret`** (Pattern A, matching every other
   `/api/cron/*` route) rather than the Oracle service-user Bearer-key pattern (Pattern B). Phase 1
   collectors are simple machine-side pushes, not a durable per-caller-revocable identity; Pattern A
   is the established convention for exactly this shape of endpoint.
5. **"Open invoices" is computed, not a stored Invoice** — there is no `Invoice` model in this
   schema. The client-safe open-amount summary is computed from `Task.billing_amount`
   (is_billable=true, invoiced=false) + `Milestone.billing_amount` (billing_status='triggered'),
   amount + count only, never rates/margins/internal targets.

## Verification Checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test:run` — all green, zero known-broken
- [ ] `npm run build` clean
- [ ] `npm run test:e2e` — all green (requires local Postgres up + migrated)
- [ ] Migration confirmed additive-only (new table only, no ALTER/DROP on existing tables)
- [ ] No internal field leaks in any new client-facing payload (spot-checked against
      `client-projections.ts`'s allow-list doctrine)
- [ ] Registry (`GET /api/docs`) updated for all 5 new endpoints
