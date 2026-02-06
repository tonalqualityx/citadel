# Indelible Development Guidelines

This document contains development rules and patterns for the Indelible codebase. **Read this before implementing features.**

---

## 0. Agent-Based Development Workflow (REQUIRED)

### The Rule
**All feature implementation MUST follow the agent-based workflow: Plan → Implement → Test.**

### Workflow Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. PLAN PHASE - Main Agent                                        │
│     - Create implementation plan                                    │
│     - Save plan to /implementation/plans/FEATURE-NAME.md           │
│     - Get user approval before proceeding                          │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  2. IMPLEMENT PHASE - Sub-Agents                                   │
│     - Dispatch sub-agents for specific tasks:                      │
│       • API routes (read existing patterns, write new routes)      │
│       • React hooks (read existing hooks, write new hooks)         │
│       • Components (read existing components, write new ones)      │
│     - Each sub-agent reports back with results                     │
│     - Main agent orchestrates and tracks progress                  │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  3. TEST PHASE - Sub-Agents                                        │
│     - Run TypeScript compilation check                             │
│     - Write unit tests for new functionality                       │
│     - Run existing tests to prevent regressions                    │
│     - Fix any failures before marking complete                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Plan File Structure

Save implementation plans to `/implementation/plans/FEATURE-NAME.md`:

```markdown
# Feature: [Name]

## Overview
Brief description of what we're building.

## Files to Create
- [ ] `/app/api/...` - Description
- [ ] `/lib/hooks/...` - Description
- [ ] `/components/...` - Description

## Files to Modify
- [ ] `/app/(app)/...` - What changes

## Implementation Steps
1. Step one
2. Step two
3. ...

## Tests to Write
- [ ] Test case 1
- [ ] Test case 2

## Verification Checklist
- [ ] Feature works as expected
- [ ] TypeScript compiles without errors
- [ ] Unit tests pass
- [ ] No regressions in existing tests
```

### Sub-Agent Dispatch Pattern

When implementing, dispatch sub-agents for focused tasks:

```
// Example: Implementing a new CRUD feature

Sub-Agent 1: "Read existing API patterns"
  → Reads /app/api/tasks/route.ts, /app/api/comments/route.ts
  → Reports back with patterns to follow

Sub-Agent 2: "Create API routes for milestones"
  → Creates /app/api/projects/[id]/milestones/route.ts
  → Creates /app/api/milestones/[id]/route.ts
  → Reports back with created files

Sub-Agent 3: "Create React hooks"
  → Reads existing hooks pattern
  → Creates /lib/hooks/use-milestones.ts
  → Reports back

Sub-Agent 4: "Create UI components"
  → Creates component files
  → Reports back

Sub-Agent 5: "Run tests and type check"
  → Runs npx tsc --noEmit
  → Runs npm test
  → Reports any failures
```

### Testing Requirements

**Unit Tests Are Required** for:
- API route handlers (test request/response)
- Utility functions in `/lib/calculations/`
- React hooks (test with React Testing Library)

**Test Files Location**:
- Place tests next to source files: `component.tsx` → `component.test.tsx`
- Or in `__tests__` directories

**Run Tests Before Completion**:
```bash
# Type check
npx tsc --noEmit

# Run all tests
npm test

# Run specific test file
npm test -- path/to/file.test.ts
```

### Progress Tracking

Use the TodoWrite tool to track implementation progress:
- Create todos for each implementation step
- Mark as `in_progress` when starting
- Mark as `completed` when done
- Only one task should be `in_progress` at a time

---

## 1. Component Library Usage (REQUIRED)

### The Rule
**ALWAYS use components from `/components/ui/` - NEVER use raw Tailwind for styling that components already handle.**

### Why This Matters
- Rogue styling breaks when themes change
- Raw Tailwind colors (like `bg-amber-50`) don't respect dark/dim modes
- Components use CSS variables (`var(--warning)`, `var(--border)`) that adapt to themes
- Consistency across the app

### Available Components

Check `/components/ui/` before styling anything:

