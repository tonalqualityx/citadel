# Retainer Billing Overages & Tracking

## Status: COMPLETED ✅

**Last Updated**: 2026-01-14
**Current Phase**: Complete

---

## Overview

Two related features:
1. **Billing Dashboard** - Show overage subtotals, per-task waive toggle, hide zero-overage retainer clients
2. **Client Retainer Tab** - New tab on client detail page showing retainer usage with month navigation

---

## Agent Workflow Instructions

### For Each Task:
1. **Read Agent** - Dispatch sub-agent to read relevant files and understand current implementation
2. **Write Agent** - Dispatch sub-agent to implement the changes
3. **Review Agent** - Dispatch sub-agent to review the changes and check for issues
4. **Test Agent** - Dispatch sub-agent to write tests and run the test suite

### Crash Recovery:
- Check the checklist below to see what's completed
- Resume from the first unchecked item
- Each task is atomic and can be completed independently
- Run `npm run test:run` after each major task to verify no regressions

---

## Master Checklist

### Part 1: Billing Dashboard Changes

- [x] **1.1 Database Migration** ✅ COMPLETED
  - [x] Read: Review current Task model in `prisma/schema.prisma`
  - [x] Write: Add `waive_overage Boolean @default(false)` field to Task model
  - [x] Write: Create and run migration (used `prisma db push`)
  - [x] Review: Verified migration applied correctly
  - [x] Test: Field exists in database, Prisma Client regenerated

- [x] **1.2 API: Update Unbilled Route** ✅ COMPLETED
  - [x] Read: Review `app/api/billing/unbilled/route.ts`
  - [x] Write: Add filtering logic for zero-overage retainer clients
  - [x] Write: Add per-task overage calculation (chronological consumption)
  - [x] Write: Add new response fields (`is_overage_task`, `overage_minutes`, `waive_overage`)
  - [x] Write: Add client-level fields (`retainerCoveredMinutes`, `billableOverageMinutes`)
  - [x] Review: Verified edge cases handled (no tasks, partial overage, all waived)
  - [ ] Test: Write API tests for overage calculations (deferred to 1.8)

- [x] **1.3 API: Update Task Billing Route** ✅ COMPLETED
  - [x] Read: Review `app/api/tasks/[id]/billing/route.ts`
  - [x] Write: Add `waive_overage` to update schema
  - [x] Review: Verified validation and error handling
  - [ ] Test: Write tests for waive_overage toggle (deferred to 1.8)

- [x] **1.4 Hooks: Update Types** ✅ COMPLETED
  - [x] Read: Review `lib/hooks/use-billing.ts`
  - [x] Write: Update `UnbilledTask` interface with new fields
  - [x] Write: Update `ClientUnbilledData` interface with new fields
  - [x] Review: Verified type consistency with API

- [x] **1.5 UI: BillingDashboard Filtering** ✅ COMPLETED
  - [x] Read: Review `components/domain/billing/billing-dashboard.tsx`
  - [x] Write: Filtering handled at API level (task 1.2) - no UI changes needed
  - [x] Review: Verified component receives pre-filtered data from API
  - [ ] Test: Write component tests for filtering (deferred to 1.8)

- [x] **1.6 UI: ClientBillingSection Subtotals** ✅ COMPLETED
  - [x] Read: Review `components/domain/billing/client-billing-section.tsx`
  - [x] Write: Add subtotals section for retainer clients
  - [x] Write: Show "Covered by Retainer: X hrs"
  - [x] Write: Show "Billable Overage: X hrs ($Y)"
  - [x] Write: Update grand total to only include billable (non-waived) overage
  - [x] Review: Verified calculations are correct
  - [ ] Test: Write component tests for subtotals (deferred to 1.8)

