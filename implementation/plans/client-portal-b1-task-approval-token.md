# Feature: [B1] Client Portal — per-task approval token + approval page

## Overview
A per-task approval token (mirrors the proposal/contract portal-token pattern) and a
token-gated public approval page. The page shows the staging preview (embeds
`staging_preview_url`) and renders three actions — Approve / Something's not right /
Add a new task. Actions are wired in B2; B1 only renders them. Uses the A2
`formatTaskForClient` client-view projection.

Repo: the Citadel app itself (`app/`). Site `auto_deploy = true` → ships to `main`.

## Files to Create
- [ ] `app/app/api/portal/tasks/[token]/route.ts` — GET: validate token, log view, return client-projected task + preview fields
- [ ] `app/app/api/tasks/[id]/approval-link/route.ts` — POST (authed pm/admin): mint/return the per-task approval token URL
- [ ] `app/app/(portal)/portal/task-approval/[token]/page.tsx` — public approval page (preview embed + 3 buttons)
- [ ] `app/app/api/portal/tasks/__tests__/route.test.ts` — GET route tests
- [ ] `app/app/api/tasks/[id]/approval-link/__tests__/route.test.ts` — mint route tests

## Files to Modify
- [ ] `app/prisma/schema.prisma` — add `portal_token` + `portal_token_expires_at` (+ index) to `Task` (mirrors Proposal/Contract/Addendum)
- [ ] `app/prisma/migrations/<ts>_task_approval_token/migration.sql` — additive nullable columns + index (reversible)
- [ ] `app/lib/services/portal.ts` — add `validateTaskToken(token)`; extend `logPortalSession` `tokenType` union with `'task_approval'`
- [ ] `app/lib/api/registry/portal.ts` — register `GET /api/portal/tasks/:token`
- [ ] `app/lib/api/registry/tasks.ts` — register `POST /api/tasks/:id/approval-link`

## Implementation Steps
1. Schema: add nullable `portal_token VarChar(128)` + `portal_token_expires_at DateTime?` + `@@index([portal_token])` to Task. Hand-write the migration (additive — no data loss, reversible). `prisma generate`.
2. `portal.ts`: `validateTaskToken` loads the task (with `comments` → `user` for the projection) by `portal_token`, `is_deleted:false`, returns null if missing/expired. Add `'task_approval'` to the `logPortalSession` tokenType union.
3. GET `/api/portal/tasks/[token]`: 404 if invalid; log `task_approval`/`view`; return `{ task: formatTaskForClient(task), staging_preview_url, staging_deployed_at, already_approved }`. `staging_preview_url` returned at the endpoint level (NOT added to the allow-list projection, keeping the projection internal-safe).
4. POST `/api/tasks/[id]/approval-link`: authed (pm/admin); generate token if absent (reuse existing one if still valid), persist, return `{ url, token, expires_at }` using `NEXT_PUBLIC_APP_URL`.
5. Public page: fetch the GET endpoint, show title/description + embedded preview iframe, render the 3 buttons. Buttons render only (B2 wires them) — clicking shows an inline "being finalized" note rather than faking a server action.
6. Registry entries for both new endpoints.

## Tests to Update (from Impact Analysis)
- None. `formatTaskForClient` is unchanged (preview is returned at the endpoint, not the projection), so existing `client-projections.test.ts` and `portal/proposals` tests are unaffected.

## Tests to Write
- [ ] GET portal task: valid token → 200 with projected task + preview; invalid → 404; logs `task_approval`/`view`.
- [ ] Mint link: unauth → 401/403; valid → returns url+token; reuses an existing unexpired token.

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test:run` green (new + existing)
- [ ] `npm run build` succeeds
- [ ] One reversible commit; pushed to `main`; CI green
