# Sales Pipeline - Test Baseline

**Date:** 2026-03-18
**Branch:** `feature/sales-pipeline`
**Purpose:** Pre-implementation test baseline to track regressions

---

## Test Suite Results

**All tests passing. Zero failures.**

| Metric | Value |
|--------|-------|
| Test Files | 34 passed (34 total) |
| Tests | 510 passed (510 total) |
| Failed | 0 |
| Duration | ~3.2s |

---

## Test File Inventory

34 test files (excluding `node_modules`), plus 2 e2e spec files:

### API Route Tests
| File | Path |
|------|------|
| API Keys (CRUD) | `app/api/api-keys/__tests__/route.test.ts` |
| API Keys (by ID) | `app/api/api-keys/[id]/__tests__/route.test.ts` |
| Clients | `app/api/clients/__tests__/route.test.ts` |
| Docs | `app/api/docs/__tests__/route.test.ts` |
| Projects (by ID) | `app/api/projects/[id]/__tests__/route.test.ts` |
| Project Team | `app/api/projects/[id]/team/__tests__/route.test.ts` |
| SOPs | `app/api/sops/__tests__/route.test.ts` |
| Tasks | `app/api/tasks/__tests__/route.test.ts` |
| Tasks (by ID, deps) | `app/api/tasks/[id]/__tests__/dependency-propagation.test.ts` |
| Tasks (bulk) | `app/api/tasks/bulk/__tests__/route.test.ts` |
| Users (by ID) | `app/api/users/[id]/__tests__/route.test.ts` |
| User Functions | `app/api/users/[id]/functions/__tests__/route.test.ts` |
| Notification Prefs | `app/api/users/me/notification-preferences/__tests__/route.test.ts` |

### Page Tests
| File | Path |
|------|------|
| Billing | `app/(app)/billing/__tests__/page.test.tsx` |
| Clients | `app/(app)/clients/__tests__/page.test.tsx` |
| Sites | `app/(app)/sites/__tests__/page.test.tsx` |
| Project Detail | `app/(app)/projects/[id]/__tests__/page.test.tsx` |

### Component Tests
| File | Path |
|------|------|
| Project Brief Tab | `components/domain/projects/__tests__/project-brief-tab.test.tsx` |
| SOP Form | `components/domain/sops/__tests__/sop-form.test.tsx` |
| Rich Text Renderer | `components/ui/__tests__/rich-text-renderer.test.tsx` |
| Task List Columns | `components/ui/__tests__/task-list-columns.test.tsx` |
| Quick Task Modal | `components/layout/__tests__/quick-task-modal.test.tsx` |

### Library Tests
| File | Path |
|------|------|
| Check-in Utils | `lib/api/check-in/__tests__/utils.test.ts` |
| API Registry | `lib/api/registry/__tests__/registry.test.ts` |
| Auth Middleware | `lib/auth/__tests__/middleware.test.ts` |
| API Keys Auth | `lib/auth/__tests__/api-keys.test.ts` |
| Billing Calc | `lib/calculations/__tests__/billing.test.ts` |
| Energy Calc | `lib/calculations/__tests__/energy.test.ts` |
| Dashboard Hook | `lib/hooks/__tests__/use-dashboard.test.ts` |
| Milestones Hook | `lib/hooks/__tests__/use-milestones.test.ts` |
| Notification Dispatch | `lib/services/__tests__/notification-dispatcher.test.ts` |
| Notification Prefs | `lib/services/__tests__/notification-preferences.test.ts` |
| Time Utils | `lib/utils/__tests__/time.test.ts` |
| URL Utils | `lib/utils/__tests__/url.test.ts` |

### E2E Spec Files (not run in unit suite)
- `__tests__/e2e/search.spec.ts`
- `__tests__/e2e/auth.spec.ts`

---

## Tests Referencing Changed Terminology

### "pact" / "Pact"
**No test files reference "pact" or "Pact".** No impact expected.

### "retainer" References (HIGH RELEVANCE)

These test files contain `retainer` references that may need updates if the data model changes retainer fields:

