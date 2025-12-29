# Phase 9: Reports & Data Views
## Detailed Implementation Guide for Claude Code

**Phase:** 9 of 10  
**Estimated Duration:** 2-3 days  
**Prerequisites:** Phase 8 complete (Notifications & Polish working)

---

## 🎯 Phase Goal

Build reporting and data visualization features. By the end of this phase:
- Retainer tracking shows hours used vs. available
- Time reports can be generated and exported
- Project health indicators are calculated
- Admin has access to utilization reports
- Data can be exported to CSV

---

## 📚 Required Reading

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-app-architecture.md` | Retainer tracking, project health |
| `indelible-wireframes-list-views.md` | Report layouts |
| `indelible-api-endpoint-inventory.md` | Report endpoints |

---

## 📋 Phase Checklist

### 9.1 Retainer Tracking

#### 9.1.1 Retainer Calculation Utilities
**Create `/lib/calculations/retainer.ts`:**

```typescript
import { prisma } from '@/lib/db/prisma';

export interface RetainerStatus {
  clientId: string;
  clientName: string;
  periodStart: Date;
  periodEnd: Date;
  allocatedHours: number;
  usedHours: number;
  remainingHours: number;
  percentUsed: number;
  status: 'healthy' | 'warning' | 'critical' | 'exceeded';
}

export async function getRetainerStatus(
  clientId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<RetainerStatus | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      retainer_hours: true,
    },
  });

  if (!client || !client.retainer_hours) {
    return null;
  }

  const allocatedHours = Number(client.retainer_hours);

  // Sum time entries for this client in period
  const timeEntries = await prisma.timeEntry.aggregate({
    where: {
      project: { client_id: clientId },
      started_at: { gte: periodStart, lte: periodEnd },
      is_billable: true,
    },
    _sum: { duration: true },
  });

  const usedMinutes = timeEntries._sum.duration || 0;
  const usedHours = usedMinutes / 60;
  const remainingHours = allocatedHours - usedHours;
  const percentUsed = (usedHours / allocatedHours) * 100;

  let status: RetainerStatus['status'] = 'healthy';
  if (percentUsed >= 100) {
    status = 'exceeded';
  } else if (percentUsed >= 90) {
    status = 'critical';
  } else if (percentUsed >= 75) {
    status = 'warning';
  }

  return {
    clientId: client.id,
    clientName: client.name,
    periodStart,
    periodEnd,
    allocatedHours,
    usedHours: Math.round(usedHours * 100) / 100,
    remainingHours: Math.round(remainingHours * 100) / 100,
    percentUsed: Math.round(percentUsed),
    status,
  };
}

