# Feature: client proposals in Triage

## Overview
Mike (2026-11-18): plans Bast proposes for an underspecified client ask should be visible in Citadel's Triage, marked as proposed from a client request. His emailed yes already starts the work (email-check 1c, plan_approval.py record).

## Decision: show by tag, do not change status
Option A, set status `triage` on the proposal: rejected.
- Only Mike's session or the bast-chat lane may take a task out of status triage (task-patch.ts mayLeaveTriage / assertTriageExit). plan_approval.py PATCHes with Bast's token, so the emailed yes would be refused (403) and the yes would stop working.
- Triage cards carry Release/Drop/Undo, keyed on status triage; release would bypass the plan-approval flip, ledger and graduation.
- Portal visibility hides status-triage tasks from the client who asked.
Option B, chosen: loadTriage also returns `client_proposals`: not-deleted tasks, status not in (triage, done, abandoned), tagged `client-proposal` AND `plan-approval`. The spawn gate's blocking tags are untouched. The emailed yes drops `plan-approval` (plan_approval.py new_tags, already existing behaviour, verified and now tested), so the card leaves the list; status goes to not_started in the same single PATCH.

## Tag: `client-proposal`
Set by recommend_lib.finish_sends (owner route) after the plan is emailed and commented: one PATCH on a fresh read, tags only, idempotent, best effort (a failure logs and never fails the send). The client route parks under the Oracle holder with `client-plan-approval` and is not on Mike's list; unchanged.

## Impact analysis
- loadTriage consumers: app/api/home/route.ts, HomeScreen, home-screen-logic (tile count = triage.count, now includes proposals). Release/drop/undo code reads status-triage rows only, unaffected.
- Types: HomeTriage gains optional `client_proposals`.
- plan_approval.py: no change needed (flip already sets not_started and drops plan-approval). No .bak because untouched.
- recommend_lib.py: .bak-20261118-proposal-tag. Planning logic, graduation ledger, auto-approve sweep untouched.

## Files
- [x] app/lib/tasks/client-proposals.ts (pure where/select/shape)
- [x] app/lib/tasks/triage.ts, app/lib/home/types.ts, app/lib/tasks/triage-copy.ts
- [x] app/components/domain/home/TriageBoard.tsx (+ home-tokens.css spacing)
- [x] ~/.claude/tools/intake/recommend_lib.py

## Tests
- Update: tests/test_recommend_wrapper.py (mike route now issues the tag PATCH; helper posts() excludes it).
- Write: lib/tasks/__tests__/client-proposals.test.ts, TriageBoard.test.tsx (badge, client name, no Release, empty state), test_recommend_wrapper ProposalTag (3), test_plan_approval (yes clears list).

## Verification
- [ ] tsc 0, npm test, py_compile