| Component | Use For |
|-----------|---------|
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | Content containers |
| `Badge` | Status indicators, labels (has `variant`: default, success, warning, error, info) |
| `Button` | Actions (has `variant`: primary, secondary, ghost, danger) |
| `Input`, `Select`, `Textarea` | Form fields |
| `Spinner` | Loading states |
| `EmptyState` | No-data placeholders |
| `DataTable` | Tabular data |
| `TaskList` | Task listings with configurable columns |
| `Tooltip` | Hover information |
| `Modal`, `ModalContent`, `ModalHeader`, `ModalBody` | Dialogs |

### CSS Variables to Use

When you must use Tailwind classes, use these CSS variable-based classes:

| Instead of | Use |
|------------|-----|
| `bg-white`, `bg-gray-50` | `bg-surface`, `bg-surface-alt`, `bg-surface-2` |
| `text-gray-900`, `text-black` | `text-text-main` |
| `text-gray-500`, `text-gray-600` | `text-text-sub` |
| `border-gray-200` | `border-border`, `border-border-warm` |
| `text-amber-600`, warning colors | `Badge variant="warning"` |
| `text-green-600`, success colors | `Badge variant="success"` |

### Before Adding New Styles

1. Check if a component exists in `/components/ui/`
2. Check if the component has a `variant` prop for what you need
3. If styling manually, use CSS variable-based classes from `globals.css`
4. Never use raw color values like `amber-200`, `green-500`, etc.

---

## 2. Task Time Estimates Display (REQUIRED)

### The Rule
**Task time estimates should ALWAYS show a RANGE estimate with a progress bar showing time committed.**

### Implementation
Use `rangedEstimateColumn()` from `/components/ui/task-list-columns.tsx` for any task list that displays time estimates.

```tsx
import { rangedEstimateColumn } from '@/components/ui/task-list-columns';

const columns = [
  titleColumn(),
  statusColumn(),
  rangedEstimateColumn(), // Shows "1h - 1.5h" with progress bar
  // ... other columns
];
```

### What It Shows
- **Range text**: Based on energy estimate + mystery factor (e.g., "1h - 1.5h")
- **Progress bar**: Time logged vs estimated max
- **Color coding**:
  - Red (`bg-red-500`): Over 100% of estimate
  - Amber (`bg-amber-500`): Over 80% of estimate
  - Primary (`bg-primary`): Under 80% of estimate

### Never Use
- `estimateColumn()` - deprecated, only shows single value
- Raw estimated_minutes display without range

---

## 3. Battery Impact Field (REQUIRED on Tasks)

### What It Is
`battery_impact` is a **cognitive/emotional load indicator**, separate from time estimation. It's a core neurodivergent-friendly feature that helps PMs balance workloads.

### Why It Exists
- Some tasks take 30 minutes but are mentally exhausting (client feedback calls)
- Some tasks take 4 hours but are energizing (creative design work)
- ADHD team members especially need this tracked to avoid burnout

### Values
| Value | Display | Meaning |
|-------|---------|---------|
| `average_drain` | Default | Normal cognitive load |
| `high_drain` | Warning badge | Taxing - don't stack these |
| `energizing` | Success badge | Actually gives energy |

### Requirements
- Task create/edit forms MUST include Battery Impact selector
- Display as badge/chip on task cards and list views
- Default to `average_drain` if not specified

---

## 4. Project Budget & Hour Estimates

### The Core Principle
**Task estimates drive the project budget, not the other way around.**

Projects do NOT have simple "budget" and "hours" fields that someone types in. Instead:

1. Tasks are created with energy estimates
2. The system CALCULATES total hours from tasks
3. Only AFTER proposal acceptance does the budget get "locked"

### Two-Phase Workflow

**Phase 1: Estimation**
- PM adds tasks with energy_estimate + mystery_factor
- System calculates totals automatically
- Display shows range: "35-52 hrs"

**Phase 2: Budget Lock**
- Client accepts proposal
- PM "locks" the budget with agreed hours/rate
- `budget_locked = true`

### API Response
Projects always include a `calculated` object:
```typescript
calculated: {
  estimated_hours_min: 35,
  estimated_hours_max: 52,
  estimated_range: "35-52 hrs",
  time_spent_minutes: 0,
  progress_percent: 0,
}
```