export async function getAllRetainerStatuses(
  periodStart: Date,
  periodEnd: Date
): Promise<RetainerStatus[]> {
  const clientsWithRetainers = await prisma.client.findMany({
    where: {
      retainer_hours: { not: null },
      is_deleted: false,
      status: 'active',
    },
    select: { id: true },
  });

  const statuses = await Promise.all(
    clientsWithRetainers.map((c) => getRetainerStatus(c.id, periodStart, periodEnd))
  );

  return statuses.filter((s): s is RetainerStatus => s !== null);
}
```

#### 9.1.2 Retainer API Endpoints
- [ ] `GET /api/reports/retainers` — All retainer statuses
- [ ] `GET /api/reports/retainers/:clientId` — Single client retainer

#### 9.1.3 Retainer UI
- [ ] `/app/(app)/chronicles/retainers/page.tsx` — Retainer dashboard
- [ ] `/components/domain/reports/RetainerCard.tsx` — Single retainer display
- [ ] `/components/domain/reports/RetainerProgressBar.tsx` — Visual progress
- [ ] Client detail page retainer section

---

### 9.2 Time Reports

#### 9.2.1 Time Report API
**Create `/app/api/reports/time/route.ts`:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const userId = searchParams.get('user_id');
    const clientId = searchParams.get('client_id');
    const projectId = searchParams.get('project_id');
    const groupBy = searchParams.get('group_by') || 'day'; // day, week, project, user

    // Build filters
    const where: any = {};
    
    if (startDate) {
      where.started_at = { gte: new Date(startDate) };
    }
    if (endDate) {
      where.started_at = { ...where.started_at, lte: new Date(endDate) };
    }
    if (userId) {
      where.user_id = userId;
    }
    if (clientId) {
      where.project = { client_id: clientId };
    }
    if (projectId) {
      where.project_id = projectId;
    }

    // Tech users can only see their own time
    if (auth.role === 'tech') {
      where.user_id = auth.userId;
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        project: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { started_at: 'desc' },
    });

    // Calculate totals
    const totalMinutes = entries.reduce((sum, e) => sum + e.duration, 0);
    const billableMinutes = entries
      .filter((e) => e.is_billable)
      .reduce((sum, e) => sum + e.duration, 0);

    // Group as requested
    const grouped = groupTimeEntries(entries, groupBy);

    return NextResponse.json({
      entries,
      grouped,
      totals: {
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 100) / 100,
        billableMinutes,
        billableHours: Math.round((billableMinutes / 60) * 100) / 100,
        billablePercent: totalMinutes > 0
          ? Math.round((billableMinutes / totalMinutes) * 100)
          : 0,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function groupTimeEntries(entries: any[], groupBy: string) {
  const groups: Record<string, { label: string; minutes: number; entries: any[] }> = {};

  for (const entry of entries) {
    let key: string;
    let label: string;

    switch (groupBy) {
      case 'day':
        key = entry.started_at.toISOString().split('T')[0];
        label = new Date(key).toLocaleDateString();
        break;
      case 'week':
        const weekStart = getWeekStart(entry.started_at);
        key = weekStart.toISOString().split('T')[0];
        label = `Week of ${weekStart.toLocaleDateString()}`;
        break;
      case 'project':
        key = entry.project_id || 'no-project';
        label = entry.project?.name || 'No Project';
        break;
      case 'user':
        key = entry.user_id;
        label = entry.user?.name || 'Unknown';
        break;
      default:
        key = 'all';
        label = 'All';
    }

    if (!groups[key]) {
      groups[key] = { label, minutes: 0, entries: [] };
    }
    groups[key].minutes += entry.duration;
    groups[key].entries.push(entry);
  }

  return Object.values(groups).sort((a, b) => b.minutes - a.minutes);
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
```

#### 9.2.2 Time Report UI
- [ ] `/app/(app)/chronicles/reports/page.tsx` — Time reports page
- [ ] Date range picker
- [ ] Filter by client, project, user
- [ ] Group by selector
- [ ] Summary cards (total hours, billable %)
- [ ] Detailed table view
- [ ] Export to CSV button

---

### 9.3 Project Health

#### 9.3.1 Health Calculation
**Create `/lib/calculations/project-health.ts`:**

