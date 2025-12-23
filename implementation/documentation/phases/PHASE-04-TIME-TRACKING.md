# Phase 4: Time Tracking
## Detailed Implementation Guide for Claude Code

**Phase:** 4 of 10  
**Estimated Duration:** 2-3 days  
**Prerequisites:** Phase 3 complete (Projects and Tasks working)

---

## ðŸŽ¯ Phase Goal

Build the time tracking system with a global timer and manual time entry. By the end of this phase:
- Global timer widget in header starts/stops time tracking
- Timer persists across navigation (context-based)
- Stopping timer creates a time entry associated with a task
- Users can manually add time entries
- Time entries appear on task detail and project detail
- Daily/weekly time view in Chronicles section

---

## ðŸ“š Required Reading

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-api-endpoint-inventory.md` | Time entries endpoints |
| `indelible-data-model-refinement.md` | Time entries table |
| `indelible-wireframes-global-shell.md` | Timer widget design |
| `indelible-user-flows.md` | Time tracking flow |
| `indelible-state-management-plan.md` | Timer state management |

---

## ðŸ“‹ Phase Checklist

### 4.1 Extend Prisma Schema

#### 4.1.1 Add Time Entry Model

```prisma
// ============================================
// TIME ENTRIES
// ============================================

model TimeEntry {
  id            String    @id @default(uuid()) @db.Uuid
  
  // What was worked on
  task_id       String?   @db.Uuid
  task          Task?     @relation(fields: [task_id], references: [id])
  project_id    String?   @db.Uuid
  project       Project?  @relation(fields: [project_id], references: [id])
  
  // Who
  user_id       String    @db.Uuid
  user          User      @relation(fields: [user_id], references: [id])
  
  // When
  started_at    DateTime
  ended_at      DateTime?
  duration      Int       // Duration in minutes
  
  // Billing
  is_billable   Boolean   @default(true)
  hourly_rate   Decimal?  @db.Decimal(10, 2)
  
  // Notes
  description   String?   @db.VarChar(500)
  
  // Timer tracking
  is_running    Boolean   @default(false)
  
  // Metadata
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt
  
  @@index([user_id])
  @@index([task_id])
  @@index([project_id])
  @@index([started_at])
  @@index([is_running])
  @@map("time_entries")
}
```

- [ ] Run migration: `npx prisma migrate dev --name add-time-entries`
- [ ] Generate client: `npx prisma generate`

---

### 4.2 Timer State Management

#### 4.2.1 Create Timer Context
**Create `/lib/contexts/TimerContext.tsx`:**

```tsx
'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiClient } from '@/lib/api/client';

interface TimerState {
  isRunning: boolean;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  startedAt: Date | null;
  elapsedSeconds: number;
  timeEntryId: string | null;
}

interface TimerContextValue extends TimerState {
  startTimer: (taskId: string, taskTitle: string, projectId?: string | null) => Promise<void>;
  stopTimer: () => Promise<void>;
  cancelTimer: () => void;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export function TimerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TimerState>({
    isRunning: false,
    taskId: null,
    taskTitle: null,
    projectId: null,
    startedAt: null,
    elapsedSeconds: 0,
    timeEntryId: null,
  });

