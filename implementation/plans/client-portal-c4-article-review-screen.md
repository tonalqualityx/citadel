# Feature: [C4] Client Portal — full-screen article review/edit screen

## Overview
A full-page, comfortable article review/edit screen for the Client Portal at
`/portal/articles/[id]`, replacing the cramped popup. The client reads the article
comfortably and edits the body in a full-height prose editor, with Approve /
Request-changes controls present. Per the blocking task **[C5]**, the three write
actions (approve, request-changes, save-body) are *wired* there — C4 is the screen
shell + the read path.

## Editor decision (rationale posted to the task)
Article body is plain text (`Article.body String? @db.Text`); the internal team editor
(`ArticleDetail.tsx`) edits it as a plain string. Introducing a rich-text/TipTap editor
would create a storage/editor format mismatch across the whole article pipeline — out of
scope and a data-integrity risk. **C4 uses a comfortable full-screen *plain-text* editor**
(immersive prose column), faithful to storage and reversible.

## Files to Create
- [ ] `app/api/portal/articles/[id]/route.ts` — `GET` single article, client-scoped
      (`requireClientAuth` + `assertClientScope`), projected via `formatArticleForClient`,
      404 for non-existent / not-yet-client-visible (internal draft) stages.
- [ ] `app/(portal)/portal/articles/[id]/page.tsx` — full-screen review/edit screen.
- [ ] `app/api/portal/articles/[id]/__tests__/route.test.ts` — GET tests.

## Files to Modify
- (none — list page already links to `/portal/articles/[id]`)

## Implementation Steps
1. GET route: load article by id (`is_deleted:false`) with client-visible comments
   (`is_deleted:false`, ordered asc, `user.name` for author). Scope-gate on
   `article.client_id`. Hide internal pre-review/dropped stages (404).
2. Page: fetch the article; 401 → redirect to `/portal/login`; render an immersive
   full-height prose editor (controlled local state for the body) + Approve /
   Request-changes controls (panels present; submit wired in C5).
3. Keep it client-safe: neutral Indelible voice, no internal machinery, no "Bast".

## Tests to Update (from Impact Analysis)
- (none — new endpoint + new page; existing `articles/route.test.ts` GET-list unaffected)

## Tests to Write
- [ ] GET 401 when no session
- [ ] GET 403 when the article belongs to another client (scope gate)
- [ ] GET 404 when not found / when status is an internal draft stage
- [ ] GET 200 projects client-safe (no internal fields leak; comments shaped)

## Verification Checklist
- [ ] Feature works as expected (screen loads, reads, edits locally)
- [ ] TypeScript compiles without errors (`tsc --noEmit`)
- [ ] Unit tests pass; new tests included
- [ ] Production build succeeds
- [ ] No regressions in existing tests
- [ ] One reversible commit; pushed to `main` (site auto_deploy = true); CI green
