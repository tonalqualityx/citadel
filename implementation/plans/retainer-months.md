# Feature: Retainer months (design.md 2.6, screen 3.3)

## Overview
A monthly charter carries a monthly allotment (charter.budget_hours, else client.retainer_hours) of named work. Each month a RetainerMonth is drafted (items included), a planning task for Mike is made, and used time is shown against the allotment with work outside the plan listed.

## Files to Create
- [x] `app/prisma/migrations/20261128090000_retainer_months/migration.sql` - enum, two tables, FKs, indexes, unique (charter_id, month)
- [x] `app/lib/retainer-months/{format,helpers,service}.ts` - pure rules, prisma side, the cycle
- [x] `app/app/api/retainer-months/**`, `app/app/api/charters/[id]/retainer-months/route.ts` - read, confirm, item routes
- [x] `app/app/api/cron/retainer-months/route.ts` + `app/scripts/cron/retainer-months.sh` - daily cycle (own route; charter-tasks is not scheduled)
- [x] `app/lib/api/registry/retainer-months.ts`
- [x] `app/lib/hooks/use-retainer-months.ts`
- [x] `app/components/domain/retainer-months/{RetainerMonthPanel,RetainerMonthsBoard,CharterRetainerMonth}.tsx`

## Files to Modify
- [x] `app/prisma/schema.prisma` - models plus back-relations on User, Task, Charter, RecurringWork
- [x] `app/lib/api/registry/index.ts` and its test (new domain)
- [x] `app/types/entities.ts` - view types
- [x] `app/app/(app)/initiatives/page.tsx` - Initiatives | Retainer months tabs
- [x] `app/app/(app)/charters/[id]/page.tsx` - panel at the top of monthly charters

## Implementation Steps
1. Schema, migration, prisma generate
2. Pure helpers, then service (draft, confirm, items, usage, cycle)
3. Routes, registry, cron route and script
4. Hook, panel, board, page wiring

## Tests to Update (from Impact Analysis)
- [x] `lib/api/registry/__tests__/registry.test.ts` - expected group list gains `retainer-months`

## Tests to Write
- [x] helpers, service (draft, cycle on the 24th/25th/1st/backfill, confirm, closed refusal, usage attribution), every route, cron route, panel and board components

## Verification Checklist
- [x] TypeScript compiles; new and changed tests pass; eslint clean on changed files
