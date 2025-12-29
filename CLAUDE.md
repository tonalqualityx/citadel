# Indelible: Critical Implementation Details for Claude Code

This document clarifies two frequently-missed features. **Read this before implementing tasks or projects.**

---

## 1. Battery Impact Field (REQUIRED on Tasks)

### What It Is
`battery_impact` is a **cognitive/emotional load indicator**, separate from time estimation. It's a core neurodivergent-friendly feature that helps PMs balance workloads.

### Why It Exists
- Some tasks take 30 minutes but are mentally exhausting (client feedback calls)
- Some tasks take 4 hours but are energizing (creative design work)
- ADHD team members especially need this tracked to avoid burnout

### Database Schema

```prisma
enum BatteryImpact {
  average_drain  // Default - normal cognitive load
  high_drain     // Taxing - don't stack these for anyone
  energizing     // Actually gives energy - can offset draining work
}

model Task {
  // ... other fields ...
  
  // Energy estimation
  energy_estimate     Int?          // 1-8 scale (TIME estimate)
  mystery_factor      MysteryFactor @default(none)
  estimated_minutes   Int?          // Calculated from energy + mystery
  
  // THIS IS SEPARATE FROM TIME ESTIMATION:
  battery_impact      BatteryImpact @default(average_drain)  // ← DON'T FORGET THIS
  
  // ... other fields ...
}
```

### UI Requirements
- Task create/edit forms MUST include Battery Impact selector
- Display as badge/chip on task cards and list views
- Default to `average_drain` if not specified

### Visual Treatment
| Value | Display | Color |
|-------|---------|-------|
| `average_drain` | "Avg Drain" or ⚡ icon | Neutral gray |
| `high_drain` | "High Drain" or 🔋 icon with warning | Amber/warning |
| `energizing` | "Energizing" or ✨ icon | Green/positive |

---

## 2. Project Budget & Hour Estimates (COMPUTED, NOT ENTERED)

### The Core Principle
**Task estimates drive the project budget, not the other way around.**

Projects do NOT have simple "budget" and "hours" fields that someone types in. Instead:

1. Tasks are created with energy estimates
2. The system CALCULATES total hours from tasks
3. Only AFTER proposal acceptance does the budget get "locked"

### Database Schema

```prisma
model Project {
  // ... other fields ...
  
  // Billing type - set during project creation
  billing_type        BillingType?   // 'fixed' | 'hourly' | 'retainer' | 'none'
  
  // These are SET AFTER PROPOSAL ACCEPTANCE, not during creation:
  budget_hours        Decimal?       // Agreed hours (after quote accepted)
  hourly_rate         Decimal?       // Rate for this project
  budget_amount       Decimal?       // Total dollar amount
  budget_locked       Boolean        @default(false)
  budget_locked_at    DateTime?
  budget_locked_by_id String?        @db.Uuid
  
  // ... other fields ...
}

enum BillingType {
  fixed     // Fixed price project
  hourly    // Bill for actual hours
  retainer  // Uses client's retainer_hours
  none      // Internal/non-billable
}
```

### Computed Fields (API-level, not stored)

These are CALCULATED from tasks whenever requested:

```typescript
// In /lib/calculations/project.ts

export function calculateProjectEstimates(tasks: Task[]): ProjectEstimates {
  const incompleteTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'abandoned');
  
  // Sum of base energy estimates
  const estimatedEnergyMin = incompleteTasks.reduce(
    (sum, task) => sum + (task.energy_estimate || 0), 
    0
  );
  
  // Sum of weighted energy (with mystery factors applied)
  const estimatedEnergyMax = incompleteTasks.reduce(
    (sum, task) => sum + calculateWeightedEnergy(task.energy_estimate, task.mystery_factor),
    0
  );
  
  // Sum from time entries
  const timeSpent = tasks.reduce(
    (sum, task) => sum + task.time_entries.reduce((s, e) => s + e.duration, 0),
    0
  );
  
  return {
    estimatedEnergyMin,  // "Low estimate" in hours
    estimatedEnergyMax,  // "High estimate" in hours
    timeSpent,           // Actual hours logged
    estimatedRange: `${estimatedEnergyMin}-${estimatedEnergyMax} hrs`,
  };
}
```

### The Two-Phase Budget Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PROJECT CREATION PHASE                          │
└─────────────────────────────────────────────────────────────────────┘

  1. PM creates project
  2. Sets billing_type = 'fixed'
  3. budget_locked = false
  4. budget_hours, hourly_rate, budget_amount are ALL NULL

  ↓

