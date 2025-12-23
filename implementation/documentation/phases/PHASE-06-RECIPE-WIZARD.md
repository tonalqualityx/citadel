# Phase 6: Recipe Wizard
## Detailed Implementation Guide for Claude Code

**Phase:** 6 of 10  
**Estimated Duration:** 3-4 days  
**Prerequisites:** Phase 5 complete (Dashboards working)

---

## ðŸŽ¯ Phase Goal

Build the project creation wizard that generates projects from recipe templates. By the end of this phase:
- Recipes (project templates) can be created and managed
- Multi-step wizard guides users through project creation
- Variable tasks are generated from sitemap input
- Team assignments map functions to users
- Full project with tasks is generated in one operation

---

## ðŸ“š Required Reading

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-user-flows.md` | Flow 1: Project Creation Wizard |
| `indelible-schema-addendum.md` | Recipes, Recipe Tasks, Project Pages |
| `indelible-api-endpoint-inventory.md` | Recipe and wizard endpoints |
| `indelible-wireframes-creation-flows.md` | Wizard step layouts |

---

## ðŸ“‹ Phase Checklist

### 6.1 Extend Prisma Schema

#### 6.1.1 Add Recipe Models

```prisma
// ============================================
// RECIPES (PROJECT TEMPLATES)
// ============================================

model Recipe {
  id            String       @id @default(uuid()) @db.Uuid
  name          String       @db.VarChar(255)
  description   String?      @db.Text
  
  // Configuration
  default_type  ProjectType  @default(project)
  
  // Metadata
  is_active     Boolean      @default(true)
  created_at    DateTime     @default(now())
  updated_at    DateTime     @updatedAt
  
  // Relations
  phases        RecipePhase[]
  projects      Project[]
  
  @@map("recipes")
}

model RecipePhase {
  id          String       @id @default(uuid()) @db.Uuid
  recipe_id   String       @db.Uuid
  recipe      Recipe       @relation(fields: [recipe_id], references: [id], onDelete: Cascade)
  name        String       @db.VarChar(100)
  sort_order  Int          @default(0)
  
  // Relations
  tasks       RecipeTask[]
  
  @@index([recipe_id])
  @@map("recipe_phases")
}

model RecipeTask {
  id                  String        @id @default(uuid()) @db.Uuid
  phase_id            String        @db.Uuid
  phase               RecipePhase   @relation(fields: [phase_id], references: [id], onDelete: Cascade)
  
  // Task template
  title               String        @db.VarChar(500)
  description         String?       @db.Text
  
  // Defaults
  default_priority    Int           @default(3)
  default_function_id String?       @db.Uuid
  default_function    Function?     @relation(fields: [default_function_id], references: [id])
  energy_estimate     Int?
  mystery_factor      MysteryFactor @default(none)
  
  // Variable task settings
  is_variable         Boolean       @default(false)
  variable_source     String?       @db.VarChar(50) // 'sitemap_page', 'custom'
  
  // SOP reference
  sop_id              String?       @db.Uuid
  sop                 Sop?          @relation(fields: [sop_id], references: [id])
  
  // Requirements template
  template_requirements Json?
  
  // Ordering
  sort_order          Int           @default(0)
  
  // Dependencies (other recipe tasks this depends on)
  depends_on_ids      String[]      @db.Uuid
  
  @@index([phase_id])
  @@map("recipe_tasks")
}

// ============================================
// PROJECT PAGES (SITEMAP)
// ============================================

