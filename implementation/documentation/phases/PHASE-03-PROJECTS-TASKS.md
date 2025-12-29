# Phase 3: Projects & Tasks Core
## Detailed Implementation Guide for Claude Code

**Phase:** 3 of 10  
**Estimated Duration:** 4-5 days  
**Prerequisites:** Phase 2 complete (Clients, Sites, Domains working)

---

## 🎯 Phase Goal

Build the core project and task management functionality. By the end of this phase:
- Users can create and manage Pacts (Projects) with full CRUD
- Users can create and manage Quests (Tasks) with status workflows
- Task visibility rules based on project status are enforced
- Blocking/blocked-by task relationships work
- Energy estimation fields are functional
- Team assignment to projects works

---

## 📚 Required Reading

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-api-endpoint-inventory.md` | Projects, Tasks endpoints |
| `indelible-data-model-refinement.md` | Projects, Tasks tables |
| `indelible-user-flows.md` | Task status workflow (Flow 2) |
| `indelible-wireframes-quest-detail.md` | Task detail layout |
| `indelible-wireframes-list-views.md` | Task list views |
| `indelible-app-architecture.md` | Project status definitions |

---

## 📋 Phase Checklist

### 3.1 Extend Prisma Schema

#### 3.1.1 Add Project and Task Models

Add to `/prisma/schema.prisma`:

```prisma
// ============================================
// PROJECTS (PACTS)
// ============================================

model Project {
  id                String        @id @default(uuid()) @db.Uuid
  name              String        @db.VarChar(255)
  description       String?       @db.Text
  
  // Status
  status            ProjectStatus @default(quote)
  
  // Relationships
  client_id         String        @db.Uuid
  client            Client        @relation(fields: [client_id], references: [id])
  site_id           String?       @db.Uuid
  site              Site?         @relation(fields: [site_id], references: [id])
  recipe_id         String?       @db.Uuid
  recipe            Recipe?       @relation(fields: [recipe_id], references: [id])
  
  // Type
  type              ProjectType   @default(project)
  
  // Dates
  start_date        DateTime?
  target_date       DateTime?
  completed_date    DateTime?
  
  // Budget
  estimated_hours   Decimal?      @db.Decimal(8, 2)
  budget_amount     Decimal?      @db.Decimal(10, 2)
  is_retainer       Boolean       @default(false)
  
  // Notes
  notes             String?       @db.Text
  
  // Metadata
  is_deleted        Boolean       @default(false)
  created_at        DateTime      @default(now())
  updated_at        DateTime      @updatedAt
  created_by_id     String?       @db.Uuid
  created_by        User?         @relation("ProjectCreatedBy", fields: [created_by_id], references: [id])
  
  // Relations
  tasks             Task[]
  team_assignments  ProjectTeamAssignment[]
  milestones        Milestone[]
  time_entries      TimeEntry[]
  
  @@index([client_id])
  @@index([site_id])
  @@index([status])
  @@index([type])
  @@map("projects")
}

enum ProjectStatus {
  quote           // Proposal stage, tasks hidden from assignees
  queue           // Approved but not started, tasks hidden
  ready           // Ready to work, tasks visible
  in_progress     // Active work, tasks visible
  review          // Final review, tasks visible
  done            // Completed
  suspended       // On hold, tasks hidden
  cancelled       // Cancelled
}

enum ProjectType {
  project         // Standard project
  retainer        // Ongoing retainer work
  internal        // Internal task collection
}

// ============================================
// PROJECT TEAM ASSIGNMENTS
// ============================================

model ProjectTeamAssignment {
  id            String   @id @default(uuid()) @db.Uuid
  project_id    String   @db.Uuid
  project       Project  @relation(fields: [project_id], references: [id], onDelete: Cascade)
  user_id       String   @db.Uuid
  user          User     @relation(fields: [user_id], references: [id])
  function_id   String?  @db.Uuid
  function      Function? @relation(fields: [function_id], references: [id])
  is_lead       Boolean  @default(false)
  created_at    DateTime @default(now())
  
  @@unique([project_id, user_id])
  @@index([project_id])
  @@index([user_id])
  @@map("project_team_assignments")
}

// ============================================
// TASKS (QUESTS)
// ============================================