```typescript
import { prisma } from '@/lib/db/prisma';

export interface ProjectHealth {
  projectId: string;
  overallScore: number; // 0-100
  indicators: {
    tasksOnTrack: number; // % of tasks not blocked/overdue
    estimateAccuracy: number; // Estimated vs actual time
    velocityTrend: number; // Recent completion rate
    blockageLevel: number; // % of tasks blocked
  };
  status: 'healthy' | 'at-risk' | 'critical';
  alerts: string[];
}

export async function calculateProjectHealth(projectId: string): Promise<ProjectHealth> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      tasks: {
        where: { is_deleted: false },
        select: {
          id: true,
          status: true,
          due_date: true,
          estimated_minutes: true,
          time_entries: {
            select: { duration: true },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const tasks = project.tasks;
  const totalTasks = tasks.length;
  const alerts: string[] = [];

  if (totalTasks === 0) {
    return {
      projectId,
      overallScore: 100,
      indicators: {
        tasksOnTrack: 100,
        estimateAccuracy: 100,
        velocityTrend: 100,
        blockageLevel: 0,
      },
      status: 'healthy',
      alerts: [],
    };
  }

  // Tasks on track (not blocked, not overdue)
  const now = new Date();
  const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;
  const overdueTasks = tasks.filter(
    (t) => t.due_date && t.due_date < now && t.status !== 'done'
  ).length;
  const tasksOnTrack = Math.round(
    ((totalTasks - blockedTasks - overdueTasks) / totalTasks) * 100
  );

  if (blockedTasks > 0) {
    alerts.push(`${blockedTasks} task(s) are blocked`);
  }
  if (overdueTasks > 0) {
    alerts.push(`${overdueTasks} task(s) are overdue`);
  }

  // Estimate accuracy
  let estimateAccuracy = 100;
  const tasksWithEstimates = tasks.filter((t) => t.estimated_minutes);
  if (tasksWithEstimates.length > 0) {
    const totalEstimated = tasksWithEstimates.reduce(
      (sum, t) => sum + (t.estimated_minutes || 0),
      0
    );
    const totalActual = tasksWithEstimates.reduce(
      (sum, t) => sum + t.time_entries.reduce((s, e) => s + e.duration, 0),
      0
    );
    if (totalActual > 0) {
      const ratio = totalEstimated / totalActual;
      estimateAccuracy = Math.max(0, 100 - Math.abs(100 - ratio * 100));
    }
  }

  // Blockage level
  const blockageLevel = Math.round((blockedTasks / totalTasks) * 100);

  // Calculate overall score
  const overallScore = Math.round(
    tasksOnTrack * 0.4 +
    estimateAccuracy * 0.3 +
    (100 - blockageLevel) * 0.3
  );

  let status: ProjectHealth['status'] = 'healthy';
  if (overallScore < 50) {
    status = 'critical';
  } else if (overallScore < 75) {
    status = 'at-risk';
  }

  return {
    projectId,
    overallScore,
    indicators: {
      tasksOnTrack,
      estimateAccuracy: Math.round(estimateAccuracy),
      velocityTrend: 100, // Placeholder
      blockageLevel,
    },
    status,
    alerts,
  };
}
```

#### 9.3.2 Health Display
- [ ] Project detail health badge
- [ ] Project list health indicators
- [ ] Tooltip with breakdown

---

### 9.4 Utilization Reports (Admin)

#### 9.4.1 Team Utilization API
- [ ] `GET /api/reports/utilization` — Team utilization metrics
- [ ] Hours per user per period
- [ ] Billable vs non-billable breakdown
- [ ] Target vs actual comparison

#### 9.4.2 Utilization UI
- [ ] `/app/(app)/guild/reports/page.tsx` — Admin reports
- [ ] Team utilization chart
- [ ] Individual utilization cards

---

### 9.5 CSV Export

#### 9.5.1 Export Utilities
**Create `/lib/utils/export.ts`:**

```typescript
export function generateCSV(data: Record<string, any>[], columns: string[]): string {
  const header = columns.join(',');
  const rows = data.map((row) =>
    columns.map((col) => {
      const value = row[col];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && value.includes(',')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
```

#### 9.5.2 Export Endpoints
- [ ] `GET /api/reports/time/export` — Time report CSV
- [ ] `GET /api/reports/retainers/export` — Retainer report CSV

---

## 🧪 Testing Requirements

### Unit Tests
- [ ] `/__tests__/unit/calculations/retainer.test.ts`
- [ ] `/__tests__/unit/calculations/project-health.test.ts`

### Integration Tests
- [ ] `/__tests__/integration/api/reports.test.ts`

---

## âœ… Phase 9 Acceptance Criteria

### Functionality
- [ ] Retainer status shows for clients with retainer hours
- [ ] Retainer alerts when approaching/exceeding limit
- [ ] Time reports filter by date, client, project, user
- [ ] Time reports group by day, week, project, user
- [ ] Time reports show totals and billable percentage
- [ ] Project health calculates correctly
- [ ] CSV export works for time data
- [ ] Admin can see utilization reports

### Code Quality
- [ ] Calculations are unit tested
- [ ] Reports are performant with proper indexing
- [ ] Export utilities are reusable

---

## 📜 Next Phase

After completing Phase 9, proceed to **Phase 10: Testing & Deployment**.

---

*Phase 9 Document — Last Updated: December 2025*