# Indelible Round Two: Gap Remediation Master Plan

**Created:** December 28, 2025
**Last Updated:** December 29, 2025
**Current Status:** ✅ Critical Priority COMPLETE - High Priority 4/5
**Tracking Location:** `/implementation/round-two/MASTER-PLAN.md`

## Decisions Made
- **Email for Password Reset:** Console logging only (no external email service for MVP)
- **Tracking Directory:** Create `/implementation/round-two/` with MASTER-PLAN.md as source of truth
- **Scope:** All priority tiers, with human checkpoint between each tier
- **Kanban Board:** Moved to super low priority
- **Notes System & SOP Version History:** Moved to super low priority

---

## Progress Summary

| Priority Tier | Total | Complete | In Progress | Not Started |
|---------------|-------|----------|-------------|-------------|
| Critical      | 4     | 4        | 0           | 0           |
| High          | 5     | 4        | 0           | 1           |
| Medium        | 6     | 1        | 0           | 5           |
| Lower         | 5     | 0        | 0           | 5           |

---

## Critical Priority Features

### Feature 1: Toast Notifications ✅
**Source:** Phase 1 - Foundation, FEATURE-AUDIT.md
**Status:** Complete
**Blocked By:** None

#### Implementation Summary
- Installed `sonner` library
- Created `/components/ui/toast.tsx` with theme-aware styling
- Created `/lib/hooks/use-toast.ts` with helper functions
- Added `<Toaster />` to AppProviders
- Updated mutation hooks in `use-tasks.ts`, `use-clients.ts`, `use-projects.ts`

---

### Feature 2: Task Comments ✅
**Source:** Phase 8, remote-features-audit.md
**Status:** Complete
**Blocked By:** None

#### Implementation Summary
- Added `Comment` model to Prisma schema with soft delete
- Created `/app/api/tasks/[id]/comments/route.ts` (GET list, POST create)
- Created `/app/api/comments/[id]/route.ts` (GET, PATCH, DELETE)
- Created `/lib/hooks/use-comments.ts` with React Query hooks
- Created `/components/domain/tasks/comment-section.tsx` (combined UI)
- Added CommentSection to task-peek-drawer.tsx
- Notifications triggered on comment creation

---

### Feature 3: Forgot/Reset Password ✅
**Source:** Phase 1 - Foundation, remote-features-audit.md
**Status:** Complete
**Blocked By:** None

#### Implementation Summary
- Added `PasswordResetToken` model to Prisma schema
- Created `/lib/services/email.ts` with console logging for MVP
- Created `/app/api/auth/forgot-password/route.ts` with rate limiting (3/hour/email)
- Created `/app/api/auth/reset-password/route.ts` with token validation and session invalidation
- Created `/app/(auth)/forgot-password/page.tsx`
- Created `/app/(auth)/reset-password/page.tsx`
- Added "Forgot password?" link to login page

---

### Feature 4: Activity Feed / Audit Logging ✅
**Source:** Phase 8, remote-features-audit.md
**Status:** Complete
**Blocked By:** None

#### Implementation Summary
- Added `ActivityLog` model to Prisma schema with indexes
- Created `/lib/services/activity.ts` with helper functions:
  - `logActivity()`, `logCreate()`, `logUpdate()`, `logDelete()`, `logStatusChange()`, `logAssignment()`, `detectChanges()`
- Created `/app/api/activities/route.ts` (GET with entity_type, entity_id, user_id filters)
- Added activity logging to task API routes (create, status change, delete)
- Created `/lib/hooks/use-activities.ts` with React Query hooks
- Created `/components/domain/activities/activity-feed.tsx` (collapsible feed)
- Added ActivityFeed to task-peek-drawer.tsx

---

## High Priority Features

### Feature 5: User Management (Admin) ✅
**Source:** Phase 2, remote-features-audit.md
**Status:** Complete
**Blocked By:** Toast Notifications

#### Implementation Summary
- Enhanced `/app/api/users/route.ts` with POST for creating users (admin only)
- Created `/app/api/users/[id]/route.ts` with GET, PATCH, DELETE (admin only)
- Added Zod validation schemas for create/update/password reset
- Password hashing with bcryptjs (cost 12)
- Self-protection: admins cannot deactivate/delete/change role on themselves
- Smart delete: deactivates users with related records instead of hard delete
- Created `/lib/hooks/use-users.ts` with full CRUD + password reset hooks
- Created `/app/(app)/admin/team/page.tsx` following admin page pattern
- Features: role badges, status toggle, password reset modal, last login display
- Already linked in sidebar at `/admin/team`

