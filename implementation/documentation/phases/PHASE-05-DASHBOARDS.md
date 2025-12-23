# Phase 5: Dashboards
## Detailed Implementation Guide for Claude Code

**Phase:** 5 of 10  
**Estimated Duration:** 2-3 days  
**Prerequisites:** Phase 4 complete (Time Tracking working)

---

## ðŸŽ¯ Phase Goal

Build role-specific dashboards (Overlooks) that provide each user type with the information they need. By the end of this phase:
- Tech users see their assigned tasks, active timer, and recent time entries
- PM users see focus tasks, awaiting review, unassigned tasks, and retainer alerts
- Admin users see all PM features plus system-wide views
- Each dashboard queries data efficiently with role-based filtering

---

## ðŸ“š Required Reading

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-wireframes-dashboards.md` | Layout for all three dashboards |
| `indelible-app-architecture.md` | Role definitions |
| `indelible-user-flows.md` | Dashboard interaction patterns |

---

## ðŸ“‹ Phase Checklist

### 5.1 Dashboard API Endpoints

#### 5.1.1 Create Dashboard Data Endpoint
**Create `/app/api/dashboard/route.ts`:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const role = auth.role;

    // Base data all roles need
    const baseData = await getBaseData(auth.userId);

    if (role === 'tech') {
      return NextResponse.json({
        ...baseData,
        ...(await getTechDashboard(auth.userId)),
      });
    }

    if (role === 'pm') {
      return NextResponse.json({
        ...baseData,
        ...(await getPmDashboard(auth.userId)),
      });
    }

    if (role === 'admin') {
      return NextResponse.json({
        ...baseData,
        ...(await getAdminDashboard(auth.userId)),
      });
    }

    return NextResponse.json(baseData);
  } catch (error) {
    return handleApiError(error);
  }
}

async function getBaseData(userId: string) {
  const [activeTimer, recentTimeEntries] = await Promise.all([
    prisma.timeEntry.findFirst({
      where: { user_id: userId, is_running: true },
      include: { task: { select: { id: true, title: true } } },
    }),
    prisma.timeEntry.findMany({
      where: { user_id: userId },
      orderBy: { started_at: 'desc' },
      take: 5,
      include: {
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
    }),
  ]);

  return { activeTimer, recentTimeEntries };
}

async function getTechDashboard(userId: string) {
  const visibleStatuses = ['ready', 'in_progress', 'review', 'done'];

  // My tasks from visible projects + ad-hoc tasks
  const myTasks = await prisma.task.findMany({
    where: {
      assignee_id: userId,
      is_deleted: false,
      OR: [
        { project_id: null },
        { project: { status: { in: visibleStatuses } } },
      ],
      status: { notIn: ['done', 'abandoned'] },
    },
    include: {
      project: { select: { id: true, name: true, status: true } },
    },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    take: 20,
  });

  // Upcoming tasks (by due date)
  const upcomingTasks = myTasks
    .filter((t) => t.due_date)
    .sort((a, b) => a.due_date!.getTime() - b.due_date!.getTime())
    .slice(0, 5);

  // Blocked tasks
  const blockedTasks = myTasks.filter((t) => t.status === 'blocked');

  // Time this week
  const weekStart = getStartOfWeek();
  const timeThisWeek = await prisma.timeEntry.aggregate({
    where: {
      user_id: userId,
      started_at: { gte: weekStart },
    },
    _sum: { duration: true },
  });

  return {
    myTasks,
    upcomingTasks,
    blockedTasks,
    timeThisWeekMinutes: timeThisWeek._sum.duration || 0,
  };
}

async function getPmDashboard(userId: string) {
  // Focus tasks (high priority, in progress)
  const focusTasks = await prisma.task.findMany({
    where: {
      is_deleted: false,
      status: 'in_progress',
      priority: { lte: 2 },
      project: { status: { in: ['ready', 'in_progress'] } },
    },
    include: {
      assignee: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
    take: 10,
  });

  // Awaiting review
  const awaitingReview = await prisma.task.findMany({
    where: {
      is_deleted: false,
      status: 'review',
    },
    include: {
      assignee: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: { updated_at: 'asc' },
    take: 10,
  });

  // Unassigned tasks in active projects
  const unassignedTasks = await prisma.task.findMany({
    where: {
      is_deleted: false,
      assignee_id: null,
      project: { status: { in: ['ready', 'in_progress'] } },
    },
    include: {
      project: { select: { id: true, name: true } },
    },
    take: 10,
  });

  // My projects
  const myProjects = await prisma.project.findMany({
    where: {
      is_deleted: false,
      status: { in: ['ready', 'in_progress', 'review'] },
      team_assignments: { some: { user_id: userId } },
    },
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
    },
    take: 10,
  });

  // Retainer alerts (clients near limit)
  const retainerAlerts = await getRetainerAlerts();

  // Recent activity
  const recentActivity = await getRecentActivity();

  return {
    focusTasks,
    awaitingReview,
    unassignedTasks,
    myProjects,
    retainerAlerts,
    recentActivity,
  };
}

async function getAdminDashboard(userId: string) {
  // Get all PM dashboard data
  const pmData = await getPmDashboard(userId);

  // All active projects
  const allActiveProjects = await prisma.project.findMany({
    where: {
      is_deleted: false,
      status: { in: ['ready', 'in_progress', 'review'] },
    },
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: { updated_at: 'desc' },
  });

  // Team utilization (placeholder)
  const teamUtilization = await getTeamUtilization();

  // System alerts
  const systemAlerts = await getSystemAlerts();

  return {
    ...pmData,
    allActiveProjects,
    teamUtilization,
    systemAlerts,
  };
}

// Helper functions
function getStartOfWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

async function getRetainerAlerts() {
  // Find clients with retainer hours where usage is > 80%
  // Implementation depends on your retainer tracking
  return [];
}

async function getRecentActivity() {
  // Recent task completions, project updates, etc.
  return [];
}

async function getTeamUtilization() {
  // Placeholder for team utilization metrics
  return [];
}

async function getSystemAlerts() {
  // Placeholder for system alerts
  return [];
}
```

