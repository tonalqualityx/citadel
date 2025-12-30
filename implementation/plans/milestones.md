# Milestones Feature Documentation

## Overview

Milestones are key dates/deliverables within a project that help track progress toward completion. They provide visual checkpoints for project managers to monitor whether a project is on schedule.

## Current Implementation Status

**Status:** Complete
**Implemented:** December 2025

## Data Model

Milestones are currently tied to **Projects only** (not phases).

```prisma
model Milestone {
  id           String    @id @default(uuid()) @db.Uuid
  name         String    @db.VarChar(255)
  project_id   String    @db.Uuid
  target_date  DateTime? @db.Timestamptz
  completed_at DateTime? @db.Timestamptz
  notes        String?   @db.Text
  sort_order   Int       @default(0)
  created_at   DateTime  @default(now()) @db.Timestamptz
  updated_at   DateTime  @updatedAt @db.Timestamptz

  project Project @relation(fields: [project_id], references: [id], onDelete: Cascade)
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Auto | Primary key |
| `name` | String | Yes | Milestone name (max 255 chars) |
| `project_id` | UUID | Yes | Foreign key to Project |
| `target_date` | DateTime | No | Target completion date |
| `completed_at` | DateTime | No | When milestone was marked complete |
| `notes` | Text | No | Additional details |
| `sort_order` | Int | No | Manual ordering (default: 0) |

## API Endpoints

### List Milestones for Project
```
GET /api/projects/[id]/milestones
```
Returns all milestones for a project, ordered by `target_date` then `sort_order`.

**Response:**
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

### Create Milestone
```
POST /api/projects/[id]/milestones
```
**Request:**
```json
{
  "name": "Design Approval",
  "target_date": "2025-01-15",
  "notes": "Optional notes"
}
```

### Get Single Milestone
```
GET /api/milestones/[id]
```

### Update Milestone
```
PATCH /api/milestones/[id]
```
**Request (partial update):**
```json
{
  "name": "Updated name",
  "completed_at": "2025-01-10T00:00:00Z"
}
```

### Delete Milestone
```
DELETE /api/milestones/[id]
```

## Files Created

### API Routes
- `/app/api/projects/[id]/milestones/route.ts` - GET (list), POST (create)
- `/app/api/milestones/[id]/route.ts` - GET, PATCH, DELETE

### React Hooks
- `/lib/hooks/use-milestones.ts`
  - `useMilestones(projectId)` - List milestones for a project
  - `useMilestone(id)` - Single milestone
  - `useCreateMilestone()` - Create mutation
  - `useUpdateMilestone()` - Update mutation
  - `useDeleteMilestone()` - Delete mutation
  - `useToggleMilestoneComplete()` - Quick toggle for completion

### Components
- `/components/domain/projects/milestone-list.tsx` - List with grouping and actions
- `/components/domain/projects/milestone-form.tsx` - Create/edit form modal

### Tests
- `/lib/hooks/__tests__/use-milestones.test.ts` - 10 unit tests (all passing)

## UI Location

Milestones appear on the **Project Detail Page** in the **Details tab**.

Path: `/projects/[id]` → Details tab → Milestones section

## Features

### Create Milestone
- Name field (required)
- Target date (optional date picker)
- Notes (optional textarea)

### Mark Complete/Incomplete
- Click checkbox to toggle completion status
- Sets `completed_at` timestamp when completed
- Clears `completed_at` when uncompleted

### Edit Milestone
- Opens modal with pre-filled form
- Can modify name, target date, notes

### Delete Milestone
- Confirmation dialog before deletion
- Hard delete (no soft delete)

### Display Features
- **Grouped by status:** Upcoming milestones shown first, Completed below
- **Chronological ordering:** Sorted by target date within each group
- **Past due indicator:** Red text for milestones past target date
- **Empty state:** "No milestones yet" message with add button

## Visual Design

### Upcoming Milestone
```
┌─────────────────────────────────────────────────────────────┐
│ ○ Design Approval                           Jan 15, 2025   │
│   Client review of mockups                    [Edit] [Delete]│
└─────────────────────────────────────────────────────────────┘
```

### Completed Milestone
```
┌─────────────────────────────────────────────────────────────┐
│ ● Launch Website                     ✓ Completed Jan 10    │
│   Go live with new site                       [Edit] [Delete]│
└─────────────────────────────────────────────────────────────┘
```

## Future Enhancements

### Phase Association
Currently milestones are only linked to projects. A future enhancement could add `phase_id` to allow milestones to be associated with specific project phases:

```prisma
model Milestone {
  // ... existing fields ...
  phase_id String? @db.Uuid
  phase    Phase?  @relation(fields: [phase_id], references: [id])
}
```

This would enable:
- Filtering milestones by phase
- Phase-specific progress tracking
- More granular project timeline management

## Query Key Structure

```typescript
export const milestoneKeys = {
  all: ['milestones'] as const,
  project: (projectId: string) => [...milestoneKeys.all, projectId] as const,
  detail: (id: string) => ['milestone', id] as const,
};
```

## Access Control

- **Admin/PM:** Full CRUD access to all milestones
- **Tech:** Can view/create/update milestones for projects they are team members of
- All authenticated users can view milestones on projects they have access to