  // Load active timer on mount
  useEffect(() => {
    async function loadActiveTimer() {
      try {
        const response = await apiClient.get<{ timer: any }>('/time-entries/active');
        if (response.timer) {
          const startedAt = new Date(response.timer.started_at);
          const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000);
          setState({
            isRunning: true,
            taskId: response.timer.task_id,
            taskTitle: response.timer.task?.title || 'Untitled Task',
            projectId: response.timer.project_id,
            startedAt,
            elapsedSeconds: elapsed,
            timeEntryId: response.timer.id,
          });
        }
      } catch (error) {
        console.error('Failed to load active timer:', error);
      }
    }
    loadActiveTimer();
  }, []);

  // Update elapsed time every second
  useEffect(() => {
    if (!state.isRunning || !state.startedAt) return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.startedAt!.getTime()) / 1000);
      setState((prev) => ({ ...prev, elapsedSeconds: elapsed }));
    }, 1000);

    return () => clearInterval(interval);
  }, [state.isRunning, state.startedAt]);

  const startTimer = useCallback(async (taskId: string, taskTitle: string, projectId?: string | null) => {
    // Stop any existing timer first
    if (state.isRunning && state.timeEntryId) {
      await stopTimer();
    }

    const response = await apiClient.post<{ timer: any }>('/time-entries/start', {
      task_id: taskId,
      project_id: projectId,
    });

    setState({
      isRunning: true,
      taskId,
      taskTitle,
      projectId: projectId || null,
      startedAt: new Date(response.timer.started_at),
      elapsedSeconds: 0,
      timeEntryId: response.timer.id,
    });
  }, [state.isRunning, state.timeEntryId]);

  const stopTimer = useCallback(async () => {
    if (!state.timeEntryId) return;

    await apiClient.post(`/time-entries/${state.timeEntryId}/stop`);

    setState({
      isRunning: false,
      taskId: null,
      taskTitle: null,
      projectId: null,
      startedAt: null,
      elapsedSeconds: 0,
      timeEntryId: null,
    });
  }, [state.timeEntryId]);

  const cancelTimer = useCallback(async () => {
    if (state.timeEntryId) {
      await apiClient.delete(`/time-entries/${state.timeEntryId}`);
    }
    setState({
      isRunning: false,
      taskId: null,
      taskTitle: null,
      projectId: null,
      startedAt: null,
      elapsedSeconds: 0,
      timeEntryId: null,
    });
  }, [state.timeEntryId]);

  return (
    <TimerContext.Provider value={{ ...state, startTimer, stopTimer, cancelTimer }}>
      {children}
    </TimerContext.Provider>
  );
}

export function useTimer() {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimer must be used within TimerProvider');
  }
  return context;
}
```

#### 4.2.2 Create Timer Utilities
**Create `/lib/utils/time.ts`:**

```typescript
export function formatElapsedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

export function minutesToDecimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function secondsToMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}
```

---

### 4.3 Time Entry API Endpoints

#### 4.3.1 Implement Endpoints
- [ ] `GET /api/time-entries` â€” List with filters (user, task, project, date range)
- [ ] `GET /api/time-entries/active` â€” Get current running timer for user
- [ ] `GET /api/time-entries/:id` â€” Detail
- [ ] `POST /api/time-entries` â€” Create manual entry
- [ ] `POST /api/time-entries/start` â€” Start timer (creates running entry)
- [ ] `POST /api/time-entries/:id/stop` â€” Stop timer (sets duration, ended_at)
- [ ] `PATCH /api/time-entries/:id` â€” Update entry
- [ ] `DELETE /api/time-entries/:id` â€” Delete entry

**Create `/app/api/time-entries/start/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const startTimerSchema = z.object({
  task_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const body = await request.json();
    const { task_id, project_id } = startTimerSchema.parse(body);

    // Stop any existing running timer for this user
    await prisma.timeEntry.updateMany({
      where: {
        user_id: auth.userId,
        is_running: true,
      },
      data: {
        is_running: false,
        ended_at: new Date(),
        // Duration will need to be calculated
      },
    });

    // Get task for project_id if not provided
    let resolvedProjectId = project_id;
    if (!resolvedProjectId) {
      const task = await prisma.task.findUnique({
        where: { id: task_id },
        select: { project_id: true },
      });
      resolvedProjectId = task?.project_id ?? undefined;
    }

    // Create new running timer
    const timer = await prisma.timeEntry.create({
      data: {
        task_id,
        project_id: resolvedProjectId,
        user_id: auth.userId,
        started_at: new Date(),
        is_running: true,
        duration: 0,
      },
      include: {
        task: { select: { id: true, title: true } },
      },
    });

    // Also update task status to in_progress if not already
    await prisma.task.updateMany({
      where: {
        id: task_id,
        status: 'not_started',
      },
      data: {
        status: 'in_progress',
        started_at: new Date(),
      },
    });

    return NextResponse.json({ timer });
  } catch (error) {
    return handleApiError(error);
  }
}
```

**Create `/app/api/time-entries/[id]/stop/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);

    const entry = await prisma.timeEntry.findUnique({
      where: { id: params.id },
    });

    if (!entry) {
      throw new ApiError('Time entry not found', 404);
    }

    if (entry.user_id !== auth.userId) {
      throw new ApiError('Not authorized', 403);
    }

    if (!entry.is_running) {
      throw new ApiError('Timer is not running', 400);
    }

    const endedAt = new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - entry.started_at.getTime()) / 1000
    );
    const durationMinutes = Math.ceil(durationSeconds / 60);

    const updatedEntry = await prisma.timeEntry.update({
      where: { id: params.id },
      data: {
        is_running: false,
        ended_at: endedAt,
        duration: durationMinutes,
      },
      include: {
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ entry: updatedEntry });
  } catch (error) {
    return handleApiError(error);
  }
}
```

---

### 4.4 Timer Widget

#### 4.4.1 Create Timer Widget Component
**Create `/components/layout/TimerWidget.tsx`:**

```tsx
'use client';

