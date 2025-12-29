# Recipe Feature Refinement
## Implementation Guide for Claude Code

**Purpose:** This document specifies refinements to the Recipe/Wizard system to make SOPs the source of truth for task attributes.

---

## Context

The Recipe system generates projects from templates. Currently, `RecipeTask` duplicates fields that should come from the linked SOP. This refinement makes the SOP the single source of truth.

**Key Principle:** If a task is repeatable enough to be in a recipe, it should have an SOP. The SOP owns the "what" and "who" - the RecipeTask only handles "where in this recipe" and "how many times."

---

## Schema Changes Required

### 1. RecipeTask Model - Slim Down

**Current documented schema (PHASE-06-RECIPE-WIZARD.md):**
```prisma
model RecipeTask {
  id                  String        @id @default(uuid()) @db.Uuid
  phase_id            String        @db.Uuid
  phase               RecipePhase   @relation(...)
  
  // REMOVE THESE - they come from SOP now
  title               String        @db.VarChar(500)      // REMOVE
  description         String?       @db.Text              // REMOVE
  default_priority    Int           @default(3)           // REMOVE
  default_function_id String?       @db.Uuid              // REMOVE
  energy_estimate     Int?                                // REMOVE
  mystery_factor      MysteryFactor @default(none)        // REMOVE
  template_requirements Json?                             // REMOVE
  
  // KEEP THESE
  is_variable         Boolean       @default(false)
  variable_source     String?       @db.VarChar(50)
  sop_id              String?       @db.Uuid              // CHANGE: Make required
  sort_order          Int           @default(0)
  depends_on_ids      String[]      @db.Uuid
}
```

**New schema:**
```prisma
model RecipeTask {
  id              String        @id @default(uuid()) @db.Uuid
  phase_id        String        @db.Uuid
  phase           RecipePhase   @relation(fields: [phase_id], references: [id], onDelete: Cascade)
  
  // SOP is now REQUIRED - source of truth for task attributes
  sop_id          String        @db.Uuid  // Required, not optional
  sop             Sop           @relation(fields: [sop_id], references: [id])
  
  // Title override - if null, use SOP name during generation
  // Useful when same SOP is used multiple times (e.g., "Page Build - Homepage")
  title           String?       @db.VarChar(500)
  
  // Variable task settings (for sitemap expansion)
  is_variable     Boolean       @default(false)
  variable_source String?       @db.VarChar(50) // 'sitemap_page' | null
  
  // Ordering and dependencies
  sort_order      Int           @default(0)
  depends_on_ids  String[]      @db.Uuid // References other RecipeTask IDs
  
  @@index([phase_id])
  @@index([sop_id])
  @@map("recipe_tasks")
}
```

### 2. Recipe Model - Verify requires_sitemap Exists

**Per indelible-data-model-refinement.md, this field already exists:**
```sql
requires_sitemap    BOOLEAN NOT NULL DEFAULT false, -- Needs page configuration?
```

Verify the Prisma schema includes:
```prisma
model Recipe {
  // ... existing fields ...
  requires_sitemap  Boolean @default(false)
}
```

### 3. SOP Model - Verify Required Fields Exist

**Per indelible-app-architecture.md, the SOP model has these fields (verify they exist in Prisma):**

| Field | Type | Description |
|-------|------|-------------|
| name | String | SOP/Template name (used as task title base) |
| description | Text | Brief description |
| phase | String | Default phase for tasks |
| function_id | UUID | Default function for tasks |
| energy_impact | Decimal | Default energy estimate |
| mystery_factor | Enum | Default mystery factor |
| battery_impact | Enum | Default battery impact |
| priority | Enum | Default priority |
| no_review | Boolean | Default: tasks skip review |
| checklist | JSON | Template requirements (copied to task) |

---

## Recipe Task Form (Add/Edit)

### Form Flow

The SOP selector is the primary field - everything else derives from or overrides SOP defaults.

**Fields in order:**

1. **SOP Selector** (required)
   - Searchable dropdown of active SOPs
   - On selection: auto-populate title field with SOP name
   - Show SOP preview below: function, energy, mystery factor (read-only info)

2. **Title** (optional override)
   - Pre-filled with SOP name on SOP selection
   - User can edit to differentiate (e.g., "Page Build - Homepage")
   - If cleared/empty, falls back to SOP name during task generation
   - Supports `{page}` placeholder for variable tasks

