# Feature: [C5] Client Portal — wire article review actions

## Overview
Wire the three client-portal article-review writes onto the C4 full-screen review/edit screen:
1. **Approve** → set `client_approved_at` + `approved_by_contact_id`, advance status toward `approved`.
2. **Request changes** → set status `needs_revision` + record a client-visible change-request comment.
3. **Save edits** → persist the edited article `body`.

All three are session-authed (`requireClientAuth` + `assertClientScope`) and operate only while the
article is in a client-reviewable stage. The C4 screen flips `REVIEW_ACTIONS_ENABLED` on and wires the
buttons.

## Design notes / decisions
- **Author of the change-request echo = `user_id: null`.** `ArticleComment.user_id` is nullable; the
  client projection renders `user?.name ?? null` → "Indelible". This keeps the Bast persona from ever
  leaking to the client, while the comment *content* carries the real client attribution
  (`"<Contact> (client) requested changes via the portal: …"`). is_feedback: true.
- **Actionable statuses** = `{ in_review, needs_revision }`. All three writes require the article to be
  in this set (else 400), plus 404 for hidden/internal/missing and 403 for cross-client (reusing the
  GET route's hidden-status policy). Approve is idempotent if `client_approved_at` is already set.
- **Approve advances status** `in_review|needs_revision → approved` (via the existing tested
  `recordArticleClientApproval` for the approval fields, then a status update).
- Reuse the existing `recordArticleClientApproval` service (idempotent, contact-resolving) rather than
  re-implementing approval semantics.
- Save-before-action in the UI: Approve / Request-changes auto-persist a dirty body first so edits are
  never lost (honoring the "including any edits you've made" copy) without overloading the endpoints.

## Files to Create
- [ ] `app/lib/articles/portal-actions.ts` — shared `CLIENT_HIDDEN_ARTICLE_STATUSES`,
      `CLIENT_ACTIONABLE_ARTICLE_STATUSES`, and `loadActionableArticle(id, session)` guard helper
      (findFirst → 404 hidden/missing → assertClientScope).
- [ ] `app/app/api/portal/articles/[id]/approve/route.ts` — POST approve.
- [ ] `app/app/api/portal/articles/[id]/request-changes/route.ts` — POST request-changes.
- [ ] `app/app/api/portal/articles/[id]/approve/__tests__/route.test.ts`
- [ ] `app/app/api/portal/articles/[id]/request-changes/__tests__/route.test.ts`
- [ ] `app/app/api/portal/articles/[id]/__tests__/patch.test.ts` — PATCH save-edits tests

## Files to Modify
- [ ] `app/app/api/portal/articles/[id]/route.ts` — add `PATCH` (save edits); refactor the local
      hidden-status set to import the shared one.
- [ ] `app/app/(portal)/portal/articles/[id]/page.tsx` — flip `REVIEW_ACTIONS_ENABLED`, add a
      "Save edits" control, wire the three handlers (fetch POST/PATCH), loading/error/success states.

## Implementation Steps
1. Shared `portal-actions.ts` helper (statuses + `loadActionableArticle`).
2. PATCH save-edits on the `[id]/route.ts`.
3. POST approve route.
4. POST request-changes route.
5. Wire the C4 page: save / approve / request-changes handlers + states.
6. Tests for all three endpoints + page-level safety where practical.

## Tests to Update (from Impact Analysis)
- [ ] `app/app/api/portal/articles/[id]/__tests__/route.test.ts` — unchanged behavior for GET; verify
      the hidden-status refactor doesn't break it (same set value).

## Tests to Write
- [ ] Approve: 401 no session; 404 hidden/missing; 403 cross-client; 200 records approval + advances
      status; idempotent when already approved (no status churn); 400 when not in a reviewable stage.
- [ ] Request-changes: 401; 404; 403; 400 empty note; 400 already approved; 200 creates a
      `user_id:null` client-visible comment + sets status `needs_revision`.
- [ ] Save-edits (PATCH): 401; 404; 403; 400 when already approved / not reviewable; 200 persists body.

## Verification Checklist
- [ ] Feature works as expected (3 actions from C4 screen)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test:run` — new tests pass, zero regressions
- [ ] `npm run build` succeeds
- [ ] One reversible commit; CI green after push (site auto_deploy = true → main)
