# Feature: [C2] Client Portal — article client-approval fields + ready-for-review status

## Overview
Add client-approval tracking to the `Article` model, mirroring the Task model's
client-approval fields. A client (ClientContact, not a User) can record approval of an
article. The review states (`in_review` = ready for client review, `needs_revision` =
changes requested) already exist on `ArticleStatus` — confirmed, no change needed.

Scope is the **data layer only** (schema + migration + a record-approval service helper +
tests). The client article list (C3), full-screen review/edit screen (C4), and wired review
actions / portal token (C5) are separate downstream tasks — NOT in scope here.

## Files to Modify
- [ ] `app/prisma/schema.prisma` — `Article`: add `client_approved_at`,
      `approved_by_contact_id` + `approved_by_contact` relation + index.
      `ClientContact`: add `approved_articles` back-relation.
- [ ] `app/lib/services/portal.ts` — add `resolveArticleContact` + `recordArticleClientApproval`.

## Files to Create
- [ ] `app/prisma/migrations/20260621200000_article_client_approval/migration.sql` —
      additive nullable columns + index + FK (reversible, no data loss).
- [ ] `app/lib/services/__tests__/article-approval.test.ts` — unit tests for the new helpers.

## Implementation Steps
1. Add the two nullable fields + relation + index to `Article`; add back-relation to `ClientContact`.
2. Hand-author the migration SQL matching the existing additive style (cf.
   `20260620200556_bast_work_support` which added the same columns to `tasks`).
3. `prisma generate` so the client types pick up the new fields.
4. Add `resolveArticleContact(article)` (resolves the client's primary contact — articles
   have no requestor) and `recordArticleClientApproval(articleId, contactId?)` (idempotent;
   sets both fields, resolving the primary contact when none supplied) to `portal.ts`.
5. Write unit tests mocking `@/lib/db/prisma`.

## Tests to Update (from Impact Analysis)
- None. New fields are additive and nullable; `formatArticleResponse` is unchanged, the
  article PATCH route is unchanged, no existing assertion references these fields.

## Tests to Write
- [ ] records approval, resolving the client's primary contact when no contact supplied
- [ ] uses an explicitly-supplied contactId
- [ ] idempotent — already-approved article is a no-op, returns `already_approved: true`
- [ ] returns null for a missing/deleted article
- [ ] `resolveArticleContact` returns the primary contact / null when none

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test:run` — full suite green incl. new tests
- [ ] `npm run build` succeeds
- [ ] One reversible commit; push to main (auto_deploy=true); CI green
