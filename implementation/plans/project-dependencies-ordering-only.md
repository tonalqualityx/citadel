# Feature: Project toggle — dependencies ordering-only vs approval-gated

Citadel task `aae8bdcd-5dd9-48c3-83aa-5aa1749cf497`.

## Overview
Add a project-level boolean `dependencies_ordering_only` (DEFAULT false) controlling how task
dependencies gate downstream work:
- **false (default) = approval-gated:** a dependent unblocks only once its blocker is `done` AND
  `approved` ("don't build on unreviewed work").
- **true = ordering-only:** a dependent unblocks as soon as its blocker is `done` (today's behavior).

The per-blocker "satisfied" predicate reads the toggle from the **blocker's** project, so mixed-mode
and multi-blocker graphs compose correctly.

## Files to Modify
- [ ] `app/prisma/schema.prisma` — add `dependencies_ordering_only Boolean @default(false)` to `Project`
- [ ] `app/prisma/migrations/<ts>_project_dependencies_ordering_only/migration.sql` — additive column (reversible)
- [ ] `app/app/api/tasks/[id]/route.ts` — gate unblock-on-done on the toggle; add approval-triggered unblock; shared `unblockEligibleDependents` helper
- [ ] `app/lib/api/formatters.ts` — expose field in `formatProjectResponse` + on the task's `project` in `formatTaskResponse`
- [ ] `app/app/api/projects/[id]/route.ts` — add `dependencies_ordering_only` to `updateProjectSchema`
- [ ] `app/app/api/projects/route.ts` — add to create schema (optional, default false)
- [ ] `app/app/api/tasks/[id]/route.ts` (GET) — add `dependencies_ordering_only: true` to the `project` select
- [ ] `app/components/domain/projects/project-form.tsx` — schema + default + payload + checkbox toggle (mirror `is_retainer`)
- [ ] `app/lib/hooks/use-projects.ts` — add field to `Project` interface (+ update input type)

## Implementation Steps
1. Schema field + `prisma generate`; hand-write & apply migration (`prisma migrate deploy`).
2. Refactor unblock logic into `unblockEligibleDependents(blockerId)` with `isBlockerSatisfied(b)`
   = orderingOnly ? `status==='done'` : `status==='done' && approved`. Use in the `done` branch of
   `propagateBlockingStatus` and in the approval path (when `approved` flips true).
3. Keep the reopen→re-block branch unchanged.
4. Expose field through formatters, project PATCH/create schemas, task GET project select.
5. UI toggle + hook type.

## Tests to Update (from Impact Analysis)
- [ ] `app/app/api/tasks/[id]/__tests__/dependency-propagation.test.ts` — existing unblock-on-done tests
  must now provide blocker `status`/`approved`/`project` and reflect the new query shape; default-mode
  (approval-gated) must NOT unblock on done.

## Tests to Write
- [ ] Default project (false): blocker→done does NOT unblock dependent (preserves "don't build on unreviewed work").
- [ ] Default project (false): blocker approved → dependent unblocks.
- [ ] ordering-only project (true): blocker→done unblocks dependent (legacy behavior preserved).
- [ ] Multi-blocker: stays blocked until ALL blockers satisfied.

## Verification Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test:run` green (incl. updated + new tests)
- [ ] `npm run build` succeeds
- [ ] Field present on GET /projects, GET /projects/[id], GET /tasks/[id] (project.dependencies_ordering_only)
- [ ] PATCH /projects/[id] sets the toggle