model Task {
  id                  String      @id @default(uuid()) @db.Uuid
  title               String      @db.VarChar(500)
  description         String?     @db.Text
  
  // Status
  status              TaskStatus  @default(not_started)
  priority            Int         @default(3) // 1=highest, 5=lowest
  
  // Project relationship (nullable for ad-hoc tasks)
  project_id          String?     @db.Uuid
  project             Project?    @relation(fields: [project_id], references: [id])
  
  // Phase grouping
  phase               String?     @db.VarChar(100)
  sort_order          Int         @default(0)
  
  // Assignment
  assignee_id         String?     @db.Uuid
  assignee            User?       @relation("TaskAssignee", fields: [assignee_id], references: [id])
  function_id         String?     @db.Uuid
  function            Function?   @relation(fields: [function_id], references: [id])
  
  // Energy estimation
  energy_estimate     Int?        // 1-8 scale
  mystery_factor      MysteryFactor @default(none)
  estimated_minutes   Int?        // Calculated or manual
  
  // Dates
  due_date            DateTime?
  started_at          DateTime?
  completed_at        DateTime?
  
  // SOP reference
  sop_id              String?     @db.Uuid
  sop                 Sop?        @relation(fields: [sop_id], references: [id])
  
  // Requirements (stored as JSON)
  requirements        Json?       // Array of requirement items
  
  // Notes
  notes               String?     @db.Text
  
  // Metadata
  is_deleted          Boolean     @default(false)
  created_at          DateTime    @default(now())
  updated_at          DateTime    @updatedAt
  created_by_id       String?     @db.Uuid
  created_by          User?       @relation("TaskCreatedBy", fields: [created_by_id], references: [id])
  
  // Self-referential dependencies
  blocked_by          Task[]      @relation("TaskDependencies")
  blocking            Task[]      @relation("TaskDependencies")
  
  // Relations
  time_entries        TimeEntry[]
  
  @@index([project_id])
  @@index([assignee_id])
  @@index([status])
  @@index([priority])
  @@index([phase])
  @@map("tasks")
}

enum TaskStatus {
  not_started
  in_progress
  review
  done
  blocked
  abandoned
}

enum MysteryFactor {
  none        // 1x multiplier
  average     // 1.4x multiplier
  significant // 1.75x multiplier
  no_idea     // 2.5x multiplier
}

// ============================================
// MILESTONES
// ============================================

model Milestone {
  id            String    @id @default(uuid()) @db.Uuid
  name          String    @db.VarChar(255)
  project_id    String    @db.Uuid
  project       Project   @relation(fields: [project_id], references: [id], onDelete: Cascade)
  target_date   DateTime?
  completed_at  DateTime?
  notes         String?   @db.Text
  sort_order    Int       @default(0)
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt
  
  @@index([project_id])
  @@map("milestones")
}
```

- [ ] Run: `npx prisma migrate dev --name add-projects-tasks`
- [ ] Run: `npx prisma generate`

---

### 3.2 Create Business Logic Utilities

#### 3.2.1 Task Status Transitions
**Create `/lib/calculations/status.ts`:**

```typescript
import { TaskStatus, ProjectStatus } from '@prisma/client';

// Valid status transitions
const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  not_started: ['in_progress', 'blocked', 'abandoned'],
  in_progress: ['review', 'not_started', 'blocked', 'abandoned'],
  review: ['done', 'in_progress', 'abandoned'],
  done: ['in_progress'], // Reopen
  blocked: ['not_started', 'in_progress', 'abandoned'],
  abandoned: ['not_started'], // Resurrect
};

export function canTransitionTaskStatus(
  from: TaskStatus,
  to: TaskStatus
): boolean {
  if (from === to) return true;
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidNextStatuses(current: TaskStatus): TaskStatus[] {
  return TASK_TRANSITIONS[current] ?? [];
}

// Project statuses where tasks are visible to assignees
const VISIBLE_PROJECT_STATUSES: ProjectStatus[] = [
  'ready',
  'in_progress',
  'review',
  'done',
];

export function isTaskVisibleToAssignee(
  taskProjectId: string | null,
  projectStatus: ProjectStatus | null
): boolean {
  // Ad-hoc tasks (no project) are always visible
  if (!taskProjectId) return true;
  
  // Check if project status allows visibility
  if (!projectStatus) return false;
  return VISIBLE_PROJECT_STATUSES.includes(projectStatus);
}

export function getProjectStatusLabel(status: ProjectStatus): string {
  const labels: Record<ProjectStatus, string> = {
    quote: 'Quote',
    queue: 'Queue',
    ready: 'Ready',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
    suspended: 'Suspended',
    cancelled: 'Cancelled',
  };
  return labels[status];
}

export function getTaskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
    blocked: 'Blocked',
    abandoned: 'Abandoned',
  };
  return labels[status];
}
```

#### 3.2.2 Energy Calculations
**Create `/lib/calculations/energy.ts`:**

```typescript
import { MysteryFactor } from '@prisma/client';

const MYSTERY_MULTIPLIERS: Record<MysteryFactor, number> = {
  none: 1.0,
  average: 1.4,
  significant: 1.75,
  no_idea: 2.5,
};

