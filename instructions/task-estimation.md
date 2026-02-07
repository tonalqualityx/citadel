# Task Estimation, Battery Impact & Budget Guide

Detailed reference for the energy estimation system, battery impact, and project budget workflow.

---

## Task Time Estimates Display (REQUIRED)

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

## Battery Impact Field (REQUIRED on Tasks)

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

## Project Budget & Hour Estimates

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

## API Data Requirements

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
