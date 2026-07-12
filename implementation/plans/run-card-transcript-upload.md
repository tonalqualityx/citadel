# Feature: Admin run detail — complete interview with a pasted transcript

## Overview
Add an additional (not a replacement) path on the admin run detail page's Interview tab: when
`stage === 'ready_for_interview'`, let a human paste (or load a .txt/.md file into) a
transcript and submit it to the existing `POST /api/troubador/runs/:id/interview-complete`
route — the route already accepts an optional `transcript` body field and needs no backend
change. The existing skill-driven path (Troubador CLI calling the same route) is untouched.

If the interview has client-written answers (`Interview.answers` non-empty), they are shown
read-only above the transcript box (so Mike sees them before/during the call) and are
auto-appended to the transcript payload behind a clearly-delimited
`CLIENT WRITTEN ANSWERS (portal)` heading, so the worker's transcript-mining also picks them
up.

## Design notes / decisions
- No backend route changes — `interview-complete` already accepts `{ transcript }`.
- `formatInterviewResponse` (in `lib/api/troubador-formatters.ts`) needs `answers` added so
  the run-detail GET response carries them through to the client component. Also add
  `answers` to `RunInterview` in `lib/types/troubador.ts`.
- Confirm-before-submit uses the existing lightweight convention in this codebase
  (`window.confirm(...)`, see `app/(app)/troubador/schedules/page.tsx` and
  `components/domain/clients/client-contacts-tab.tsx`) rather than introducing a new dialog
  component.
- File read is client-side only (`FileReader`, `.txt`/`.md`) — populates the textarea; no
  upload/storage endpoint involved.
- Reuses `apiClient` directly (no new React Query hook) since this is a one-shot POST that
  navigates the whole run forward; the existing `useTroubadorRun` query gets invalidated so
  the page re-renders the post-`in_production` state.

## Files to Modify
- `components/domain/troubador/RunCard.tsx` is the board-listing card, not the target — the
  actual target is the Interview tab of the run *detail* page:
  `app/(app)/troubador/runs/[id]/page.tsx` — extend `InterviewTab`: read-only answers block
  (when present) + the transcript textarea/file-load/submit affordance, gated on
  `run.stage === 'ready_for_interview'`.
- `lib/api/troubador-formatters.ts` — `formatInterviewResponse` includes `answers`.
- `lib/types/troubador.ts` — `RunInterview.answers` field.
- `lib/hooks/use-troubador.ts` — add `useCompleteInterview()` mutation
  (`POST /troubador/runs/:id/interview-complete`), invalidating the run detail + list queries
  on success (mirrors `useUpdateProposals`).

## Tests to Write
- `lib/api/troubador-formatters` already has no dedicated test file; add coverage for
  `formatInterviewResponse` passing through `answers` — folded into whatever formatter test
  exists, or a small new one if none does (check first).
- Component-level: none currently exist for `RunDetailPage`/`InterviewTab` (verify before
  writing) — if there is a component-test convention for this page, add cases for: the
  transcript affordance only rendering in `ready_for_interview`, the confirm gate, and the
  read-only answers block rendering when `run.interview.answers` is non-empty.

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` on any touched/added test files — all pass
