# Feature: Harden dependency-unblock — no task stays silently stuck in 'blocked'

Citadel task `6d6712fc-4fb1-4855-9e12-ec866f4ce0c2`.

## Problem / Root cause
`unblockEligibleDependents(blockerId)` only fires **reactively** when a specific
blocker transitions to `done` (PATCH status) or gets `approved`. Any path that
changes whether a blocker is *satisfied* WITHOUT calling it leaves dependents
silently stuck in `blocked` — the loop only queries `not_started`, so it never
sees them. Concrete gaps:
- **Project gating toggle** (`dependencies_ordering_only` false→true): existing
  approval-gated dependents whose blockers are already `done` are never
  re-evaluated → stay blocked forever. (Most likely the C3/C4/C5 trigger.)
- **No periodic backstop**: a single missed propagation (any cause) never
  self-heals.

Satisfaction semantics (`isBlockerSatisfied`) are correct and intentional
(approval-gated vs ordering-only, shipped in f4ad1b5) — we KEEP them. The fix is
about robustly *re-running* the predicate, not changing it.

## Files to Create
- [ ] `app/lib/services/dependencies.ts` — extract `isBlockerSatisfied`,
      `unblockEligibleDependents(blockerId)` (identical query shape — keeps existing
      tests green), `reblockDependents(blockerId)`, and NEW
      `healBlockedTasks(opts?)` global self-healing sweep over ALL `blocked` tasks.
- [ ] `app/app/api/tasks/unblock-sweep/route.ts` — `POST` (pm/admin) runs
      `healBlockedTasks()`, returns `{ unblocked, ids }`. Periodic-sweep hook a
      cron/worker can call.
- [ ] `app/lib/services/__tests__/dependencies.test.ts` — unit tests for
      `healBlockedTasks` (multi-blocker order, gating modes, missed-propagation heal).

## Files to Modify
- [ ] `app/app/api/tasks/[id]/route.ts` — import the helpers from the service
      instead of local copies (no behavior change to existing triggers).
- [ ] `app/app/api/projects/[id]/route.ts` — after a regular update that sets
      `dependencies_ordering_only` (true), call `healBlockedTasks()` so newly
      ordering-only projects' dependents unblock.
- [ ] `app/lib/api/registry/tasks.ts` — register `POST /api/tasks/unblock-sweep`.

## Tests to Update (from Impact Analysis)
- [ ] `app/app/api/tasks/[id]/__tests__/dependency-propagation.test.ts` — should
      pass UNCHANGED (query shapes preserved). Run to confirm no regression.
- [ ] `app/app/api/projects/[id]/__tests__/*` (if any reference PATCH) — confirm
      the added sweep call (only on ordering-only=true) doesn't break assertions.

## Tests to Write
- [ ] heal: ordering-only project, all blockers done → unblock
- [ ] heal: approval-gated, blockers done-but-unapproved → stays blocked
- [ ] heal: multi-blocker, only fully-satisfied dependents unblock (completion order)
- [ ] heal: a `blocked` task whose propagation was "missed" gets healed on sweep
- [ ] sweep endpoint returns count + ids; pm/admin only

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test:run` green (incl. new + existing dependency tests)
- [ ] `npm run build` succeeds
- [ ] One reversible commit; push to main (site auto_deploy=true); CI green