3. **Variable Task Toggle**
   - "Variable task (one per page)"
   - When enabled, one task is created per sitemap page
   - Title's `{page}` placeholder replaced with page name

4. **Actions:** Cancel | Add Task

**SOP Preview Display (read-only, shown after SOP selection):**
```
┌─────────────────────────────────────────────────┐
│ Function: Designer     Energy: 4    Mystery: Average │
│ Battery: High Drain    Priority: Medium              │
└─────────────────────────────────────────────────┘
```

This preview helps users understand what defaults come with the SOP without needing to navigate away.

---

## Drag-and-Drop Requirements

### Phase Reordering

- Phases can be dragged to reorder within the recipe
- Updates `sort_order` for affected phases
- API: `PATCH /api/recipes/:id/phases` with `{ phase_ids: [ordered UUIDs] }`

### Task Reordering (within phase)

- Tasks can be dragged to reorder within their current phase
- Updates `sort_order` for affected tasks
- API: `PATCH /api/recipes/:id/phases/:phaseId/tasks` with `{ task_ids: [ordered UUIDs] }`

### Task Movement (between phases)

- Tasks can be dragged from one phase to another
- Updates both `phase_id` and `sort_order`
- API: `PATCH /api/recipes/:id/tasks/:taskId/move` with `{ target_phase_id, sort_order }`

### Implementation Notes

**Install drag-and-drop library:**
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Recommended approach:** `@dnd-kit/core` with `@dnd-kit/sortable`
- Supports both reordering and cross-container dragging
- Accessible (keyboard navigation)
- Works well with React

**UI Indicators:**
- Drag handle on left of each phase/task row
- Drop zone highlighting when dragging
- Smooth animation on reorder

**Optimistic Updates:**
- Update UI immediately on drop
- Revert if API call fails
- Show toast on error

---

## Wizard Flow Changes

### Step 3 (Sitemap) - Conditional Display

**Logic:**
```typescript
// In wizard state/navigation
const showSitemapStep = selectedRecipe?.requires_sitemap === true;

// Step numbers become dynamic
const steps = [
  { id: 1, name: 'Recipe', component: WizardStep1Recipe },
  { id: 2, name: 'Client', component: WizardStep2Client },
  ...(showSitemapStep ? [{ id: 3, name: 'Sitemap', component: WizardStep3Sitemap }] : []),
  { id: showSitemapStep ? 4 : 3, name: 'Team', component: WizardStep4Team },
  { id: showSitemapStep ? 5 : 4, name: 'Review', component: WizardStep5Review },
  { id: showSitemapStep ? 6 : 5, name: 'Generate', component: WizardStep6Generate },
];
```

### Step 6 (Generate) - Add Estimate Display

**After project generation, display:**

1. **Phase-by-phase estimates:**
   - Phase name
   - Energy range (low / average / high)
   - Value range (using client.hourly_rate or $150/hr fallback)

2. **Project totals:**
   - Total energy range
   - Total value range
   - Flag if using fallback rate: "⚠️ Client hourly rate not set, using $150/hr default"

**UI Structure:**
```tsx
interface EstimateDisplayProps {
  phases: Array<{
    name: string;
    energyLow: number;
    energyAverage: number;
    energyHigh: number;
  }>;
  totals: {
    energyLow: number;
    energyAverage: number;
    energyHigh: number;
  };
  hourlyRate: number;
  isDefaultRate: boolean;
}
```

---

## Task Generation Changes

### Current Logic (PHASE-06-RECIPE-WIZARD.md):
```typescript
// Creates task from RecipeTask attributes
const task = await tx.task.create({
  data: {
    title: recipeTask.title.replace('{page}', page.name),
    description: recipeTask.description,
    priority: recipeTask.default_priority,
    function_id: recipeTask.default_function_id,
    energy_estimate: recipeTask.energy_estimate,
    mystery_factor: recipeTask.mystery_factor,
    requirements: recipeTask.template_requirements,
    // ...
  },
});
```