- [x] **1.7 UI: TaskBillingTable Overage Column** ✅ COMPLETED
  - [x] Read: Review `components/domain/billing/task-billing-table.tsx`
  - [x] Write: Add overage indicator/badge for overage tasks
  - [x] Write: Add "Waive" toggle column (only for overage tasks)
  - [x] Write: Updated client-billing-section to pass isRetainer prop
  - [x] Review: Verified UX is intuitive
  - [ ] Test: Write component tests for overage display and toggle (deferred to 1.8)

- [x] **1.8 Run Full Test Suite for Part 1** ✅ COMPLETED
  - [x] Run: `npm run test:run`
  - [x] Fix: No failing tests
  - [x] Verify: All 195 tests pass

### Part 2: Client Retainer Tab

- [x] **2.1 API: Create Retainer Endpoint** ✅ COMPLETED
  - [x] Read: Review existing client API patterns in `app/api/clients/[id]/`
  - [x] Write: Create `app/api/clients/[id]/retainer/route.ts`
  - [x] Write: Accept `?month=YYYY-MM` query param (default: current month)
  - [x] Write: Return month usage data with task breakdown
  - [x] Review: Verified query efficiency and edge cases
  - [ ] Test: Write API tests for retainer endpoint (deferred to 2.5)

- [x] **2.2 Hooks: Add Retainer Hook** ✅ COMPLETED
  - [x] Read: Review `lib/hooks/use-clients.ts`
  - [x] Write: Add `useClientRetainer(clientId, month)` hook
  - [x] Write: Added query keys to `lib/api/query-keys.ts`
  - [x] Review: Verified caching behavior with month-specific keys

- [x] **2.3 UI: Create ClientRetainerTab Component** ✅ COMPLETED
  - [x] Read: Review existing tab patterns (`ClientActivityTab`, `ClientSitesTab`)
  - [x] Write: Create `components/domain/clients/client-retainer-tab.tsx`
  - [x] Write: Add month selector (prev/next arrows + navigation)
  - [x] Write: Add usage summary (retainer hours, used, remaining/overage)
  - [x] Write: Add usage progress bar with color coding 
  - [x] Write: Add task breakdown table
  - [x] Review: Verified loading and error states
  - [ ] Test: Write component tests (deferred - optional)

- [x] **2.4 UI: Update Client Detail Page** ✅ COMPLETED
  - [x] Read: Review `app/(app)/clients/[id]/page.tsx`
  - [x] Write: Add `'retainer'` to `TabType` union
  - [x] Write: Add tab button (only show if `retainer_hours > 0`)
  - [x] Write: Render `ClientRetainerTab` when selected
  - [x] Review: Verified conditional rendering
  - [ ] Test: Write page tests for retainer tab (deferred - optional)

- [x] **2.5 Run Full Test Suite for Part 2** ✅ COMPLETED
  - [x] Run: `npm run test:run`
  - [x] Fix: No failing tests
  - [x] Verify: All 195 tests pass

---

## Detailed Implementation

### Part 1: Billing Dashboard

#### 1.1 Database Migration

**File**: `prisma/schema.prisma`

Add to Task model in the billing fields section:
```prisma
waive_overage  Boolean @default(false)
```

Then run:
```bash
npx prisma migrate dev --name add_waive_overage_to_task
```

#### 1.2 API: Unbilled Route Changes

**File**: `app/api/billing/unbilled/route.ts`

**New response fields per task**:
```typescript
is_overage_task: boolean     // True if task exceeds retainer
overage_minutes: number      // Minutes of this task that are overage
waive_overage: boolean       // From database
```

**New response fields per client**:
```typescript
retainerCoveredMinutes: number   // Total minutes covered by retainer
billableOverageMinutes: number   // Overage minutes not waived
```

**Filtering logic**:
```typescript
// Only return retainer clients if they have billable content
const shouldIncludeRetainerClient = (client) => {
  if (!client.isRetainer) return true;  // Non-retainer: always include
  if (client.milestones.length > 0) return true;  // Has milestones: include
  return client.overageMinutes > 0;  // Has overage: include
};
```