---

### Feature 6: Battery Status on Dashboard ✅
**Source:** Phase 5, FEATURE-AUDIT.md
**Status:** Complete
**Blocked By:** None

#### Implementation Summary
Dashboard task lists were overhauled to use the generic TaskList component with configurable columns. Battery impact is now available as an editable column (`batteryColumn`) that can be added to any task list. The dashboard Focus Quests and My Quests lists use ranged estimates that factor in energy/mystery, with battery available in the full task view.

---

### Feature 7: Milestone UI ✅
**Source:** Phase 3, FEATURE-AUDIT.md
**Status:** Complete
**Blocked By:** Toast Notifications

#### Implementation Summary
- Created `/app/api/projects/[id]/milestones/route.ts` (GET, POST)
- Created `/app/api/milestones/[id]/route.ts` (GET, PATCH, DELETE)
- Created `/lib/hooks/use-milestones.ts` with full CRUD + toggle complete hooks
- Created `/components/domain/projects/milestone-list.tsx` with grouping (Upcoming/Completed)
- Created `/components/domain/projects/milestone-form.tsx` for create/edit
- Added MilestoneList to project detail page (Details tab)
- Set up Vitest testing infrastructure
- Created `/lib/hooks/__tests__/use-milestones.test.ts` with 10 passing tests

**Features:**
- Create milestone with name, target date, notes
- Mark milestone as complete/incomplete (toggle)
- Edit milestone details
- Delete milestone with confirmation
- Milestones grouped by status (Upcoming vs Completed)
- Visual indicators for completion status and past due dates

---

### Feature 8: Kanban/Board View for Tasks
**Source:** Phase 3, remote-features-audit.md
**Status:** Not Started
**Blocked By:** Toast Notifications

#### Discovery Summary
- **Impacted Files:** Tasks page
- **Existing Patterns:** dnd-kit already installed, used in recipe wizard
- **Schema Changes Required:** No
- **New API Endpoints:** None (status update already works)
- **Modified API Endpoints:** None
- **New Components:** TaskBoard, TaskBoardColumn, TaskBoardCard
- **Modified Components:** Tasks page (add view toggle)

#### Implementation Plan

**Frontend**
- [ ] Create `/components/domain/tasks/task-board-card.tsx`
- [ ] Create `/components/domain/tasks/task-board-column.tsx`
- [ ] Create `/components/domain/tasks/task-board.tsx` (with dnd-kit)
- [ ] Update `/app/(app)/tasks/page.tsx`:
  - Add view toggle (List | Board)
  - Conditionally render TaskList or TaskBoard
  - Persist view preference in localStorage

**Verification**
- [ ] Can toggle between list and board view
- [ ] Board shows columns: Not Started, In Progress, Blocked, Review, Done
- [ ] Can drag task to change status
- [ ] Task count shown per column

---

### Feature 9: Project Health UI ✅
**Source:** Phase 5, FEATURE-AUDIT.md
**Status:** Complete
**Blocked By:** None

#### Implementation Summary
- Created `calculateHealthFromTasks()` in `/lib/calculations/project-health.ts` for in-memory health calculation (no extra DB queries)
- Updated `formatProjectResponse()` to include health for active projects (ready, in_progress, review)
- Added `ProjectHealth` interface to `/lib/hooks/use-projects.ts`
- Created `/components/domain/projects/project-health-badge.tsx` with:
  - `ProjectHealthBadge`: Full badge with icon and label
  - `ProjectHealthDot`: Compact colored dot for list views
- Updated project list to show health dots next to project names
- Health shows: overall score, status (healthy/at-risk/critical), alerts for blocked/overdue tasks
- Scoring: weighted combination of tasks on track (40%), estimate accuracy (30%), blockage level (20%), velocity (10%)

---

## Medium Priority Features

### Feature 10: Notes System with Roll-up
**Source:** Phase 8, remote-features-audit.md
**Status:** Not Started
**Blocked By:** Task Comments (similar pattern)

*[Implementation details to be added when approaching this tier]*

---

### Feature 11: SOP Version History
**Source:** Phase 7, FEATURE-AUDIT.md
**Status:** Not Started
**Blocked By:** Activity Logging (can reuse pattern)

*[Implementation details to be added when approaching this tier]*

---