### New Logic - Pull from SOP:
```typescript
// Fetch SOP for this recipe task
const sop = await tx.sop.findUnique({
  where: { id: recipeTask.sop_id },
});

if (!sop) {
  throw new Error(`SOP not found for recipe task ${recipeTask.id}`);
}

// Determine task title: use override if set, otherwise SOP name
const baseTitle = recipeTask.title ?? sop.name;

// For variable tasks, replace {page} placeholder
const taskTitle = recipeTask.is_variable && page
  ? baseTitle.replace('{page}', page.name)
  : baseTitle;

const taskDescription = recipeTask.is_variable && page && sop.description
  ? sop.description.replace('{page}', page.name)
  : sop.description;

const task = await tx.task.create({
  data: {
    project_id: project.id,
    
    // TITLE: from RecipeTask override or SOP name
    title: taskTitle,
    
    // FROM SOP (source of truth for everything else)
    description: taskDescription,
    priority: sop.priority ?? 'medium',
    function_id: sop.function_id,
    energy_estimate: sop.energy_impact,
    mystery_factor: sop.mystery_factor ?? 'none',
    battery_impact: sop.battery_impact ?? 'average',
    no_review: sop.no_review ?? false,
    requirements: sop.checklist, // Copy checklist to task requirements
    
    // FROM RECIPE TASK (context)
    phase: phase.name,
    sop_id: sop.id, // Reference back to source
    
    // FROM WIZARD (assignment)
    assignee_id: assignment?.user_id,
    
    // METADATA
    created_by_id: auth.userId,
  },
});
```

---

## Energy Calculation Reference

**Per PHASE-03-PROJECTS-TASKS.md, the utility exists at `/lib/calculations/energy.ts`:**

```typescript
const MYSTERY_MULTIPLIERS: Record<MysteryFactor, number> = {
  none: 1.0,
  average: 1.4,
  significant: 1.75,
  no_idea: 2.5,
};

export function calculateWeightedEnergy(
  baseEnergy: number,
  mysteryFactor: MysteryFactor
): number {
  const multiplier = getMysteryMultiplier(mysteryFactor);
  return baseEnergy * multiplier;
}
```

**For project/phase estimates, aggregate tasks:**
```typescript
interface EnergyRange {
  low: number;    // Sum of base energy (mystery = none)
  average: number; // Sum of weighted energy
  high: number;   // Sum of energy * max mystery multiplier (2.5)
}

function calculatePhaseEstimate(tasks: Task[]): EnergyRange {
  return tasks.reduce((acc, task) => ({
    low: acc.low + (task.energy_estimate ?? 0),
    average: acc.average + calculateWeightedEnergy(
      task.energy_estimate ?? 0,
      task.mystery_factor
    ),
    high: acc.high + (task.energy_estimate ?? 0) * 2.5,
  }), { low: 0, average: 0, high: 0 });
}

function calculateValueRange(
  energyRange: EnergyRange,
  hourlyRate: number
): { low: number; average: number; high: number } {
  // Energy is on 1-8 scale, need to convert to hours using ENERGY_TO_MINUTES
  return {
    low: energyToMinutes(energyRange.low) / 60 * hourlyRate,
    average: energyToMinutes(energyRange.average) / 60 * hourlyRate,
    high: energyToMinutes(energyRange.high) / 60 * hourlyRate,
  };
}
```

---

## Project Detail View Changes

**Add estimate display to project detail page:**

Location: Project detail sidebar or summary section

Display:
- Phase-by-phase breakdown (collapsible)
- Project totals
- Use same `EstimateDisplayProps` component from wizard

---

## API Changes Summary

### Modified Endpoints

| Endpoint | Change |
|----------|--------|
| `POST /api/recipes/:id/phases/:phaseId/tasks` | Request body: `{ sop_id (required), title (optional), is_variable, variable_source }` |
| `PATCH /api/recipes/:id/phases/:phaseId/tasks` | Same field changes, plus supports `{ task_ids: [...] }` for reordering |
| `PATCH /api/recipes/:id/phases` | Supports `{ phase_ids: [...] }` for reordering |
| `POST /api/projects/wizard` | Task generation pulls from SOP, uses title override |
| `GET /api/recipes/:id` | Response includes SOP data for each task (for display) |

### New Endpoints

| Endpoint | Purpose |
|----------|---------|
| `PATCH /api/recipes/:id/tasks/:taskId/move` | Move task between phases: `{ target_phase_id, sort_order }` |

### New/Modified Response Shapes

