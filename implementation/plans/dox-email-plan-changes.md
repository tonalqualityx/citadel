# Feature: Dox applies answers and additions to the project plan (task 0301695f)

## Overview
The email splitter hands a client's answers and additions to Dox as one @Dox note on the project's home card. This wires that note to Dox's
plan-changes job so the plan moves and one comment reports it, with billing changes, changes to approved work and contradictions of a
recorded decision going to Mike.

## Files to Modify
- [x] `app/lib/auth/lane-scopes.ts`: Dox may read `GET /api/clients/:id/retainer` (hours used and projected, no rate or amount) for the billing test.
- [x] `app/lib/dox/ask.ts`: every @Dox mention stamps the task's `updated_at`, a repeat on an already tagged task included, so a second email
      note on the same home card is offered to Dox again (the scheduler only offers asked tasks changed after his last pass).

Outside this repo (no git): Dox method `skills/dox/jobs/plan-changes.md` (new section) and `jobs/sweep.md` (pointer); the scheduler
`spawn-gate.py` also scans done asked-dox cards (a closed home card); the splitter's note names the question id.

## Tests to Update
- [x] `lib/auth/__tests__/lane-dox.test.ts`: the new read is allowed; the "no retainer route" invariant exempts this one GET.
- [x] `lib/dox/__tests__/dox-slice2a.integration.test.ts`: a repeat mention bumps `updated_at`.

## Verification Checklist
- [x] `npx tsc --noEmit`
- [x] Full vitest suite (two timing-bound markdown tests flaked under load, pass alone); Dox and auth suites against a scratch database
- [x] Production build
