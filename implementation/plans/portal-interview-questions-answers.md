# Feature: Client portal interview prep — questions + written answers

## Overview
Give the client a way to see the interview prep questions and write answers ahead of the
live call, without touching the human/skill-driven interview-complete flow. Two new
session-scoped endpoints plus a portal page, and a small pointer on the portal home page.

Answers are supplementary prep material only: saving them never changes `Interview.status`
or the run's `stage`. Only `interview-complete` (existing route, untouched) advances things.

## Design notes / decisions
- **Scope**: `GET /api/portal/interview` lists runs for the session's `client_id` in stage
  `ready_for_interview` whose `Interview.status !== 'complete'` and `questions` is set.
  Filtered/derived in JS after a scoped `findMany` (small result set — one client's active
  runs — no need for a DB-level JSON-not-null filter).
- **"Their own" answers**: each saved answer entry is stamped with `contact_id` (the
  session's `contactId`). GET only returns entries whose `contact_id` matches the caller's
  own `contactId` — a shared client-portal link (7-day reusable, per `client-auth.ts`) may be
  used by more than one contact, so a written answer is scoped to the person who wrote it,
  not blanket-visible to the whole client team.
- **Merge-save**: `Interview.answers` is a JSON array of
  `{ question_index: number|null, question: string|null, answer: string, answered_at: ISO,
  contact_id: string }`. POST merges by key (`question_index` if provided, else exact
  `question` text) — a resubmit of the same question overwrites in place; other
  contacts'/questions' entries are preserved untouched. Order of existing entries is
  preserved (Map insertion order); new keys append.
- **Notify**: fire-and-forget `createNotification` to `run.assignee_id` (skipped if null),
  type `interview_answers_submitted`, priority `high`, title
  `Interview answers from {client name}: {run title}` (client name = `Client.name`).
- **Existence/scope pattern**: mirrors `loadActionableArticle` — 404 if the run doesn't
  exist or is deleted (existence not leaked), then `assertClientScope` (403 cross-client),
  then the state checks (409 wrong stage / interview complete).
- **Portal UI styling**: matches the existing portal pages (plain `<textarea>`/`<button>`
  elements + `border-border` / `bg-surface` / `text-text-*` tokens), not the admin
  `components/ui/*` library — consistent with `app/(portal)/portal/articles/[id]/page.tsx`
  and `app/(portal)/portal/page.tsx`.

## Files to Create
- `app/api/portal/interview/route.ts` — GET.
- `app/api/portal/interview/[runId]/answers/route.ts` — POST.
- `app/api/portal/interview/__tests__/route.test.ts`
- `app/api/portal/interview/[runId]/answers/__tests__/route.test.ts`
- `app/(portal)/portal/interview/page.tsx` — lists pending question sets, per-question
  textarea pre-filled with the caller's saved answer, per-set Save button, aria-live save
  confirmation, calm "nothing is final" copy.

## Files to Modify
- `app/(portal)/portal/page.tsx` — small fetch to `GET /api/portal/interview`; when
  non-empty, a link/section "Interview prep — N questions waiting" → `/portal/interview`.
- `lib/api/registry/portal.ts` — add both new endpoints.

## Tests to Write
- GET: 401 no session; empty list when nothing pending; excludes runs not in
  `ready_for_interview`, excludes interview status `complete`, excludes interview with no
  questions; returns only the caller's own answers (another contact's answers on the same
  run are not included).
- POST answers: 401; 404 run missing/deleted; 403 cross-client; 409 wrong stage; 409
  interview complete; 200 merges new answers preserving prior entries from other
  questions/contacts; stamps `contact_id` + `answered_at`; does not touch `status`/`stage`;
  calls `createNotification` with the run's assignee (and skips the call when
  `assignee_id` is null).

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` on both new test files — all pass
- [ ] `npx vitest run lib/api/registry/__tests__/registry.test.ts` — passes
