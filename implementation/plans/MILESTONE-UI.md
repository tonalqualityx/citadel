# Feature: Milestone UI ✅ COMPLETE

## Overview
Add full CRUD functionality for project milestones. Milestones are key dates/deliverables within a project that help track progress toward completion.

## Status: COMPLETE
All implementation steps completed. TypeScript compiles, 10 unit tests passing.

## Existing Assets
- **Schema**: `Milestone` model already exists in `prisma/schema.prisma`
- **Formatter**: `formatMilestoneResponse()` already exists in `/lib/api/formatters.ts`
- **Relation**: Projects already have `milestones` relation defined

## Files to Create

### API Routes
- [ ] `/app/api/projects/[id]/milestones/route.ts` - GET (list), POST (create)
- [ ] `/app/api/milestones/[id]/route.ts` - GET (single), PATCH (update), DELETE

### React Hooks
- [ ] `/lib/hooks/use-milestones.ts` - React Query hooks for CRUD operations

### Components
- [ ] `/components/domain/projects/milestone-list.tsx` - List of milestones with inline actions
- [ ] `/components/domain/projects/milestone-form.tsx` - Create/edit form (modal or inline)

### Tests
- [ ] `/lib/hooks/__tests__/use-milestones.test.ts` - Hook tests
- [ ] `/app/api/projects/[id]/milestones/__tests__/route.test.ts` - API route tests

## Files to Modify
- [ ] `/app/(app)/projects/[id]/page.tsx` - Add Milestones section/tab to project detail

## Implementation Steps

### Phase 1: API Layer
1. Create `/app/api/projects/[id]/milestones/route.ts`
   - GET: List milestones for project, ordered by target_date then sort_order
   - POST: Create milestone with validation (name required, project must exist)

2. Create `/app/api/milestones/[id]/route.ts`
   - GET: Single milestone by ID
   - PATCH: Update milestone (name, target_date, notes, completed_at, sort_order)
   - DELETE: Remove milestone

### Phase 2: React Hooks
3. Create `/lib/hooks/use-milestones.ts`
   - `useMilestones(projectId)` - List milestones for a project
   - `useMilestone(id)` - Single milestone
   - `useCreateMilestone()` - Create mutation
   - `useUpdateMilestone()` - Update mutation
   - `useDeleteMilestone()` - Delete mutation
   - `useToggleMilestoneComplete()` - Quick toggle for completion

### Phase 3: UI Components
4. Create `/components/domain/projects/milestone-list.tsx`
   - Display milestones grouped: Upcoming, Completed
   - Show: name, target date, completion status
   - Actions: Mark complete, Edit, Delete
   - Empty state when no milestones

5. Create `/components/domain/projects/milestone-form.tsx`
   - Fields: name (required), target_date (optional), notes (optional)
   - Used in modal for create/edit

### Phase 4: Integration
6. Add Milestones section to project detail page
   - Add as a card/section on the Overview tab (not a separate tab)
   - Include "Add Milestone" button
   - Show milestone list

### Phase 5: Testing
7. Write unit tests for hooks
8. Write API route tests
9. Run full test suite to check for regressions

## API Specifications

### GET /api/projects/[id]/milestones
Response:
```json
{
  "milestones": [
    {
      "id": "uuid",
      "name": "Design Approval",
      "project_id": "uuid",
      "target_date": "2025-01-15T00:00:00Z",
      "completed_at": null,
      "notes": "Client review of mockups",
      "sort_order": 0,
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

### POST /api/projects/[id]/milestones
Request:
```json
{
  "name": "Design Approval",
  "target_date": "2025-01-15",
  "notes": "Optional notes"
}
```

### PATCH /api/milestones/[id]
Request (partial update):
```json
{
  "name": "Updated name",
  "completed_at": "2025-01-10T00:00:00Z"
}
```

## UI Specifications

### Milestone List Item
```
┌─────────────────────────────────────────────────────────────┐
│ ○ Design Approval                           Jan 15, 2025   │
│   Client review of mockups                    [Edit] [Delete]│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ● Launch Website                     ✓ Completed Jan 10    │
│   Go live with new site                       [Edit] [Delete]│
└─────────────────────────────────────────────────────────────┘
```

### Empty State
"No milestones yet. Add milestones to track key deliverables."

## Verification Checklist
- [ ] Can create milestone with name and optional target date
- [ ] Can mark milestone as complete (sets completed_at)
- [ ] Can unmark milestone (clears completed_at)
- [ ] Can edit milestone name, date, notes
- [ ] Can delete milestone
- [ ] Milestones display in chronological order (by target_date)
- [ ] Completed milestones show completion date
- [ ] TypeScript compiles without errors
- [ ] Unit tests pass
- [ ] No regressions in existing tests