---

## 5. API Data Requirements

### Tasks Must Include Time Entries
When fetching tasks that will display estimates with progress bars, always include `time_entries`:

```typescript
prisma.task.findMany({
  include: {
    time_entries: {
      where: { is_deleted: false },
      select: { duration: true },
    },
    // ... other includes
  },
});
```

The `formatTaskResponse()` function will calculate `time_spent_minutes` from these entries.

### Dashboard Tasks
Dashboard task lists use `time_logged_minutes` field name (calculated at API level).

---

## 6. Task List Column Helpers

Use the column helpers from `/components/ui/task-list-columns.tsx`:

| Column | Purpose | Options |
|--------|---------|---------|
| `titleColumn()` | Task name | `{ editable, showProject }` |
| `statusColumn()` | Status badge/select | `{ editable }` |
| `priorityColumn()` | Priority badge/select | `{ editable }` |
| `assigneeColumn()` | User avatar + name | `{ editable }` |
| `rangedEstimateColumn()` | Time range + progress | None |
| `batteryColumn()` | Battery impact | `{ editable }` |
| `energyColumn()` | Energy estimate | `{ editable }` |
| `mysteryColumn()` | Mystery factor | `{ editable }` |
| `dueDateColumn()` | Due date | `{ editable }` |
| `focusColumn()` | Focus checkbox | `{ onToggleFocus }` |
| `approveColumn()` | Approve button | `{ onApprove }` |

---

## 7. Toast Notifications

Use `showToast` from `/lib/hooks/use-toast.ts` for user feedback:

```typescript
import { showToast } from '@/lib/hooks/use-toast';

// Success messages
showToast.created('Task');     // "Task created"
showToast.updated('Project');  // "Project updated"
showToast.deleted('Comment');  // "Comment deleted"
showToast.success('Custom message');

// Error messages
showToast.error('Something went wrong');
showToast.apiError(error, 'Failed to save');
```

---

## 8. Terminology System

Use the terminology hook for user-facing labels:

```typescript
import { useTerminology } from '@/lib/hooks/use-terminology';

const { t } = useTerminology();

// Returns configured terms (e.g., "Quest" instead of "Task")
t('task')     // "Quest"
t('tasks')    // "Quests"
t('project')  // "Campaign"
```

---

## 9. Error Handling

### API Routes
Use `handleApiError` and `ApiError` from `/lib/api/errors`:

```typescript
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    // ... logic
    if (!found) {
      throw new ApiError('Not found', 404);
    }
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
```

### Frontend
React Query mutations should use `onError` callbacks with toast notifications.

---

## 10. Activity Logging

Log significant actions using `/lib/services/activity.ts`:

```typescript
import { logCreate, logUpdate, logDelete, logStatusChange } from '@/lib/services/activity';

// After creating
await logCreate(userId, 'task', taskId, taskTitle);

// After status change
await logStatusChange(userId, 'task', taskId, oldStatus, newStatus);
```

---

## 11. API Route Registry (REQUIRED)

### The Rule
**When adding, modifying, or removing any API endpoint, you MUST update the route registry at `/lib/api/registry.ts`.**

### Why This Matters
The API is consumed by external LLM agents (e.g., Openclaw) that discover available endpoints by calling `GET /api/docs`. If the registry is stale, external tools will fail or miss capabilities.

### What to Update
- Adding a new route: Add its entry to the registry with path, methods, params, and description
- Changing query params or body schema: Update the corresponding registry entry
- Removing a route: Remove its registry entry
- Changing auth requirements: Update the `auth` and `roles` fields

---

## Quick Reference: File Locations

| Purpose | Location |
|---------|----------|
| UI Components | `/components/ui/` |
| Domain Components | `/components/domain/` |
| API Routes | `/app/api/` |
| React Query Hooks | `/lib/hooks/` |
| Calculations | `/lib/calculations/` |
| API Helpers | `/lib/api/` |
| Services | `/lib/services/` |
| API Route Registry | `/lib/api/registry.ts` |
| Database | `/prisma/schema.prisma` |
