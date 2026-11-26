# Feature: Recurring work record

## Overview
Design 2.5 (initiatives design, `/home/mike/Documents/projects/citadel-initiatives/design.md`): the charter scheduled task is
widened in place into one recurring work record (`RecurringWork`, same table `charter_scheduled_tasks`). It carries its
schedule, owner, what each run produces and an optional initiative. Charter rows keep behaving as before. Out of scope: the
machine-job import and `POST /api/recurring-work/machine-sync`, the engine rows import, and screens.

## Files to Create
- [x] `app/prisma/migrations/20261127100000_recurring_work/migration.sql` - additive migration (new unique index before the old one is dropped)
- [x] `app/lib/recurring-work/service.ts` - schemas, per-kind required fields, 404 checks
- [x] `app/app/api/recurring-work/route.ts` and `[id]/route.ts` - list, create, get, patch (deactivate with `is_active: false`)
- [x] `app/lib/api/registry/recurring-work.ts` - registry entries

## Files to Modify
- [x] `app/prisma/schema.prisma` - rename model, nullable `charter_id`/`sop_id`/`cadence`, `RecurringKind`, new columns, `Task.recurring_work_id`, log unique key `(scheduled_task_id, period)`
- [x] `app/lib/services/charter-generator.ts` - shared per-row generator, standalone path, one cron entry covers both
- [x] `app/app/api/cron/charter-tasks/route.ts` - reports standalone count
- [x] `app/app/api/charters/[id]/scheduled-tasks/**` - `prisma.recurringWork` with kind citadel_task; a charter row stores no client or site of its own, they are read from the charter (so a charter that changes client moves its rows; nothing kept in two places)
- [x] `app/lib/api/formatters.ts` - `formatRecurringWorkResponse`; charter formatter delegates
- [x] `app/types/entities.ts` - `RecurringWorkItem`; `CharterScheduledTaskItem` is an alias
- [x] `app/lib/initiatives/attach.ts` and the initiatives registry - `recurring_work_id` as the third option
- [x] charter screens - null-safe `cadence`

## Implementation Steps
1. Schema and hand-written migration; scratch-DB `migrate deploy` and `migrate diff` clean.
2. Generator: charter rows as today plus `recurring_work_id`; rows with no charter run for `citadel_task` only, on the row's client or the Client named "Indelible" (case-insensitive; skipped with a warning if absent), `is_retainer_work: false`, no charter.
3. Abandon lookup: `recurring_work_id = row.id`, or (charter rows) `recurring_work_id IS NULL AND charter_id + sop_id`.
4. Routes, formatter, registry, attach.

## Tests to Update (from Impact Analysis)
- [x] `lib/services/__tests__/charter-generator.test.ts` - key is `scheduled_task_id_period`
- [x] `lib/services/__tests__/generators-triage.test.ts` - mocked row carries `kind`
- [x] `lib/api/registry/__tests__/registry.test.ts` - new group `recurring-work`

## Tests to Write
- [x] `lib/services/__tests__/recurring-generator.test.ts` - standalone path, Indelible fallback, skips machine/engine, dedup, abandon lookup
- [x] `app/api/recurring-work/__tests__/route.test.ts` - validation per kind, 404s, charter fallback, filters, PATCH
- [x] `app/api/charters/[id]/scheduled-tasks/__tests__/route.test.ts`
- [x] `lib/initiatives/__tests__/attach.test.ts`

## Verification Checklist
- [x] `prisma generate`, `tsc --noEmit`, changed tests, full suite, eslint on changed files
- [x] Migration applies and matches the schema on a scratch database