┌─────────────────────────────────────────────────────────────────────┐
│                    TASK ESTIMATION PHASE                           │
└─────────────────────────────────────────────────────────────────────┘

  5. PM adds tasks with energy_estimate + mystery_factor
  6. System CALCULATES totals:
     - Task 1: energy=3, mystery=average → weighted=4.2
     - Task 2: energy=5, mystery=significant → weighted=8.75
     - Task 3: energy=2, mystery=none → weighted=2.0
     ─────────────────────────────────────
     Total: 10 base hours, 15 weighted hours
     Display: "10-15 hrs"
  
  7. PM uses this to quote client

  ↓

┌─────────────────────────────────────────────────────────────────────┐
│                    BUDGET LOCK PHASE                               │
└─────────────────────────────────────────────────────────────────────┘

  8. Client accepts proposal
  9. PM "locks" the budget:
     - budget_hours = 12 (negotiated)
     - hourly_rate = 150.00
     - budget_amount = 1800.00
     - budget_locked = true
     - budget_locked_at = now()
```

### API Response Structure

When returning a project, include calculated estimates:

```typescript
// GET /api/projects/:id response
{
  id: "...",
  name: "Acme Corp Redesign",
  status: "quote",
  billing_type: "fixed",
  
  // If budget not yet locked:
  budget_locked: false,
  budget_hours: null,
  budget_amount: null,
  
  // ALWAYS include calculated estimates:
  calculated: {
    estimated_hours_min: 35,     // Sum of task base energy
    estimated_hours_max: 52,     // Sum of weighted energy
    estimated_range: "35-52 hrs",
    time_spent: 0,               // Sum of time entries
    task_count: 12,
    completed_task_count: 0,
    progress_percent: 0,
  },
  
  tasks: [...],
}
```

### UI Implications

**Project Detail View:**
- Show "Estimated: 35-52 hrs" (calculated from tasks)
- Show "Budget: Not locked" or "Budget: $6,000 (40 hrs)" after locked
- Show "Time Spent: 12.5 hrs"
- Show progress bar against estimate range

**Project Create/Edit Form:**
- Ask for `billing_type` during creation
- Do NOT show budget fields until budget is being locked
- Budget lock is a separate action/modal, not part of basic editing

---

## Summary Checklist

### For Task Implementation:
- [ ] `battery_impact` enum exists in schema
- [ ] Default value is `average_drain`
- [ ] Field appears in create/edit forms
- [ ] Field displays in list views and cards

### For Project Implementation:
- [ ] No direct "estimated hours" input field
- [ ] Estimates are CALCULATED from sum of task energies
- [ ] `budget_locked` controls whether budget fields are editable
- [ ] API responses include `calculated` object with rolled-up values
- [ ] Progress calculations use task rollups

---

## 3. Component Library Usage (REQUIRED)

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
| `Badge` | Status indicators, labels (has `variant`: default, success, warning) |
| `Button` | Actions (has `variant`: primary, secondary, ghost, danger) |
| `Input`, `Select`, `Textarea` | Form fields |
| `Spinner` | Loading states |
| `EmptyState` | No-data placeholders |
| `DataTable` | Tabular data |

### Correct Pattern

```tsx
// GOOD - uses component library
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

<Card>
  <CardHeader>
    <Badge variant="warning">PM Only</Badge>
    <CardTitle>Quality Gate</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="border border-border rounded-lg">...</div>
  </CardContent>
</Card>
```

```tsx
// BAD - raw Tailwind that breaks themes
<div className="border-amber-200 bg-amber-50/50 rounded-lg shadow">
  <span className="text-amber-600">Warning</span>
</div>
```

### CSS Variables to Use

When you must use Tailwind classes, use these CSS variable-based classes:

| Instead of | Use |
|------------|-----|
| `bg-white`, `bg-gray-50` | `bg-surface`, `bg-surface-alt` |
| `text-gray-900`, `text-black` | `text-text-main` |
| `text-gray-500`, `text-gray-600` | `text-text-sub` |
| `border-gray-200` | `border-border` |
| `text-amber-600`, warning colors | `Badge variant="warning"` |
| `text-green-600`, success colors | `Badge variant="success"` |

### Before Adding New Styles

1. Check if a component exists in `/components/ui/`
2. Check if the component has a `variant` prop for what you need
3. If styling manually, use CSS variable-based classes from `globals.css`
4. Never use raw color values like `amber-200`, `green-500`, etc.

---

## Reference Documents

For full context, see:
- `indelible-app-architecture.md` - Complete entity schemas
- `indelible-schema-addendum.md` - Budget workflow details
- `notion-schema.md` - Original Notion properties (Battery Impact under Tasks)
- `indelible-data-model-refinement.md` - Computed field specifications
- `PHASE-03-PROJECTS-TASKS.md` - Implementation phase for these features