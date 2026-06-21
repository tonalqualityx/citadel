# Feature: [B3] Client Portal — email the requestor on completion (preview + approve links)

## Overview
When the worker loop finishes work that is ready for the client (staged for a client site,
or a completed client request), email the original requestor with BOTH the preview link
(staging URL) and the token-gated approval-page link. Neutral/professional tone, never
reveals the Bast persona. The in-repo deliverable is a server endpoint the loop calls at
close-out; the skill (W6/W7) is wired to call it.

## Impact Analysis
- **Codebase impact:** Additive. New endpoint + new service exports. Refactoring the existing
  `approval-link` route to share a token helper is the only edit to existing code; behavior
  is unchanged (mint-or-reuse semantics preserved).
- **Test impact:** `approval-link/__tests__/route.test.ts` mocks `generatePortalToken`; after
  the refactor it must mock the new `ensureTaskPortalToken` helper instead. New tests added
  for the helper, the email template, and the new route. No behavior-change to existing email
  or portal pure-function tests.

## Files to Create
- [x] `/app/api/tasks/[id]/notify-requestor/route.ts` — POST: resolve requestor contact, ensure
  token, send email with preview + approval links.
- [x] `/app/api/tasks/[id]/notify-requestor/__tests__/route.test.ts` — route tests.
- [x] `/lib/services/__tests__/portal-task-token.test.ts` — tests for `ensureTaskPortalToken`.

## Files to Modify
- [x] `/lib/services/portal.ts` — add `ensureTaskPortalToken(taskId)` (mint-or-reuse, returns url).
- [x] `/lib/services/email.ts` — add `sendTaskApprovalRequestEmail(opts)` neutral template.
- [x] `/app/api/tasks/[id]/approval-link/route.ts` — use the shared `ensureTaskPortalToken` helper.
- [x] `/app/api/tasks/[id]/approval-link/__tests__/route.test.ts` — mock the helper.
- [x] `/lib/services/__tests__/email.test.ts` — add template tests.
- [x] `/lib/api/registry/tasks.ts` — register `POST /api/tasks/:id/notify-requestor`.
- [x] `~/.openclaw/workspace/skills/citadel-worker/SKILL.md` (outside repo) — wire W6 to call the endpoint.

## Implementation Steps
1. Add `ensureTaskPortalToken` to `portal.ts` (mint or reuse unexpired token, build public URL).
2. Refactor `approval-link` route to use it.
3. Add `sendTaskApprovalRequestEmail` to `email.ts` (text + HTML, both links, Indelible branding).
4. Create `notify-requestor` route: load task + requested_by_contact + site + staging fields;
   `resolveTaskContact`; 422 if no email; ensure token; send email; return `{ sent, to, approval_url, staging_url }`.
5. Register endpoint; update skill W6.

## Tests to Update (from Impact Analysis)
- [x] `app/api/tasks/[id]/approval-link/__tests__/route.test.ts` — mock `ensureTaskPortalToken`.

## Tests to Write
- [x] `ensureTaskPortalToken`: mint when none, reuse when valid, re-mint when expired, null when missing.
- [x] `sendTaskApprovalRequestEmail`: includes both links, neutral tone, no "Bast", handles null staging URL.
- [x] `notify-requestor` route: success (sends + returns links), 422 no-contact, 404 missing task.

## Verification Checklist
- [ ] Type check clean (tsc --noEmit)
- [ ] Full test suite passes (zero broken tests)
- [ ] Production build succeeds
- [ ] One reversible commit; CI green after push
