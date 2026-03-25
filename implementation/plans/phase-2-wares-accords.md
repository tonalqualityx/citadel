# Feature: Phase 2 — Wares & Accords CRUD

## Overview
Full CRUD for Wares (product catalog) and Accords (deals/pipeline). Kanban board for Accords. Navigation update with Parley section.

## Files to Create
- [ ] `/app/api/wares/route.ts` — GET (list), POST (create)
- [ ] `/app/api/wares/[id]/route.ts` — GET (detail), PATCH (update), DELETE (soft delete)
- [ ] `/app/api/accords/route.ts` — GET (list), POST (create)
- [ ] `/app/api/accords/[id]/route.ts` — GET (detail), PATCH (update), DELETE (soft delete)
- [ ] `/app/api/accords/[id]/status/route.ts` — PATCH (status transition)
- [ ] `/app/api/accords/[id]/line-items/route.ts` — POST (add line item)
- [ ] `/app/api/accords/[id]/line-items/[lineItemId]/route.ts` — PATCH, DELETE
- [ ] `/app/api/accords/[id]/meeting-attendees/route.ts` — POST (add attendee)
- [ ] `/app/api/accords/[id]/meeting-attendees/[attendeeId]/route.ts` — DELETE
- [ ] `/lib/hooks/use-wares.ts` — React Query hooks for Wares
- [ ] `/lib/hooks/use-accords.ts` — React Query hooks for Accords
- [ ] `/lib/api/registry/wares.ts` — Wares API registry
- [ ] `/lib/api/registry/accords.ts` — Accords API registry
- [ ] `/app/(app)/deals/page.tsx` — Accords kanban page
- [ ] `/app/(app)/deals/[id]/page.tsx` — Accord detail page
- [ ] `/app/(app)/deals/wares/page.tsx` — Wares list page
- [ ] `/components/domain/accords/AccordKanbanBoard.tsx` — Kanban board
- [ ] `/components/domain/accords/AccordCard.tsx` — Kanban card
- [ ] `/components/domain/accords/AccordForm.tsx` — Create/edit accord
- [ ] `/components/domain/wares/WareForm.tsx` — Create/edit ware

## Files to Modify
- [ ] `/lib/api/formatters.ts` — Add formatWareResponse, formatAccordResponse, formatAccordLineItemResponse
- [ ] `/lib/api/query-keys.ts` — Add wareKeys, accordKeys
- [ ] `/types/entities.ts` — Add Ware, Accord, AccordLineItem types
- [ ] `/lib/api/registry/index.ts` — Import and register new endpoint files
- [ ] `/components/layout/Sidebar.tsx` — Add Parley section
- [ ] `/components/layout/MobileNav.tsx` — Add Parley section

## Implementation Steps
1. Add types, formatters, query keys (foundation)
2. Create Wares API routes + registry + hooks
3. Create Accords API routes + registry + hooks
4. Update sidebar navigation
5. Create Wares UI (list page + form modal)
6. Create Accords UI (kanban + detail)
7. Write tests
8. Run verification

## Tests to Write
- [ ] `app/api/wares/__tests__/route.test.ts` — CRUD tests
- [ ] `app/api/accords/__tests__/route.test.ts` — CRUD + status transition tests

## Verification Checklist
- [ ] Wares CRUD fully functional
- [ ] Accords CRUD fully functional with status transitions
- [ ] Line items and meeting attendees manageable
- [ ] Kanban board renders with drag-and-drop
- [ ] Navigation updated
- [ ] TypeScript compiles without errors
- [ ] All tests pass
