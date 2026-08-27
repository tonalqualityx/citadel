# Feature: Troubador publish deadlock — dated articles vanish from the work-queue

Citadel quest `b591542b-9bd1-41e2-9a40-561b2c0f4097`.

## Overview

Reported symptom: a human-scheduled ("dated") article disappears from
`GET /api/troubador/work-queue` and can never auto-publish, on any site.

### What the investigation actually found

The reported cause — "the work-queue only surfaces `status=approved` articles" —
is **already fixed** (commit `8928235`, 2026-06-22): the queue scans `publishing`
runs and emits `publish_article` for both `approved` articles and `scheduled`
articles whose date has arrived. Verified against live prod this pass: the queue
returns 3 `publish_article` items, two of which are `scheduled` Botanical Dream
articles whose dates have passed.

The **live** remaining defect is the one Mike noted parenthetically, and it is a
true deadlock:

1. `PATCH /api/troubador/articles/:id { scheduled_date: null }` clears the date
   but leaves `status = 'scheduled'`
   (`app/app/api/troubador/articles/[id]/route.ts:173-175`).
2. The work-queue's scheduled branch requires `a.scheduled_date` to be non-null
   (`app/app/api/troubador/work-queue/route.ts:104-109`), so a
   `scheduled` + `scheduled_date = null` article is **invisible forever** —
   it is neither `approved` (publish-now branch) nor a dated article.
3. The obvious human recovery, `PATCH { status: 'approved' }`, returns **200 and
   silently does nothing**: the Zod schema accepts the full `ArticleStatus` enum,
   but the handler only acts on `published` and
   `researched|drafting|in_review`. Every other accepted value is swallowed.

That is exactly "vanishes from the queue entirely and the driver never sees it".

## Files to Modify
- [ ] `app/app/api/troubador/articles/[id]/route.ts` — un-schedule reverts status; no silent status no-ops
- [ ] `app/app/api/troubador/work-queue/route.ts` — surface a dateless `scheduled` article (repairs already-stranded rows)
- [ ] `app/lib/api/registry/troubador.ts` — document both behaviours

## Implementation Steps

1. **Un-schedule reverts to `approved`.** In the `data.scheduled_date === null`
   branch, when the article's current status is `scheduled`, also set
   `status = 'approved'` and flag `advanceRun` so the run stage recomputes.
   `scheduled` is only reachable from `approved` (line 168-169), so `approved`
   is the correct restore point.
2. **No silent status no-ops.** After the existing status handling, reject any
   `status` value the handler did not act on with a 400 that names the right
   route:
   - `approved` → use `action: 'approve'` (keeps the pm/admin role gate and the
     worker 403 intact — this must NOT become a writable status)
   - `dropped` / `postponed` → use `action: 'drop'` / `action: 'postpone'`
   - `pending_research` → not a valid manual transition
   - `scheduled` → supported when a date will exist (payload or already on the
     row); otherwise 400. This also closes a second silent swallow: the locked
     worker guard (line 100) explicitly permits `status: 'scheduled'`, which the
     handler then ignored.
3. **Work-queue safety net.** Treat `status = 'scheduled'` with a null
   `scheduled_date` as publish-now, alongside the `approved` branch. Step 1
   makes the state unreachable via the API, but rows already stranded in prod
   need a way back into the queue.
4. Update the registry `responseNotes` for both endpoints.

## Tests to Update (from Impact Analysis)
- None break. `app/app/api/troubador/articles/[id]/__tests__/route.test.ts` only
  sends `status: 'in_review'` (still valid) or `action: *` payloads.
  `app/app/api/troubador/work-queue/__tests__/route.test.ts` asserts on
  approved / scheduled-date-arrived, both unchanged.
- UI callers (`ArticleDetail.tsx`, `ArticleTable.tsx`) only ever send
  `action` + `scheduled_date`; `UpdateArticleInput` does not expose `status`.
  No UI change needed.

## Tests to Write
- [ ] Clearing `scheduled_date` on a `scheduled` article reverts it to `approved` and recomputes the run stage
- [ ] Clearing `scheduled_date` on a non-`scheduled` article leaves status alone
- [ ] `PATCH { status: 'approved' }` returns 400 (no more silent 200) and writes nothing
- [ ] `PATCH { status: 'dropped' }` / `{ status: 'postponed' }` return 400
- [ ] `PATCH { status: 'scheduled' }` with a date in the payload sticks
- [ ] `PATCH { status: 'scheduled' }` with no date anywhere returns 400
- [ ] `PATCH { status: 'in_review' }` still works (regression)
- [ ] work-queue surfaces `publish_article` for a `scheduled` article with a null `scheduled_date`

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] Full `npm test` suite green
- [ ] `npm run build` clean
- [ ] Registry updated