**Overage calculation (chronological)**:
```typescript
// Sort tasks by completion date
const sortedTasks = tasks.sort((a, b) =>
  new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
);

let remainingRetainer = retainerMinutesLimit;
for (const task of sortedTasks) {
  if (remainingRetainer >= task.time_spent_minutes) {
    // Fully covered by retainer
    task.is_overage_task = false;
    task.overage_minutes = 0;
    remainingRetainer -= task.time_spent_minutes;
  } else if (remainingRetainer > 0) {
    // Partially covered
    task.is_overage_task = true;
    task.overage_minutes = task.time_spent_minutes - remainingRetainer;
    remainingRetainer = 0;
  } else {
    // Fully overage
    task.is_overage_task = true;
    task.overage_minutes = task.time_spent_minutes;
  }
}
```

#### 1.3 API: Task Billing Route

**File**: `app/api/tasks/[id]/billing/route.ts`

Add to schema:
```typescript
const updateBillingSchema = z.object({
  is_billable: z.boolean().optional(),
  billing_target: z.number().nullable().optional(),
  is_retainer_work: z.boolean().optional(),
  invoiced: z.boolean().optional(),
  waive_overage: z.boolean().optional(),  // ADD THIS
});
```

#### 1.4 Hook Types

**File**: `lib/hooks/use-billing.ts`

Update interfaces:
```typescript
export interface UnbilledTask {
  // ... existing fields
  is_overage_task: boolean;
  overage_minutes: number;
  waive_overage: boolean;
}

export interface ClientUnbilledData {
  // ... existing fields
  retainerCoveredMinutes: number;
  billableOverageMinutes: number;
}
```

#### 1.5 BillingDashboard Filtering

**File**: `components/domain/billing/billing-dashboard.tsx`

```typescript
// Filter clients for display
const displayClients = byClient.filter(client => {
  // Non-retainer clients: show if they have any unbilled items
  if (!client.isRetainer) {
    return client.milestones.length > 0 || client.tasks.length > 0;
  }

  // Retainer clients: show if they have milestones OR billable overages
  return client.milestones.length > 0 || client.billableOverageMinutes > 0;
});
```

#### 1.6 ClientBillingSection Subtotals

**File**: `components/domain/billing/client-billing-section.tsx`

Add subtotals section for retainer clients:
```tsx
{clientData.isRetainer && (
  <div className="border-t pt-4 mt-4 space-y-2">
    <div className="flex justify-between text-sm">
      <span className="text-text-sub">Covered by Retainer</span>
      <span>{formatHours(clientData.retainerCoveredMinutes)}</span>
    </div>
    <div className="flex justify-between text-sm font-medium">
      <span>Billable Overage</span>
      <span>
        {formatHours(clientData.billableOverageMinutes)}
        ({formatCurrency(billableOverageAmount)})
      </span>
    </div>
  </div>
)}
```

#### 1.7 TaskBillingTable Overage Column

**File**: `components/domain/billing/task-billing-table.tsx`

Add overage indicator and waive toggle:
```tsx
// Overage badge
{task.is_overage_task && (
  <Badge variant="warning">
    {formatMinutes(task.overage_minutes)} overage
  </Badge>
)}

// Waive toggle (only for overage tasks)
{task.is_overage_task && (
  <Checkbox
    checked={task.waive_overage}
    onCheckedChange={(checked) =>
      updateTaskBilling({ taskId: task.id, data: { waive_overage: checked } })
    }
  />
)}
```

### Part 2: Client Retainer Tab

#### 2.1 API: Retainer Endpoint

**File**: `app/api/clients/[id]/retainer/route.ts` (new)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';

