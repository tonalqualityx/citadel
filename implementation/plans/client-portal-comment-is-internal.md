# Feature: [A1] Client Portal — comment `is_internal` flag + client-safe filtering

## Overview
Add an `is_internal` boolean to the `Comment` model so client-facing surfaces never
expose internal/team/Bast-technical notes. New comments default client-visible
(`is_internal=false`). Bast's automated technical notes can be created with
`is_internal=true`; any Bast comment that asks the client a question stays
client-visible. The team UI can toggle a comment's internal flag. A reusable
client-visible filter is provided + wired to the comments list endpoint via an
`audience=client` view, ready for the client portal endpoints (C1/C5).

## Files to Create
- [ ] `lib/comments/visibility.ts` — `CLIENT_VISIBLE_COMMENT_WHERE`, `clientVisibleCommentWhere()`, `filterClientVisible()`
- [ ] `lib/comments/__tests__/visibility.test.ts` — helper unit tests
- [ ] `prisma/migrations/<ts>_comment_is_internal/migration.sql` — additive column

## Files to Modify
- [ ] `prisma/schema.prisma` — add `is_internal Boolean @default(false)` to `Comment`
- [ ] `app/api/tasks/[id]/comments/route.ts` — format returns `is_internal`; POST accepts optional `is_internal` (default false); GET supports `?audience=client` → client-visible filter
- [ ] `app/api/comments/[id]/route.ts` — format returns `is_internal`; PATCH can toggle `is_internal` (content now optional, at least one field required)
- [ ] `lib/hooks/use-comments.ts` — `Comment.is_internal`; `CreateCommentInput.is_internal?`; `UpdateCommentInput` content optional + `is_internal?`
- [ ] `components/domain/tasks/comment-section.tsx` — internal badge + team toggle (pm/admin)
- [ ] `lib/api/registry/tasks.ts`, `lib/api/registry/misc.ts` — response field + audience param

## Implementation Steps
1. Schema + additive migration (`ALTER TABLE "comments" ADD COLUMN "is_internal" BOOLEAN NOT NULL DEFAULT false`).
2. `lib/comments/visibility.ts` reusable filter helpers.
3. Task comments route: expose flag, accept on create, filter on `audience=client`.
4. Single comment route: expose flag, allow toggle via PATCH.
5. Hook + component: types, internal badge, team toggle.
6. Registry updates.

## Tests to Update (from Impact Analysis)
- [ ] `app/api/tasks/[id]/comments/__tests__/route.test.ts` — existing POST tests unaffected (no `is_internal` assertions); add create-default + create-internal + GET audience filter cases.

## Tests to Write
- [ ] visibility helper: where-clause shape + `filterClientVisible` drops internal
- [ ] POST defaults `is_internal=false`; honors `is_internal=true`
- [ ] GET `?audience=client` filters to `is_internal=false`

## Verification Checklist
- [ ] Type check clean (`tsc --noEmit`)
- [ ] Full suite passes incl. new tests
- [ ] Production build succeeds
- [ ] One reversible commit; additive non-destructive migration