// Energy to minutes mapping (based on your system)
const ENERGY_TO_MINUTES: Record<number, number> = {
  1: 15,   // Quick task
  2: 30,   // Half hour
  3: 60,   // 1 hour
  4: 120,  // 2 hours
  5: 240,  // Half day
  6: 480,  // Full day
  7: 960,  // 2 days
  8: 1920, // 4 days
};

export function getMysteryMultiplier(factor: MysteryFactor): number {
  return MYSTERY_MULTIPLIERS[factor];
}

export function calculateWeightedEnergy(
  baseEnergy: number,
  mysteryFactor: MysteryFactor
): number {
  const multiplier = getMysteryMultiplier(mysteryFactor);
  return baseEnergy * multiplier;
}

export function energyToMinutes(energy: number): number {
  const clamped = Math.max(1, Math.min(8, Math.round(energy)));
  return ENERGY_TO_MINUTES[clamped] ?? ENERGY_TO_MINUTES[3];
}

export function calculateEstimatedMinutes(
  energyEstimate: number | null,
  mysteryFactor: MysteryFactor
): number | null {
  if (!energyEstimate) return null;
  
  const baseMinutes = energyToMinutes(energyEstimate);
  const multiplier = getMysteryMultiplier(mysteryFactor);
  return Math.round(baseMinutes * multiplier);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}
