# Feature: Client-action notifications + view logging

## Overview
Notify the run's assignee when a client approves an article or requests changes on
it, and log/surface client article views.

## Files to Modify
- [ ] `lib/services/troubador-notifications.ts` — add
      `notifyArticleClientApproved(articleId)` and
      `notifyArticleClientChangesRequested(articleId, note)`
- [ ] `app/api/portal/articles/[id]/approve/route.ts` — fire notify on first approval
- [ ] `app/api/portal/articles/[id]/approve/__tests__/route.test.ts` — mock + assert
- [ ] `app/api/portal/articles/[id]/request-changes/route.ts` — fire notify on success
- [ ] `app/api/portal/articles/[id]/request-changes/__tests__/route.test.ts` — mock + assert
- [ ] `app/api/portal/articles/[id]/route.ts` (client GET) — insert a `PortalSession`
      view-log row, fire-and-forget, direct prisma insert (token_type not in
      `logPortalSession`'s existing union; inserting directly avoids widening a
      shared helper's type for one caller)
- [ ] `app/api/portal/articles/[id]/__tests__/route.test.ts` — mock `portalSession.create`,
      assert the view row is logged
- [ ] `app/api/troubador/articles/[id]/route.ts` (admin GET) — add
      `client_last_viewed_at` (max `created_at` of matching PortalSession rows, null
      if none)
- [ ] `lib/api/troubador-formatters.ts` — surface `client_last_viewed_at` in
      `formatArticleResponse`
- [ ] `app/api/troubador/articles/[id]/__tests__/route.test.ts` — add GET tests

## Implementation Steps
1. `notifyArticleClientApproved(articleId)`: load article (title, run{id,title,
   assignee_id}, approved_by_contact{name}); if no run/assignee, no-op; else
   `createNotification` type `article_client_approved`, priority `high`.
2. `notifyArticleClientChangesRequested(articleId, note)`: load article (title,
   run{id,title,assignee_id}); message = first 200 chars of `note` (+ ellipsis);
   `createNotification` type `article_client_changes_requested`, priority `high`.
3. approve route: after `recordArticleClientApproval`, when
   `!result.already_approved`, call `notifyArticleClientApproved(id).catch(() => {})`.
4. request-changes route: after the `$transaction` succeeds, call
   `notifyArticleClientChangesRequested(id, note).catch(() => {})`.
5. Client GET: rename `_request` → `request`, insert
   `prisma.portalSession.create({ data: { token_type: 'article_view', entity_id: id,
   contact_id: session.contactId, ip_address: getClientIp(request), user_agent:
   request.headers.get('user-agent'), action: 'view' } }).catch(() => {})` — never
   awaited, never fails the request.
6. Admin GET: after loading the article, `prisma.portalSession.findFirst({ where:
   { token_type: 'article_view', entity_id: id }, orderBy: { created_at: 'desc' },
   select: { created_at: true } })`; pass through to `formatArticleResponse` as
   `client_last_viewed_at`.

## Tests to Update
- Both portal action route tests: mock `@/lib/services/troubador-notifications`
  (currently unmocked — a real call would hit the unmocked-shape `prisma.article`
  mock and throw, which the internal try/catch would swallow, but the notify
  behavior itself needs asserting).
- Portal GET route test: add `portalSession: { create: vi.fn() }` to the prisma mock.
- Admin article route test: add `portalSession: { findFirst: vi.fn() }` to the
  prisma mock; add GET describe block.

## Tests to Write
- Approve: notifies on first approval; does NOT notify on the idempotent re-confirm.
- Request-changes: notifies with a truncated note.
- Portal GET: logs a `article_view` PortalSession row with the session's contact_id.
- Admin GET: returns `client_last_viewed_at` (null when no view row; the max
  `created_at` when present).

## Verification Checklist
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run` on all five touched test files
