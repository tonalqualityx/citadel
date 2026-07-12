# Feature: Portal client status view ("what happened to my feedback?")

## Overview
The client portal home page (`app/(portal)/portal/page.tsx`) only ever shows articles
`in_review` — the moment a client requests changes, approves, or the piece gets scheduled/
published, it vanishes from their view with no trace. This adds three read-only, low-clutter
status sections below the existing "Ready for your review" list so a client can see where their
feedback went, without opening any new write surface.

Approval: granted (per task brief). Proceeding straight to implementation.

## Impact Analysis (existing callers/tests)
- `app/api/portal/articles/route.ts` — GET handler being extended. Only caller: the portal home
  page fetch.
- `lib/api/client-projections.ts` — adding a new projection function alongside
  `formatArticleForClient`; existing function/behavior untouched (back-compat for the `articles`
  key and the C4 detail route, which imports `formatArticleForClient` directly).
- `app/api/portal/articles/__tests__/route.test.ts` — asserts the exact `where` shape of the
  *first* `findMany` call and the `articles` response key/shape. Keeping the in-review query as
  its own first `findMany` call (rather than folding all statuses into one query) keeps those
  assertions valid untouched; new tests are added for the three new response keys.
- `app/(portal)/portal/page.tsx` — rewritten to render the new sections; no other page imports
  this component.
- No change to `lib/articles/portal-actions.ts` action-gating (CLIENT_ACTIONABLE_ARTICLE_STATUSES /
  CLIENT_HIDDEN_ARTICLE_STATUSES) — those still gate the C4 write screen only; this feature is
  read-only and additive.

## Files to Create
- None (extends existing files).

## Files to Modify
- `lib/api/client-projections.ts` — add `formatArticleForClientSummary()`: allow-list projection
  exposing only `id, title, status, updated_at`, plus `published_url` ONLY when
  `status === 'published'`.
- `app/api/portal/articles/route.ts` — add three more session-scoped, `is_deleted: false`
  queries (kept as separate `findMany` calls, in-review query unchanged/first):
  - `in_revision`: `status: 'needs_revision'`
  - `approved`: `status: { in: ['approved', 'scheduled'] }`
  - `published`: `status: 'published'`
  Response becomes `{ articles, in_revision, approved, published }`; `articles` key/shape
  unchanged.
- `app/(portal)/portal/page.tsx` — fetch + render the three new sections (only when non-empty),
  below "Ready for your review". Published items link out via `<a target="_blank"
  rel="noopener noreferrer">`; the other two sections are plain, non-clickable rows (no route
  exists for a non-actionable article and none should be added — hidden/actionable status policy
  in `portal-actions.ts` is unchanged).

## Implementation Steps
1. Add `formatArticleForClientSummary` to `client-projections.ts`.
2. Extend the GET route with the three additional scoped queries + projection + response keys.
3. Extend `app/(portal)/portal/page.tsx` with the three read-only sections.

## Tests to Update (from Impact Analysis)
- `app/api/portal/articles/__tests__/route.test.ts` — existing three tests (401, in-review where
  clause, projection, empty list) remain valid as-is since the in-review query/shape/response key
  don't change; add new tests for the new keys.

## Tests to Write
- GET returns `in_revision` for `needs_revision` articles, client-safe projected.
- GET returns `approved` for both `approved` and `scheduled` statuses.
- GET returns `published` for `published` articles, including `published_url`.
- Summary projection never includes `published_url` for non-published statuses.
- Summary projection never leaks internal fields (research_summary, run_id, client_id, etc.).

## Verification Checklist
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test -- --run app/api/portal/articles/__tests__` passes
- [ ] No regressions in `app/api/portal/articles/[id]/__tests__`