import { useTimer } from '@/lib/contexts/TimerContext';
import { formatElapsedTime } from '@/lib/utils/time';
import { Play, Square, X } from 'lucide-react';

export function TimerWidget() {
  const { isRunning, taskTitle, elapsedSeconds, stopTimer, cancelTimer } = useTimer();

  if (!isRunning) {
    return (
      <div className="hidden lg:flex items-center text-sm text-stone-400">
        <Play className="h-4 w-4 mr-1" />
        No timer running
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-md">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
        </span>
        <span className="text-sm font-mono text-amber-700">
          {formatElapsedTime(elapsedSeconds)}
        </span>
      </div>
      
      <span className="text-sm text-amber-800 max-w-[200px] truncate">
        {taskTitle}
      </span>

      <div className="flex items-center gap-1">
        <button
          onClick={stopTimer}
          className="p-1 text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded"
          title="Stop timer"
        >
          <Square className="h-4 w-4" />
        </button>
        <button
          onClick={cancelTimer}
          className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded"
          title="Cancel timer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

#### 4.4.2 Add Start Timer Button to Tasks
- [ ] Add "Start Timer" button to TaskCard
- [ ] Add "Start Timer" button to TaskDetail
- [ ] Button shows elapsed time if timer is running for that task

---

### 4.5 Time Entry UI Components

#### 4.5.1 Manual Time Entry Modal
**Create `/components/domain/time/TimeEntryFormModal.tsx`:**
- [ ] Task selector (required)
- [ ] Date picker
- [ ] Duration input (hours:minutes)
- [ ] Billable toggle
- [ ] Description field
- [ ] Validation

#### 4.5.2 Time Entry List
**Create `/components/domain/time/TimeEntryList.tsx`:**
- [ ] Group by date
- [ ] Show task, duration, description
- [ ] Edit/delete actions

#### 4.5.3 Time Entry Row
**Create `/components/domain/time/TimeEntryRow.tsx`:**
- [ ] Compact row display
- [ ] Inline edit capability

---

### 4.6 Chronicles Section

#### 4.6.1 Daily Time View
**Create `/app/(app)/chronicles/page.tsx`:**
- [ ] Today's entries by default
- [ ] Date picker to change view
- [ ] Weekly summary stats
- [ ] Total hours display

#### 4.6.2 Weekly Time View
- [ ] Week selector
- [ ] Day-by-day breakdown
- [ ] Total hours per day

---

### 4.7 Time on Task/Project Detail

#### 4.7.1 Task Time Tab/Section
- [ ] List time entries for task
- [ ] Total time display
- [ ] Add entry button

#### 4.7.2 Project Time Tab
- [ ] List time entries for project
- [ ] Group by task or user
- [ ] Totals summary

---

## ðŸ§ª Testing Requirements

### Unit Tests
- [ ] `/__tests__/unit/utils/time.test.ts` â€” Time formatting functions

### Integration Tests
- [ ] `/__tests__/integration/api/time-entries.test.ts`
  - Start timer
  - Stop timer
  - Manual entry creation
  - Duration calculation
  - User authorization

---

## âœ… Phase 4 Acceptance Criteria

### Functionality
- [ ] Timer can be started from any task
- [ ] Timer persists across page navigation
- [ ] Timer shows in header with elapsed time
- [ ] Stopping timer creates time entry
- [ ] Timer correctly calculates duration
- [ ] Can add manual time entries
- [ ] Time entries appear on task detail
- [ ] Time entries appear on project detail
- [ ] Chronicles shows daily/weekly view
- [ ] Only owner can edit/delete their entries

### Code Quality
- [ ] Timer state in React Context
- [ ] Time utilities in `/lib/utils/time.ts`
- [ ] Optimistic updates where appropriate

### Tests
- [ ] Time formatting tests pass
- [ ] API integration tests pass

---

## ðŸ”œ Next Phase

After completing Phase 4, proceed to **Phase 5: Dashboards**.

Phase 5 will build:
- Tech Overlook (My Quests, Active Timer)
- PM Overlook (Focus Quests, Awaiting Review)
- Admin Overlook (All projects, Team utilization)

---

*Phase 4 Document â€” Last Updated: December 2025*