**Recipe detail response should include SOP info:**
```json
{
  "id": "uuid",
  "name": "Standard Website Build",
  "requires_sitemap": true,
  "phases": [
    {
      "id": "uuid",
      "name": "Discovery",
      "sort_order": 0,
      "tasks": [
        {
          "id": "uuid",
          "sop_id": "uuid",
          "title": null,
          "is_variable": false,
          "sort_order": 0,
          "sop": {
            "id": "uuid",
            "name": "Client Kickoff Call",
            "energy_impact": 3,
            "mystery_factor": "none",
            "battery_impact": "average",
            "function": { "id": "uuid", "name": "PM" }
          }
        },
        {
          "id": "uuid",
          "sop_id": "uuid",
          "title": "Design {page}",
          "is_variable": true,
          "variable_source": "sitemap_page",
          "sort_order": 1,
          "sop": {
            "id": "uuid",
            "name": "Page Design",
            "energy_impact": 4,
            "mystery_factor": "average",
            "battery_impact": "high_drain",
            "function": { "id": "uuid", "name": "Designer" }
          }
        }
      ]
    }
  ]
}
```

**Display logic for task list:**
```typescript
// Show title override if set, otherwise SOP name
const displayTitle = task.title ?? task.sop.name;
```

---

## Migration Considerations

If existing RecipeTask records have data in the fields being removed:

1. **Before migration:** Export existing RecipeTask data
2. **Create SOPs:** For any RecipeTask without an sop_id, create a new SOP from the RecipeTask data
3. **Link:** Set sop_id on RecipeTask to the new/existing SOP
4. **Then migrate:** Remove the deprecated columns

---

## Files to Modify

### Schema
- [ ] `prisma/schema.prisma` - RecipeTask model changes (add title, make sop_id required)

### API Routes
- [ ] `app/api/recipes/[id]/phases/[phaseId]/tasks/route.ts` - CRUD for recipe tasks
- [ ] `app/api/recipes/[id]/tasks/[taskId]/move/route.ts` - NEW: Move task between phases
- [ ] `app/api/recipes/[id]/phases/route.ts` - Add phase reordering support
- [ ] `app/api/projects/wizard/route.ts` - Task generation logic

### Components
- [ ] `components/domain/wizard/WizardLayout.tsx` - Dynamic step handling
- [ ] `components/domain/wizard/WizardStep6Generate.tsx` - Add estimate display
- [ ] `components/domain/recipes/RecipeTaskForm.tsx` - SOP selector first, title override field
- [ ] `components/domain/recipes/RecipePhaseList.tsx` - Add drag-and-drop for phases
- [ ] `components/domain/recipes/RecipeTaskList.tsx` - Add drag-and-drop for tasks (within and between phases)

### New Components
- [ ] `components/domain/estimates/EstimateDisplay.tsx` - Reusable estimate table
- [ ] `components/domain/estimates/PhaseEstimateRow.tsx` - Phase row in estimate table
- [ ] `components/domain/recipes/SopPreview.tsx` - Read-only SOP info display for form

### Hooks
- [ ] `lib/hooks/useWizard.ts` - Handle conditional sitemap step
- [ ] `lib/hooks/useRecipeDragDrop.ts` - Drag-and-drop state and handlers

### Utilities
- [ ] `lib/calculations/energy.ts` - Add phase/project aggregate functions if not present

---

## Acceptance Criteria

### Schema & Data
1. [ ] RecipeTask schema contains: id, phase_id, sop_id (required), title (optional), is_variable, variable_source, sort_order, depends_on_ids
2. [ ] Creating a RecipeTask requires selecting an SOP
3. [ ] Title field auto-populates with SOP name but can be overridden

### Recipe Builder UI
4. [ ] Add Task form shows SOP selector as first/required field
5. [ ] On SOP selection, title pre-fills and SOP preview displays (function, energy, etc.)
6. [ ] Phases can be reordered via drag-and-drop
7. [ ] Tasks can be reordered within a phase via drag-and-drop
8. [ ] Tasks can be moved between phases via drag-and-drop

### Wizard
9. [ ] Wizard Step 3 (Sitemap) only appears when recipe.requires_sitemap is true
10. [ ] Wizard Step 6 displays phase-by-phase and total estimates

### Task Generation
11. [ ] Generated tasks use title override if set, otherwise SOP name
12. [ ] Generated tasks pull all other attributes from the linked SOP
13. [ ] Variable tasks replace {page} placeholder in title

### Project View
14. [ ] Project detail view shows phase and total estimates
15. [ ] Client hourly rate used for value calculation with $150/hr fallback (flagged in UI)