model ProjectPage {
  id            String   @id @default(uuid()) @db.Uuid
  project_id    String   @db.Uuid
  project       Project  @relation(fields: [project_id], references: [id], onDelete: Cascade)
  name          String   @db.VarChar(255)
  page_type     String?  @db.VarChar(50)
  needs_design  Boolean  @default(false)
  notes         String?  @db.Text
  sort_order    Int      @default(0)
  
  @@index([project_id])
  @@map("project_pages")
}
```

- [ ] Run migration
- [ ] Update Project model to include `pages ProjectPage[]` relation

---

### 6.2 Recipe Management

#### 6.2.1 Recipe API Endpoints
- [ ] `GET /api/recipes` â€” List active recipes
- [ ] `GET /api/recipes/:id` â€” Detail with phases and tasks
- [ ] `POST /api/recipes` â€” Create (Admin/PM)
- [ ] `PATCH /api/recipes/:id` â€” Update
- [ ] `DELETE /api/recipes/:id` â€” Soft delete (set inactive)
- [ ] `POST /api/recipes/:id/phases` â€” Add phase
- [ ] `POST /api/recipes/:id/phases/:phaseId/tasks` â€” Add task to phase

#### 6.2.2 Recipe UI
- [ ] `/app/(app)/grimoire/rituals/page.tsx` â€” Recipe list
- [ ] `/app/(app)/grimoire/rituals/[id]/page.tsx` â€” Recipe detail with phases
- [ ] `/components/domain/recipes/RecipeCard.tsx`
- [ ] `/components/domain/recipes/RecipePhaseList.tsx`
- [ ] `/components/domain/recipes/RecipeTaskList.tsx`
- [ ] `/components/domain/recipes/RecipeFormModal.tsx`

---

### 6.3 Project Creation Wizard

#### 6.3.1 Wizard State Management
**Create `/lib/hooks/useWizard.ts`:**

```typescript
import { useState, useCallback } from 'react';

interface WizardState {
  // Step 1: Recipe
  recipeId: string | null;
  
  // Step 2: Client & Site
  clientId: string | null;
  siteId: string | null;
  
  // Step 3: Sitemap
  pages: Array<{
    name: string;
    pageType: string;
    needsDesign: boolean;
  }>;
  
  // Step 4: Team
  teamAssignments: Array<{
    functionId: string;
    userId: string;
  }>;
  
  // Step 5: Configuration
  projectName: string;
  startDate: string | null;
  targetDate: string | null;
  notes: string;
}

export function useProjectWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [state, setState] = useState<WizardState>({
    recipeId: null,
    clientId: null,
    siteId: null,
    pages: [],
    teamAssignments: [],
    projectName: '',
    startDate: null,
    targetDate: null,
    notes: '',
  });

  const updateState = useCallback((updates: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, 6));
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(step);
  }, []);

  const reset = useCallback(() => {
    setCurrentStep(1);
    setState({
      recipeId: null,
      clientId: null,
      siteId: null,
      pages: [],
      teamAssignments: [],
      projectName: '',
      startDate: null,
      targetDate: null,
      notes: '',
    });
  }, []);

  return {
    currentStep,
    state,
    updateState,
    nextStep,
    prevStep,
    goToStep,
    reset,
  };
}
```

#### 6.3.2 Wizard API Endpoint
**Create `/app/api/projects/wizard/route.ts`:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const wizardSchema = z.object({
  recipe_id: z.string().uuid(),
  client_id: z.string().uuid(),
  site_id: z.string().uuid().optional(),
  name: z.string().min(1),
  pages: z.array(z.object({
    name: z.string(),
    page_type: z.string().optional(),
    needs_design: z.boolean(),
  })),
  team_assignments: z.array(z.object({
    function_id: z.string().uuid(),
    user_id: z.string().uuid(),
  })),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = wizardSchema.parse(body);

    // Fetch recipe with phases and tasks
    const recipe = await prisma.recipe.findUnique({
      where: { id: data.recipe_id },
      include: {
        phases: {
          include: { tasks: true },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    if (!recipe) {
      throw new Error('Recipe not found');
    }

    // Create project with all related data in transaction
    const project = await prisma.$transaction(async (tx) => {
      // Create project
      const project = await tx.project.create({
        data: {
          name: data.name,
          client_id: data.client_id,
          site_id: data.site_id,
          recipe_id: data.recipe_id,
          type: recipe.default_type,
          start_date: data.start_date ? new Date(data.start_date) : null,
          target_date: data.target_date ? new Date(data.target_date) : null,
          notes: data.notes,
          created_by_id: auth.userId,
        },
      });

      // Create project pages
      if (data.pages.length > 0) {
        await tx.projectPage.createMany({
          data: data.pages.map((page, index) => ({
            project_id: project.id,
            name: page.name,
            page_type: page.page_type,
            needs_design: page.needs_design,
            sort_order: index,
          })),
        });
      }

      // Create team assignments
      if (data.team_assignments.length > 0) {
        await tx.projectTeamAssignment.createMany({
          data: data.team_assignments.map((assignment) => ({
            project_id: project.id,
            function_id: assignment.function_id,
            user_id: assignment.user_id,
          })),
        });
      }

      // Generate tasks from recipe
      const taskIdMap = new Map<string, string>(); // recipe_task_id -> task_id

      for (const phase of recipe.phases) {
        for (const recipeTask of phase.tasks) {
          // Find assigned user for this function
          const assignment = data.team_assignments.find(
            (a) => a.function_id === recipeTask.default_function_id
          );

          if (recipeTask.is_variable && recipeTask.variable_source === 'sitemap_page') {
            // Create one task per page
            for (const page of data.pages) {
              const task = await tx.task.create({
                data: {
                  project_id: project.id,
                  title: recipeTask.title.replace('{page}', page.name),
                  description: recipeTask.description,
                  phase: phase.name,
                  priority: recipeTask.default_priority,
                  function_id: recipeTask.default_function_id,
                  assignee_id: assignment?.user_id,
                  energy_estimate: recipeTask.energy_estimate,
                  mystery_factor: recipeTask.mystery_factor,
                  sop_id: recipeTask.sop_id,
                  requirements: recipeTask.template_requirements,
                  created_by_id: auth.userId,
                },
              });
              // Store mapping (use first page for dependency resolution)
              if (!taskIdMap.has(recipeTask.id)) {
                taskIdMap.set(recipeTask.id, task.id);
              }
            }
          } else {
            // Create single task
            const task = await tx.task.create({
              data: {
                project_id: project.id,
                title: recipeTask.title,
                description: recipeTask.description,
                phase: phase.name,
                priority: recipeTask.default_priority,
                function_id: recipeTask.default_function_id,
                assignee_id: assignment?.user_id,
                energy_estimate: recipeTask.energy_estimate,
                mystery_factor: recipeTask.mystery_factor,
                sop_id: recipeTask.sop_id,
                requirements: recipeTask.template_requirements,
                created_by_id: auth.userId,
              },
            });
            taskIdMap.set(recipeTask.id, task.id);
          }
        }
      }

      // TODO: Set up task dependencies based on recipe_task.depends_on_ids
      // This requires additional logic to map recipe task IDs to created task IDs

      return project;
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
```