| File | References | Details |
|------|-----------|---------|
| `app/api/clients/__tests__/route.test.ts` | `retainer_hours` | Tests null/zero/positive/negative validation for `retainer_hours` field |
| `app/api/tasks/__tests__/route.test.ts` | `is_retainer_work`, `is_retainer`, `retainer_hours` | Tests retainer work auto-marking, project retainer status |
| `app/api/projects/[id]/__tests__/route.test.ts` | `is_retainer` | Mock project data includes `is_retainer: false` |
| `app/(app)/projects/[id]/__tests__/page.test.tsx` | `is_retainer` | Mock project includes `is_retainer: false` |
| `lib/hooks/__tests__/use-dashboard.test.ts` | `retainerAlerts` | Tests dashboard hook with `retainerAlerts: []` |
| `components/layout/__tests__/quick-task-modal.test.tsx` | `useClientRetainer` | Mocks the `useClientRetainer` hook |

### "project_type" / "projectType" / "billing_type"
- `app/api/projects/[id]/__tests__/route.test.ts` has `billing_type: null` in mock data
- No test files reference `project_type` or `projectType`

### Project Status / Phase References
| File | Details |
|------|---------|
| `lib/api/check-in/__tests__/utils.test.ts` | Tests `isFromActiveProject()` with statuses: `in_progress`, `ready`, `done`, `suspended` |
| `app/api/projects/[id]/__tests__/route.test.ts` | Mocks `canTransitionProjectStatus` |
| `app/(app)/projects/[id]/__tests__/page.test.tsx` | Mocks `useUpdateProjectStatus`, phase CRUD hooks, `ProjectStatusInlineSelect` |

### Budget / Billing Logic Tests
| File | Details |
|------|---------|
| `lib/calculations/__tests__/billing.test.ts` | Tests `calculateBillingEstimates()` with rate/hours/battery_impact |
| `app/api/projects/[id]/__tests__/route.test.ts` | Tests `budget_hours`, `budget_amount`, `budget_locked` fields |
| `app/(app)/projects/[id]/__tests__/page.test.tsx` | Mocks `useLockProjectBudget`, includes budget fields in mock data |
| `app/api/tasks/__tests__/route.test.ts` | Tests `billing_amount`, `billing_target` fields on tasks |
| `lib/hooks/__tests__/use-milestones.test.ts` | Tests `billing_amount`, `billing_status` on milestones |
| `components/layout/__tests__/quick-task-modal.test.tsx` | Tests billing section visibility for PM users |
| `app/(app)/billing/__tests__/page.test.tsx` | Tests BillingDashboard rendering by role |

---

## Pre-existing Issues

**None.** All 510 tests pass across all 34 test files.

### Warnings (non-blocking, pre-existing)
- **Missing `Description` for DialogContent** - Multiple warnings in `quick-task-modal.test.tsx` and `page.test.tsx` (sites). These are accessibility warnings, not failures.
- **React `act()` warning** - One instance in `quick-task-modal.test.tsx` for a state update not wrapped in `act()`. Non-blocking.

---

## TypeScript Compilation Status

**Clean. Zero errors.** `npx tsc --noEmit` completed with no output (success).

---

## Test Patterns & Tools

| Tool | Usage |
|------|-------|
| Framework | Vitest v4.0.16 |
| Environment | jsdom |
| UI Testing | @testing-library/react, @testing-library/jest-dom |
| Mocking | `vi.mock()`, `vi.fn()` (Vitest built-in) |
| Config | `vitest.config.ts` with `vitest.setup.ts` |
| Convention | `__tests__/` directories colocated with source |
| E2E | Playwright (`.spec.ts` files, excluded from unit suite) |

---

## Summary for Implementation

| Category | Status |
|----------|--------|
| Test suite | All 510 tests passing |
| TypeScript | Clean compilation |
| Retainer-related tests | **6 files need attention** if retainer model changes |
| Budget/billing tests | **7 files** reference budget or billing fields |
| Project status tests | **3 files** reference status transitions or phase logic |
| Pact-related tests | None (safe) |
| Pre-existing failures | None |

**Key risk areas:**
1. **Retainer model changes** -- `clients/route.test.ts` and `tasks/route.test.ts` test `retainer_hours`, `is_retainer`, `is_retainer_work` validation extensively. These must be updated if the Charter system replaces retainers.
2. **Project status changes** -- `check-in/utils.test.ts` tests `isFromActiveProject()` against specific status strings (`in_progress`, `ready`, `done`, `suspended`). If new pipeline stages are added, these assertions need review.
3. **Budget/billing fields** -- `projects/[id]/route.test.ts` tests `budget_hours`, `budget_locked` updates. If budget calculation logic changes with Commissions replacing Pacts, these tests need updating.