### Feature 12: SOP Review Status
**Source:** Phase 7, remote-features-audit.md
**Status:** Not Started
**Blocked By:** None

*[Implementation details to be added when approaching this tier]*

---

### Feature 13: Task Billing Fields ✅
**Source:** Phase 3, remote-features-audit.md
**Status:** Complete
**Blocked By:** None

#### Implementation Summary
Added three billing fields to Task model:
- `is_billable` (Boolean, default true) - Whether task can be billed
- `billing_target` (Decimal, nullable) - Max billable minutes (billing cap)
- `is_retainer_work` (Boolean, default false) - Whether task counts against retainer

**Changes Made:**
- Updated Prisma schema with new fields
- Updated Task create/update APIs (PM/Admin only for billing fields)
- Updated `/api/tasks/[id]/billing` endpoint with all billing fields
- Updated formatters and Task type interface
- Updated `/api/billing/unbilled` to filter by is_billable and include new fields
- Added Cap column and Retainer toggle to billing dashboard table
- Added Billing section to task form with checkboxes and billing cap input

---

### Feature 14: Variable Substitution Enhancement
**Source:** Phase 6, FEATURE-AUDIT.md
**Status:** Not Started
**Blocked By:** None

*[Implementation details to be added when approaching this tier]*

---

### Feature 15: Tools Reference Data
**Source:** Phase 2, remote-features-audit.md
**Status:** Not Started
**Blocked By:** None

*[Implementation details to be added when approaching this tier]*

---

## Lower Priority Features

### Feature 16: Meetings Feature
**Source:** Phase 3, remote-features-audit.md
**Status:** Not Started

### Feature 17: Quick Links on Sites
**Source:** Phase 2, remote-features-audit.md
**Status:** Not Started

### Feature 18: Resource Links on Projects
**Source:** Phase 3, remote-features-audit.md
**Status:** Not Started

### Feature 19: Additional Keyboard Shortcuts
**Source:** Phase 8, remote-features-audit.md
**Status:** Not Started

### Feature 20: Unit/Integration Tests
**Source:** Phase 10, FEATURE-AUDIT.md
**Status:** Not Started

---

## Cross-Feature Dependencies

```
Toast Notifications (Feature 1)
    └── Required by ALL other features for user feedback

Task Comments (Feature 2)
    └── Pattern reused by Notes System (Feature 10)

Activity Logging (Feature 4)
    └── Pattern reused by SOP Version History (Feature 11)
```

**Implementation Order:**
1. Toast Notifications (unlocks everything)
2. Features 2-4 can proceed in parallel
3. Features 5-9 can proceed in parallel
4. Medium/Lower as time permits

---

## Schema Change Summary

| Feature | Table | Change Type | Description |
|---------|-------|-------------|-------------|
| Task Comments | Comment | ADD TABLE | Comments on tasks |
| Task Comments | Task | ADD RELATION | comments[] relation |
| Forgot Password | PasswordResetToken | ADD TABLE | Password reset tokens |
| Activity Logging | ActivityLog | ADD TABLE | Audit trail |

---

## Files to Create (Summary)

### Components
- `/components/ui/toast.tsx`
- `/components/domain/tasks/comment-*.tsx` (3 files)
- `/components/domain/activities/activity-*.tsx` (2 files)
- `/components/domain/admin/user-form.tsx`
- `/components/domain/projects/milestone-*.tsx` (3 files)
- `/components/domain/projects/project-health-badge.tsx`
- `/components/domain/tasks/task-board*.tsx` (3 files)

### API Routes
- `/app/api/auth/forgot-password/route.ts`
- `/app/api/auth/reset-password/route.ts`
- `/app/api/tasks/[id]/comments/route.ts`
- `/app/api/comments/[id]/route.ts`
- `/app/api/activities/route.ts`
- `/app/api/users/[id]/route.ts`
- `/app/api/projects/[id]/milestones/route.ts`
- `/app/api/milestones/[id]/route.ts`

### Pages
- `/app/(auth)/forgot-password/page.tsx`
- `/app/(auth)/reset-password/page.tsx`
- `/app/(app)/admin/users/page.tsx`

### Hooks
- `/lib/hooks/use-toast.ts`
- `/lib/hooks/use-comments.ts`
- `/lib/hooks/use-activities.ts`
- `/lib/hooks/use-milestones.ts`

### Services
- `/lib/services/email.ts`
- `/lib/services/activity.ts`
