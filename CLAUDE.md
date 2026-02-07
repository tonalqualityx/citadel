# Indelible Development Guidelines

This document contains development rules and patterns for the Indelible codebase. **Read this before implementing features.**

## Detailed Guides

| When you're... | Read |
|----------------|------|
| Adding/modifying API endpoints | [`instructions/api-routes.md`](instructions/api-routes.md) |
| Building UI or using components | [`instructions/component-library.md`](instructions/component-library.md) |
| Working with tasks, estimates, or budgets | [`instructions/task-estimation.md`](instructions/task-estimation.md) |

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

## 1. Component Library & UI

**ALWAYS use components from `/components/ui/` — NEVER use raw Tailwind for styling that components already handle.** Use CSS variable-based classes (`bg-surface`, `text-text-main`, `border-border`) instead of raw colors.

Full reference: [`instructions/component-library.md`](instructions/component-library.md)

---

## 2. Task Estimation & Battery Impact

**Task time estimates ALWAYS show a RANGE.** Use `rangedEstimateColumn()`. Battery impact (`average_drain`, `high_drain`, `energizing`) is REQUIRED on task forms. Project budgets are calculated from task estimates, not manually entered.

Full reference: [`instructions/task-estimation.md`](instructions/task-estimation.md)

---

## 3. API Routes & Registry

**Update the registry whenever you add/modify/remove endpoints.** Use `requireAuth()`, Zod validation, `handleApiError()`. The registry is split into domain files under `lib/api/registry/`. Response shapes use type-hint conventions (`'uuid'`, `'string|null'`, etc.).

Full reference: [`instructions/api-routes.md`](instructions/api-routes.md)

---

## 4. Toast Notifications

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

## 5. Terminology System

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

## 6. Activity Logging

Log significant actions using `/lib/services/activity.ts`:

```typescript
import { logCreate, logUpdate, logDelete, logStatusChange } from '@/lib/services/activity';

// After creating
await logCreate(userId, 'task', taskId, taskTitle);

// After status change
await logStatusChange(userId, 'task', taskId, oldStatus, newStatus);
```

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
| API Route Registry | `/lib/api/registry/` (domain files) |
| Database | `/prisma/schema.prisma` |
