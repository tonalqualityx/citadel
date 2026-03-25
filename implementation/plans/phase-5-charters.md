# Phase 5: Charters (Retainers)

## Overview
Build Charter management — recurring service agreements with budget tracking, task generation, and commission linking. Charters represent ongoing client retainers with scheduled tasks that auto-generate on cadence.

## Schema (Already Exists)
- `Charter` — main entity with status, billing_period, budget_hours/rate/amount
- `CharterWare` — links Charter to Wares (products/services)
- `CharterScheduledTask` — recurring task definitions with cadence + SOP reference
- `CharterGenerationLog` — deduplication log for task generation
- `CharterCommission` — links Charter to Projects with allocated hours

## Files to Create

### Services
- `/app/lib/services/charter-generator.ts` — Recurring task generation (mirrors maintenance-generator.ts)

### API Routes
- `/app/app/api/charters/route.ts` — GET list, POST create
- `/app/app/api/charters/[id]/route.ts` — GET detail, PATCH update, DELETE soft-delete
- `/app/app/api/charters/[id]/status/route.ts` — PATCH status transitions
- `/app/app/api/charters/[id]/wares/route.ts` — POST add ware
- `/app/app/api/charters/[id]/wares/[wareId]/route.ts` — PATCH update, DELETE remove ware
- `/app/app/api/charters/[id]/scheduled-tasks/route.ts` — POST add scheduled task
- `/app/app/api/charters/[id]/scheduled-tasks/[taskId]/route.ts` — PATCH update, DELETE remove
- `/app/app/api/charters/[id]/commissions/route.ts` — POST link commission
- `/app/app/api/charters/[id]/commissions/[linkId]/route.ts` — PATCH update, DELETE unlink
- `/app/app/api/charters/[id]/usage/route.ts` — GET period usage breakdown
- `/app/app/api/cron/charter-tasks/route.ts` — Cron endpoint for task generation

### Registry & Hooks
- `/app/lib/api/registry/charters.ts` — Charter endpoint definitions
- `/app/lib/hooks/use-charters.ts` — React Query hooks

### UI Components
- `/app/components/domain/charters/CharterList.tsx`
- `/app/components/domain/charters/CharterDetail.tsx`
- `/app/components/domain/charters/CharterForm.tsx`
- `/app/components/domain/charters/UsageTracker.tsx`

### Pages
- `/app/app/(app)/charters/page.tsx` — Charters list
- `/app/app/(app)/charters/[id]/page.tsx` — Charter detail with tabs

### Tests
- `/app/app/api/charters/__tests__/route.test.ts`
- `/app/app/api/charters/[id]/__tests__/route.test.ts`
- `/app/lib/services/__tests__/charter-generator.test.ts`

## Files to Modify
- `/app/types/entities.ts` — Add Charter types
- `/app/lib/api/formatters.ts` — Add formatCharterResponse, formatCharterWareResponse, etc.
- `/app/lib/api/query-keys.ts` — Add charterKeys
- `/app/lib/api/registry/index.ts` — Import charter registry
- `/app/components/layout/Sidebar.tsx` — Add Charters nav item to parley section
- `/app/app/(app)/clients/[id]/page.tsx` — Add Charters tab

## Tests to Update (from Impact Analysis)
- `/app/lib/api/registry/__tests__/registry.test.ts` — Add 'charter' to expectedGroups array

## Implementation Steps
1. Add Charter types to entities.ts
2. Add formatters
3. Add query keys
4. Create charter-generator.ts service
5. Create all API routes
6. Create cron endpoint
7. Create registry + update index
8. Create hooks
9. Create UI components
10. Create pages
11. Update Sidebar + client detail
12. Update registry test
13. Write new tests
14. Run tsc + test suite

## Verification Checklist
- [ ] Charter CRUD works
- [ ] Status transitions (active → paused → active, active → cancelled)
- [ ] Recurring task generation via cron
- [ ] Budget tracking with period usage
- [ ] Commission ↔ Charter linking
- [ ] TypeScript compiles without errors
- [ ] All tests pass
