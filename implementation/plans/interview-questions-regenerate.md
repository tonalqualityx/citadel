# Feature: Interview-questions regeneration

## Overview
`POST /api/troubador/runs/:id/interview-questions` currently only accepts a run in
`researching` stage (the worker's first-pass path). Once the run advances to
`ready_for_interview` there is no way to regenerate/replace the prep questions — a one-shot
gap. Widen the route to also accept a second path: stage `ready_for_interview` with the
interview not yet complete. In that path the questions are replaced but the stage does NOT
change (already at `ready_for_interview`) and the article-research-completeness check is
skipped (those articles already passed that gate to get here).

Guard matrix:
- `researching` (existing path): article pending-research check still applies; upsert
  questions; advance stage → `ready_for_interview`.
- `ready_for_interview` AND interview status !== `complete` (new path): upsert questions
  (replace); stage stays `ready_for_interview`.
- `ready_for_interview` AND interview status === `complete`: 409 (interview already
  wrapped — no reopening via this route).
- Any other stage: 409.

## Files to Modify
- `app/api/troubador/runs/[id]/interview-questions/route.ts` — branch on stage; skip the
  article check on the regenerate path; only advance stage on the `researching` path.
- `lib/api/registry/troubador.ts` — update the `POST /api/troubador/runs/:id/interview-questions`
  summary/responseNotes to describe both paths.

## Files to Create
- `app/api/troubador/runs/[id]/interview-questions/__tests__/route.test.ts` — no existing
  test file was found for this route; write it from scratch, covering both the original
  behavior and the new regenerate behavior.

## Tests to Write
- 404 when run not found.
- 409 when stage is `topic_selection` / `in_production` (neither accepted stage).
- `researching` + an article still `pending_research` → 409 (existing guard, unchanged).
- `researching` + all researched → 200, questions upserted, stage → `ready_for_interview`.
- `ready_for_interview` + interview status `pending` → 200 (regenerate), questions replaced,
  stage stays `ready_for_interview`.
- `ready_for_interview` + interview status `complete` → 409.

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` on the new test file — all pass
- [ ] `npx vitest run lib/api/registry/__tests__/registry.test.ts` — passes