#### 5.1.2 Create Dashboard Hook
**Create `/lib/hooks/useDashboard.ts`:**

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.get('/dashboard'),
    refetchInterval: 60000, // Refresh every minute
  });
}
```

---

### 5.2 Tech Overlook

#### 5.2.1 Tech Dashboard Page
**Create `/app/(app)/overlook/page.tsx`:**

```tsx
'use client';

import { useDashboard } from '@/lib/hooks/useDashboard';
import { useAuth } from '@/lib/hooks/useAuth';
import { TechOverlook } from '@/components/domain/dashboard/TechOverlook';
import { PmOverlook } from '@/components/domain/dashboard/PmOverlook';
import { AdminOverlook } from '@/components/domain/dashboard/AdminOverlook';

export default function OverlookPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useDashboard();

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return <DashboardError error={error} />;
  }

  if (user?.role === 'tech') {
    return <TechOverlook data={data} />;
  }

  if (user?.role === 'pm') {
    return <PmOverlook data={data} />;
  }

  if (user?.role === 'admin') {
    return <AdminOverlook data={data} />;
  }

  return null;
}
```

#### 5.2.2 Tech Dashboard Components
- [ ] `/components/domain/dashboard/TechOverlook.tsx`
  - My Quests section (grouped by status/priority)
  - Active Timer widget (if running)
  - Blocked/Upcoming Quests section
  - Recent Time Entries
  - Missing Time alert (if no entries today)

---

### 5.3 PM Overlook

#### 5.3.1 PM Dashboard Components
- [ ] `/components/domain/dashboard/PmOverlook.tsx`
  - Focus Quests (high priority, in progress)
  - Awaiting Review section
  - Unassigned Quests section
  - My Pacts with health indicators
  - Retainer Alerts
  - Recent Items sidebar

---

### 5.4 Admin Overlook

#### 5.4.1 Admin Dashboard Components
- [ ] `/components/domain/dashboard/AdminOverlook.tsx`
  - All PM features
  - All Active Pacts view
  - Team Utilization (placeholder)
  - System Alerts

---

### 5.5 Dashboard UI Components

#### 5.5.1 Shared Components
- [ ] `/components/domain/dashboard/DashboardSection.tsx` â€” Section wrapper
- [ ] `/components/domain/dashboard/DashboardCard.tsx` â€” Metric card
- [ ] `/components/domain/dashboard/TaskQuickList.tsx` â€” Compact task list
- [ ] `/components/domain/dashboard/ProjectQuickList.tsx` â€” Compact project list
- [ ] `/components/domain/dashboard/RetainerAlert.tsx` â€” Retainer warning
- [ ] `/components/domain/dashboard/EmptySection.tsx` â€” Empty state

---

## ðŸ§ª Testing Requirements

### Integration Tests
- [ ] `/__tests__/integration/api/dashboard.test.ts`
  - Tech user gets only their visible tasks
  - PM user gets review and unassigned tasks
  - Admin user gets all active projects

---

## âœ… Phase 5 Acceptance Criteria

### Functionality
- [ ] Tech dashboard shows only assigned tasks from visible projects
- [ ] PM dashboard shows awaiting review tasks
- [ ] PM dashboard shows unassigned tasks
- [ ] Admin dashboard shows all active projects
- [ ] Dashboard refreshes periodically
- [ ] Active timer shows on Tech dashboard

### Code Quality
- [ ] Dashboard data fetched efficiently (single API call)
- [ ] Components are role-specific but share common elements
- [ ] Loading states display properly

---

## ðŸ”œ Next Phase

After completing Phase 5, proceed to **Phase 6: Recipe Wizard**.

---

*Phase 5 Document â€” Last Updated: December 2025*