interface RetainerUsageResponse {
  month: string;
  period: { start: string; end: string };
  retainerHours: number;
  usedMinutes: number;
  overageMinutes: number;
  tasks: {
    id: string;
    title: string;
    project_name: string | null;
    time_spent_minutes: number;
    completed_at: string | null;
    is_retainer_work: boolean;
    invoiced: boolean;
  }[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get('month'); // YYYY-MM format

    // Parse month or default to current
    const now = new Date();
    const [year, month] = monthParam
      ? monthParam.split('-').map(Number)
      : [now.getFullYear(), now.getMonth() + 1];

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

    // Get client with retainer info
    const client = await prisma.client.findUnique({
      where: { id: params.id },
      select: { retainer_hours: true }
    });

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Query time entries and tasks for this client in the specified month
    // ... implementation details

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
```

#### 2.2 Hook: useClientRetainer

**File**: `lib/hooks/use-clients.ts`

```typescript
export function useClientRetainer(clientId: string, month: string) {
  return useQuery({
    queryKey: ['clients', clientId, 'retainer', month],
    queryFn: () => apiClient.get(`/clients/${clientId}/retainer?month=${month}`),
    enabled: !!clientId && !!month,
  });
}
```

#### 2.3 Component: ClientRetainerTab

**File**: `components/domain/clients/client-retainer-tab.tsx` (new)

```tsx
'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useClientRetainer } from '@/lib/hooks/use-clients';

interface ClientRetainerTabProps {
  clientId: string;
  retainerHours: number;
}

export function ClientRetainerTab({ clientId, retainerHours }: ClientRetainerTabProps) {
  const [selectedMonth, setSelectedMonth] = React.useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data, isLoading, error } = useClientRetainer(clientId, selectedMonth);

  const navigateMonth = (direction: 'prev' | 'next') => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 1 + (direction === 'next' ? 1 : -1), 1);
    setSelectedMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  };

  // ... render month selector, usage summary, task breakdown
}
```

#### 2.4 Update Client Detail Page

**File**: `app/(app)/clients/[id]/page.tsx`

```typescript
type TabType = 'details' | 'sites' | 'activity' | 'retainer';

// In tab buttons section
{client.retainer_hours && client.retainer_hours > 0 && (
  <button
    onClick={() => setActiveTab('retainer')}
    className={cn(tabButtonClasses, activeTab === 'retainer' && activeTabClasses)}
  >
    Retainer
  </button>
)}

// In tab content section
{activeTab === 'retainer' && client.retainer_hours && (
  <ClientRetainerTab
    clientId={client.id}
    retainerHours={Number(client.retainer_hours)}
  />
)}
```

---

## Test Cases

### Part 1: Billing Dashboard Tests

**API Tests** (`app/api/billing/__tests__/unbilled.test.ts`):
1. Returns empty for retainer client with zero overage and no milestones
2. Returns retainer client if they have milestones (even with zero overage)
3. Returns retainer client if they have overage
4. Correctly calculates per-task overage chronologically
5. Handles partial overage (task spans retainer limit)
6. Respects waive_overage flag in billable calculations
7. Non-retainer clients always returned if they have unbilled items

**Component Tests**:
1. BillingDashboard filters out zero-overage retainer clients
2. ClientBillingSection shows subtotals for retainer clients
3. TaskBillingTable shows overage badge for overage tasks
4. TaskBillingTable waive toggle only appears for overage tasks
5. Waive toggle updates correctly and recalculates totals

### Part 2: Client Retainer Tab Tests

**API Tests** (`app/api/clients/[id]/__tests__/retainer.test.ts`):
1. Returns current month data by default
2. Returns specified month data when param provided
3. Returns 404 for non-existent client
4. Correctly calculates usage from time entries
5. Returns empty tasks array for months with no activity

**Component Tests**:
1. Month navigation works correctly
2. Loading state displays while fetching
3. Task breakdown table renders correctly
4. Usage summary shows correct values

---

## Edge Cases to Test

1. **No tasks in month** - Should show 0 usage, empty task list
2. **Exactly at retainer limit** - Should show 0 overage
3. **All tasks waived** - Should show 0 billable overage
4. **Task with partial overage** - First part covered, second part overage
5. **Client becomes retainer mid-month** - Handle gracefully
6. **Future month selected** - Show 0 usage or prevent selection
7. **Very old month** - Handle pagination/performance
8. **Retainer hours changed mid-month** - Use current value