```

---

### 3.3 Pacts (Projects) Implementation

#### 3.3.1 Project API Endpoints
- [ ] `GET /api/projects` — List with filters (status, client, type)
- [ ] `GET /api/projects/:id` — Detail with tasks, team, milestones
- [ ] `POST /api/projects` — Create (simple, no wizard yet)
- [ ] `PATCH /api/projects/:id` — Update
- [ ] `PATCH /api/projects/:id/status` — Status transitions with validation
- [ ] `DELETE /api/projects/:id` — Soft delete
- [ ] `POST /api/projects/:id/team` — Add team member
- [ ] `DELETE /api/projects/:id/team/:userId` — Remove team member

#### 3.3.2 Project React Query Hooks
**Create `/lib/hooks/useProjects.ts`:**
- [ ] `useProjects(filters)` — List query
- [ ] `useProject(id)` — Detail query
- [ ] `useCreateProject()` — Create mutation
- [ ] `useUpdateProject()` — Update mutation
- [ ] `useUpdateProjectStatus()` — Status change mutation
- [ ] `useDeleteProject()` — Delete mutation
- [ ] `useProjectTeam(projectId)` — Team query
- [ ] `useAddTeamMember()` — Add team mutation
- [ ] `useRemoveTeamMember()` — Remove team mutation

#### 3.3.3 Project UI Components
- [ ] `/app/(app)/sanctum/pacts/page.tsx` — Project list
- [ ] `/app/(app)/sanctum/pacts/[id]/page.tsx` — Project detail with tabs
- [ ] `/components/domain/projects/ProjectCard.tsx`
- [ ] `/components/domain/projects/ProjectStatusBadge.tsx`
- [ ] `/components/domain/projects/ProjectFormModal.tsx`
- [ ] `/components/domain/projects/ProjectOverviewTab.tsx`
- [ ] `/components/domain/projects/ProjectTasksTab.tsx`
- [ ] `/components/domain/projects/ProjectWorkloadTab.tsx`
- [ ] `/components/domain/projects/ProjectTimeTab.tsx`
- [ ] `/components/domain/projects/ProjectTeamSection.tsx`

---

### 3.4 Quests (Tasks) Implementation

#### 3.4.1 Task API Endpoints
- [ ] `GET /api/tasks` — List with filters and visibility rules
- [ ] `GET /api/tasks/:id` — Detail with dependencies
- [ ] `POST /api/tasks` — Create
- [ ] `PATCH /api/tasks/:id` — Update
- [ ] `PATCH /api/tasks/:id/status` — Status transition with validation
- [ ] `DELETE /api/tasks/:id` — Soft delete
- [ ] `POST /api/tasks/:id/requirements` — Add requirement
- [ ] `PATCH /api/tasks/:id/requirements/:reqId` — Toggle/update requirement
- [ ] `DELETE /api/tasks/:id/requirements/:reqId` — Remove requirement
- [ ] `POST /api/tasks/:id/dependencies` — Add blocking relationship
- [ ] `DELETE /api/tasks/:id/dependencies/:blockerId` — Remove dependency

**Important: Task List Endpoint with Visibility**
```typescript
// In GET /api/tasks, apply visibility filter for Tech role
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  
  // Base where clause
  let where: any = { is_deleted: false };
  
  // Tech users only see tasks from visible projects or ad-hoc tasks
  if (auth.role === 'tech') {
    where = {
      ...where,
      OR: [
        // Ad-hoc tasks assigned to user
        { project_id: null, assignee_id: auth.userId },
        // Tasks from visible projects assigned to user
        {
          assignee_id: auth.userId,
          project: {
            status: { in: ['ready', 'in_progress', 'review', 'done'] }
          }
        }
      ]
    };
  }
  
  // ... rest of query
}
```

#### 3.4.2 Task React Query Hooks
**Create `/lib/hooks/useTasks.ts`:**
- [ ] `useTasks(filters)` — List query with visibility
- [ ] `useTask(id)` — Detail query
- [ ] `useCreateTask()` — Create mutation
- [ ] `useUpdateTask()` — Update mutation
- [ ] `useUpdateTaskStatus()` — Status change with optimistic update
- [ ] `useDeleteTask()` — Delete mutation
- [ ] `useTaskRequirements(taskId)` — Requirements query
- [ ] `useToggleRequirement()` — Toggle with optimistic update

#### 3.4.3 Task UI Components
- [ ] `/app/(app)/sanctum/quests/page.tsx` — Task list
- [ ] `/app/(app)/sanctum/quests/[id]/page.tsx` — Task detail (full page)
- [ ] `/components/domain/tasks/TaskCard.tsx`
- [ ] `/components/domain/tasks/TaskStatusBadge.tsx`
- [ ] `/components/domain/tasks/TaskPriorityBadge.tsx`
- [ ] `/components/domain/tasks/TaskFormModal.tsx`
- [ ] `/components/domain/tasks/TaskDetail.tsx`
- [ ] `/components/domain/tasks/TaskRequirements.tsx`
- [ ] `/components/domain/tasks/TaskDependencies.tsx`
- [ ] `/components/domain/tasks/TaskPeekDrawer.tsx` — Slide-in preview

---

### 3.5 Task Visibility Rules

#### 3.5.1 Implement Visibility Logic
- [ ] Tech users only see tasks where:
  - Ad-hoc task (no project) assigned to them
  - Project task assigned to them AND project.status in ['ready', 'in_progress', 'review', 'done']
- [ ] PM/Admin users see all tasks
- [ ] Dashboard queries respect visibility

#### 3.5.2 Test Visibility
- [ ] Create test: Tech cannot see tasks from 'quote' project
- [ ] Create test: Tech can see tasks from 'in_progress' project
- [ ] Create test: PM can see all tasks regardless of project status

---

### 3.6 Task Requirements (Checklist)

#### 3.6.1 Requirements Data Structure
```typescript
// In task.requirements JSON
interface Requirement {
  id: string;
  text: string;
  completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  sort_order: number;
}
```

#### 3.6.2 Requirements UI
- [ ] Display requirements list on task detail
- [ ] Toggle checkbox with optimistic update
- [ ] Add new requirement inline
- [ ] Reorder requirements (drag-drop if time permits)
- [ ] Show progress: "3 of 5 complete"

---

### 3.7 Blocking Dependencies

#### 3.7.1 Dependencies UI
- [ ] Show "Blocked by" section on task detail
- [ ] Show "Blocking" section on task detail
- [ ] Add dependency modal/dropdown
- [ ] Visual indicator on blocked tasks in list view
- [ ] Auto-set status to 'blocked' when blocker added (if not already blocked)

---

## 🧪 Testing Requirements

### Unit Tests
- [ ] `/__tests__/unit/calculations/status.test.ts` — Status transition tests
- [ ] `/__tests__/unit/calculations/energy.test.ts` — Energy calculation tests

### Integration Tests
- [ ] `/__tests__/integration/api/projects.test.ts`
  - CRUD operations
  - Status transition validation
  - Team assignment
- [ ] `/__tests__/integration/api/tasks.test.ts`
  - CRUD operations
  - Status transitions
  - Visibility filtering (Tech vs PM)
  - Requirements manipulation
  - Dependencies

---

## âœ… Phase 3 Acceptance Criteria

### Functionality
- [ ] Can create project and assign to client/site
- [ ] Can update project status with valid transitions only
- [ ] Can assign team members to project
- [ ] Can create tasks within project
- [ ] Task status workflow works correctly
- [ ] Task visibility enforced (Tech can't see 'quote' project tasks)
- [ ] Energy estimation calculates with mystery factor
- [ ] Requirements checklist works with toggle
- [ ] Blocking dependencies work
- [ ] Project detail shows all tabs

### Code Quality
- [ ] Business logic in `/lib/calculations/`
- [ ] Optimistic updates for status changes
- [ ] All patterns consistent with Phase 1-2

### Tests
- [ ] Unit tests for status and energy calculations
- [ ] Integration tests for all endpoints
- [ ] Visibility tests pass

---

## 📜 Next Phase

After completing Phase 3, proceed to **Phase 4: Time Tracking**.

Phase 4 will build:
- Timer widget in header
- Time entry creation from timer
- Manual time entry
- Time entry list views

---

*Phase 3 Document — Last Updated: December 2025*