#### 6.3.3 Wizard UI Components
- [ ] `/app/(app)/sanctum/pacts/new/page.tsx` â€” Wizard page
- [ ] `/components/domain/wizard/WizardLayout.tsx` â€” Step indicator, navigation
- [ ] `/components/domain/wizard/WizardStep1Recipe.tsx` â€” Select recipe
- [ ] `/components/domain/wizard/WizardStep2Client.tsx` â€” Select client & site
- [ ] `/components/domain/wizard/WizardStep3Sitemap.tsx` â€” Enter pages
- [ ] `/components/domain/wizard/WizardStep4Team.tsx` â€” Assign team
- [ ] `/components/domain/wizard/WizardStep5Review.tsx` â€” Review & configure
- [ ] `/components/domain/wizard/WizardStep6Generate.tsx` â€” Generate project

---

### 6.4 Sitemap Input UI

#### 6.4.1 Sitemap Editor
- [ ] Add page row (name, type dropdown, needs design checkbox)
- [ ] Reorder pages
- [ ] Remove pages
- [ ] Quick add common pages (Home, About, Contact, etc.)
- [ ] Import from existing site (if migrating)

---

### 6.5 Team Assignment UI

#### 6.5.1 Team Assignment Grid
- [ ] Show functions required by recipe
- [ ] Dropdown to select user for each function
- [ ] Show user avatar/name when selected
- [ ] Validate all required functions have assignments

---

## ðŸ§ª Testing Requirements

### Integration Tests
- [ ] `/__tests__/integration/api/wizard.test.ts`
  - Wizard creates project with correct data
  - Variable tasks are generated per page
  - Team assignments are created
  - Tasks have correct assignments

---

## âœ… Phase 6 Acceptance Criteria

### Functionality
- [ ] Recipes can be created and edited
- [ ] Wizard step 1 shows available recipes
- [ ] Wizard step 2 allows client/site selection
- [ ] Wizard step 3 allows sitemap entry
- [ ] Wizard step 4 maps functions to users
- [ ] Wizard step 5 shows summary for review
- [ ] Generating creates project with all tasks
- [ ] Variable tasks created for each page
- [ ] Team assignments correct

---

## ðŸ”œ Next Phase

After completing Phase 6, proceed to **Phase 7: SOPs & Rich Text**.

---

*Phase 6 Document â€” Last Updated: December 2025*