# Indelible Round Two: Gap Remediation Master Plan

**Created:** December 28, 2025
**Last Updated:** December 28, 2025
**Current Status:** ✅ Critical Priority COMPLETE - Awaiting Approval
**Tracking Location:** `/implementation/round-two/MASTER-PLAN.md`

## Decisions Made
- **Email for Password Reset:** Console logging only (no external email service for MVP)
- **Tracking Directory:** Create `/implementation/round-two/` with MASTER-PLAN.md as source of truth
- **Scope:** All priority tiers, with human checkpoint between each tier

---

## Progress Summary

| Priority Tier | Total | Complete | In Progress | Not Started |
|---------------|-------|----------|-------------|-------------|
| Critical      | 4     | 4        | 0           | 0           |
| High          | 5     | 0        | 0           | 5           |
| Medium        | 6     | 0        | 0           | 6           |
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

### Feature 5: User Management (Admin)
**Source:** Phase 2, remote-features-audit.md
**Status:** Not Started
**Blocked By:** Toast Notifications

#### Discovery Summary
- **Impacted Files:** Admin section, user API
- **Existing Patterns:** Admin pages for hosting-plans, maintenance-plans, functions
- **Schema Changes Required:** No (User model exists)
- **New API Endpoints:** None (enhance existing)
- **Modified API Endpoints:** `/api/users` (add create, update, delete)
- **New Components:** UserManagementPage, UserForm
- **Modified Components:** None

#### Implementation Plan

**API Layer**
- [ ] Add POST to `/app/api/users/route.ts` (create user - admin only)
- [ ] Create `/app/api/users/[id]/route.ts` (GET, PATCH, DELETE - admin only)
- [ ] Add Zod validation schemas
- [ ] Password hashing for new users

**Frontend**
- [ ] Create `/app/(app)/admin/users/page.tsx` following hosting-plans pattern
- [ ] Create `/components/domain/admin/user-form.tsx`
- [ ] Add to admin navigation sidebar

**Verification**
- [ ] Admin can view all users
- [ ] Admin can create new user with role
- [ ] Admin can update user (name, email, role)
- [ ] Admin can deactivate user (is_active = false)
- [ ] Non-admin cannot access user management

---

### Feature 6: Battery Status on Dashboard
**Source:** Phase 5, FEATURE-AUDIT.md
**Status:** Not Started
**Blocked By:** None

#### Discovery Summary
- **Impacted Files:** TaskQuickList component
- **Existing Patterns:** `getBatteryImpactIcon()`, `getBatteryImpactVariant()` exist
- **Schema Changes Required:** No
- **New API Endpoints:** None (data already returned)
- **Modified API Endpoints:** None
- **New Components:** None
- **Modified Components:** TaskQuickList

#### Implementation Plan

**Frontend**
- [ ] Update `/components/domain/dashboard/task-quick-list.tsx`:
  - Add battery_impact display after priority
  - Use `getBatteryImpactIcon()` for emoji
  - Use Badge with `getBatteryImpactVariant()` for styling
  - Only show if battery_impact !== 'average_drain' (reduce noise)

**Verification**
- [ ] High drain tasks show warning indicator on dashboard
- [ ] Energizing tasks show success indicator
- [ ] Average drain tasks show no indicator (default)

---

### Feature 7: Milestone UI
**Source:** Phase 3, FEATURE-AUDIT.md
**Status:** Not Started
**Blocked By:** Toast Notifications

#### Discovery Summary
- **Impacted Files:** Project detail page, project API
- **Existing Patterns:** Milestone model exists, CRUD pattern from other entities
- **Schema Changes Required:** No (model exists)
- **New API Endpoints:** `/api/projects/[id]/milestones`
- **Modified API Endpoints:** None
- **New Components:** MilestoneList, MilestoneItem, MilestoneForm
- **Modified Components:** Project detail page (add Milestones tab)

#### Implementation Plan

**API Layer**
- [ ] Create `/app/api/projects/[id]/milestones/route.ts` (GET, POST)
- [ ] Create `/app/api/milestones/[id]/route.ts` (PATCH, DELETE)
- [ ] Add Zod validation schemas

**Frontend**
- [ ] Create `/lib/hooks/use-milestones.ts`
- [ ] Create `/components/domain/projects/milestone-item.tsx`
- [ ] Create `/components/domain/projects/milestone-list.tsx`
- [ ] Create `/components/domain/projects/milestone-form.tsx`
- [ ] Add Milestones tab to project detail page

**Verification**
- [ ] Can create milestone with name and target date
- [ ] Can mark milestone as complete
- [ ] Can edit milestone
- [ ] Can delete milestone
- [ ] Milestones display in chronological order

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

### Feature 9: Project Health UI
**Source:** Phase 5, FEATURE-AUDIT.md
**Status:** Not Started
**Blocked By:** None

#### Discovery Summary
- **Impacted Files:** Dashboard, project list, project detail
- **Existing Patterns:** `calculateProjectHealth()` exists in `/lib/calculations/project-health.ts`
- **Schema Changes Required:** No
- **New API Endpoints:** None (add to existing response)
- **Modified API Endpoints:** `/api/projects` (add health to response)
- **New Components:** ProjectHealthBadge, ProjectHealthCard
- **Modified Components:** Project list, PM dashboard

#### Implementation Plan

**API Layer**
- [ ] Update `/lib/api/formatters.ts` `formatProjectResponse()`:
  - Call `calculateProjectHealth()` with project data
  - Include health in response

**Frontend**
- [ ] Create `/components/domain/projects/project-health-badge.tsx`
- [ ] Update project list to show health indicator
- [ ] Add health summary to PM dashboard

**Verification**
- [ ] Health badge shows on project cards (green/amber/red)
- [ ] PM dashboard shows project health overview
- [ ] At-risk projects clearly visible

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

### Feature 13: Task Billing Fields
**Source:** Phase 3, remote-features-audit.md
**Status:** Not Started
**Blocked By:** None

*[Implementation details to be added when approaching this tier]*

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
