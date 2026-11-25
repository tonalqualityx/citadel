# Feature: Initiative record (task 86b299d9)

## Overview
The initiative record, its one to three numbers, readings, check-ins and computed health, plus an optional link from a project or task (a process change is a task). API only: no screens, no nightly `citadel:<key>` job. Spec: `/home/mike/Documents/projects/citadel-initiatives/design.md` 2.1 to 2.3.

## Files to Create
- [x] `app/prisma/migrations/20261127094000_initiatives/migration.sql` - additive: enums, four tables, two nullable columns, indexes, FKs
- [x] `app/lib/initiatives/health.ts` - pure health rules 0 to 4, caps (5 active, 3 numbers)
- [x] `app/lib/initiatives/service.ts` - schemas, activation and cap checks, stored-health recompute
- [x] `app/app/api/initiatives/route.ts` - list, create
- [x] `app/app/api/initiatives/[id]/route.ts` - get, patch, soft delete
- [x] `app/app/api/initiatives/[id]/numbers/route.ts` and `numbers/[numberId]/route.ts`
- [x] `app/app/api/initiatives/[id]/readings/route.ts`, `check-ins/route.ts`
- [x] `app/lib/api/registry/initiatives.ts`

## Files to Modify
- [x] `app/prisma/schema.prisma` - enums, models, `initiative_id` on Project and Task, back-relations (no RecurringWork yet)
- [x] `app/lib/api/formatters.ts` - `formatInitiativeResponse`; `initiative_id` on task and project responses
- [x] `app/lib/services/task-patch.ts`, `app/app/api/tasks/route.ts`, `app/app/api/projects/route.ts`, `app/app/api/projects/[id]/route.ts` - accept and validate `initiative_id`
- [x] `app/lib/api/registry/index.ts`, `tasks.ts`, `projects.ts`

## Implementation Steps
1. Schema and migration, `prisma generate`.
2. Health module, then service, then routes.
3. Link fields on task and project routes; formatters; registry.

## Tests to Update (from Impact Analysis)
- [x] None needed beyond the registry group list: `initiative_id` is optional and undefined on existing call shapes. Confirmed by the full suite.

## Tests to Write
- [x] `lib/initiatives/__tests__/health.test.ts` - each health rule
- [x] `app/api/initiatives/__tests__/route.test.ts` - fields, number limit, activation and cap, readings, check-ins, soft delete
- [x] `app/api/tasks/[id]/__tests__/initiative-link.test.ts`, `app/api/projects/[id]/__tests__/initiative-link.test.ts`

## Verification Checklist
- [x] `npx tsc --noEmit` exit 0
- [x] new tests pass (99 in the focused run), full suite shows only the known baseline failures
- [x] eslint clean on changed files
- [x] production build exit 0; migration applies on the scratch database and leaves no schema drift
