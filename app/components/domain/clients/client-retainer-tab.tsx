'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Folder,
  FileText,
} from 'lucide-react';
import {
  useClientRetainer,
  type RetainerTask,
  type ScheduledRetainerTask
} from '@/lib/hooks/use-clients';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { TaskList, type TaskListGroup, type TaskListColumn } from '@/components/ui/task-list';
import { energyToMinutes, getMysteryMultiplier, formatDuration } from '@/lib/calculations/energy';
import { MysteryFactor } from '@prisma/client';

interface ClientRetainerTabProps {
  clientId: string;
  retainerHours: number;
}

/**
 * Get current month in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Navigate to previous or next month
 */
function navigateMonth(currentMonth: string, direction: 'prev' | 'next'): string {
  const [year, month] = currentMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + (direction === 'next' ? 1 : -1), 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format month string for display (e.g., "January 2026")
 */
function formatMonthDisplay(monthString: string): string {
  const [year, month] = monthString.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Format minutes as hours (e.g., 90 -> "1.5h")
 */
function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (hours === 0) return '0h';
  if (hours < 0.1) return `${Math.round(minutes)}m`;
  return `${hours.toFixed(1).replace(/\.0$/, '')}h`;
}

/**
 * Check if a month is in the future
 */
function isFutureMonth(monthString: string): boolean {
  const [year, month] = monthString.split('-').map(Number);
  const now = new Date();
  const selectedDate = new Date(year, month - 1, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return selectedDate > currentMonthStart;
}

/**
 * Format date for display (e.g., "Jan 15")
 */
function formatShortDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format estimate range (e.g., "1h - 1.5h")
 */
function formatEstimateRange(minMinutes: number, maxMinutes: number): string {
  if (minMinutes === 0 && maxMinutes === 0) return '-';
  if (minMinutes === maxMinutes) {
    return formatDuration(minMinutes);
  }
  return `${formatDuration(minMinutes)} - ${formatDuration(maxMinutes)}`;
}

type UsageStatus = 'ok' | 'warning' | 'over';

function getUsageStatus(usagePercent: number): UsageStatus {
  if (usagePercent > 100) return 'over';
  if (usagePercent >= 80) return 'warning';
  return 'ok';
}

function getStatusColor(status: UsageStatus): string {
  switch (status) {
    case 'over': return 'var(--error)';
    case 'warning': return 'var(--warning)';
    default: return 'var(--success)';
  }
}

// Striped pattern for scheduled segment
const scheduledBarStyle: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.2) 3px, rgba(255,255,255,0.2) 6px)',
};

export function ClientRetainerTab({ clientId, retainerHours }: ClientRetainerTabProps) {
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth);

  const { data, isLoading, error } = useClientRetainer(clientId, selectedMonth);

  const handlePrevMonth = () => {
    setSelectedMonth((current) => navigateMonth(current, 'prev'));
  };

  const handleNextMonth = () => {
    const nextMonth = navigateMonth(selectedMonth, 'next');
    if (!isFutureMonth(nextMonth)) {
      setSelectedMonth(nextMonth);
    }
  };

  const isCurrentMonth = selectedMonth === getCurrentMonth();
  const canGoNext = !isCurrentMonth;

  // Group tasks by project
  const { completedGroups, scheduledGroups } = useMemo(() => {
    const tasks = data?.tasks || [];
    const scheduledTasks = data?.scheduledTasks || [];

    // Group completed tasks
    const completedByProject = new Map<string, RetainerTask[]>();
    const completedAdHoc: RetainerTask[] = [];

    for (const task of tasks) {
      if (task.project_id) {
        const key = task.project_id;
        if (!completedByProject.has(key)) {
          completedByProject.set(key, []);
        }
        completedByProject.get(key)!.push(task);
      } else {
        completedAdHoc.push(task);
      }
    }

    const completedGroups: TaskListGroup<RetainerTask>[] = [];
    for (const [projectId, projectTasks] of completedByProject) {
      const projectName = projectTasks[0]?.project_name || 'Unknown Project';
      completedGroups.push({
        id: `completed-${projectId}`,
        title: projectName,
        icon: <Folder className="h-4 w-4 text-text-sub" />,
        tasks: projectTasks,
        collapsible: true,
      });
    }
    if (completedAdHoc.length > 0) {
      completedGroups.push({
        id: 'completed-adhoc',
        title: 'Ad-hoc Tasks',
        icon: <FileText className="h-4 w-4 text-text-sub" />,
        tasks: completedAdHoc,
        collapsible: true,
      });
    }

    // Group scheduled tasks
    const scheduledByProject = new Map<string, ScheduledRetainerTask[]>();
    const scheduledAdHoc: ScheduledRetainerTask[] = [];

    for (const task of scheduledTasks) {
      if (task.project_id) {
        const key = task.project_id;
        if (!scheduledByProject.has(key)) {
          scheduledByProject.set(key, []);
        }
        scheduledByProject.get(key)!.push(task);
      } else {
        scheduledAdHoc.push(task);
      }
    }

    const scheduledGroups: TaskListGroup<ScheduledRetainerTask>[] = [];
    for (const [projectId, projectTasks] of scheduledByProject) {
      const projectName = projectTasks[0]?.project_name || 'Unknown Project';
      scheduledGroups.push({
        id: `scheduled-${projectId}`,
        title: projectName,
        icon: <Folder className="h-4 w-4 text-text-sub" />,
        tasks: projectTasks,
        collapsible: true,
      });
    }
    if (scheduledAdHoc.length > 0) {
      scheduledGroups.push({
        id: 'scheduled-adhoc',
        title: 'Ad-hoc Tasks',
        icon: <FileText className="h-4 w-4 text-text-sub" />,
        tasks: scheduledAdHoc,
        collapsible: true,
      });
    }

    return { completedGroups, scheduledGroups };
  }, [data?.tasks, data?.scheduledTasks]);

  // Column definitions for completed tasks
  const completedColumns: TaskListColumn<RetainerTask>[] = [
    {
      key: 'title',
      header: 'Task',
      width: 'minmax(200px, 1fr)',
      cell: (task) => (
        <div className="min-w-0">
          <span className="font-medium text-text-main truncate block">{task.title}</span>
        </div>
      ),
    },
    {
      key: 'time_spent',
      header: 'Logged',
      width: '80px',
      cell: (task) => (
        <span className="text-sm font-medium text-text-main">
          {formatHours(task.time_spent_minutes)}
        </span>
      ),
    },
    {
      key: 'status',
      header: '',
      width: '80px',
      cell: (task) => (
        task.invoiced ? <Badge variant="success" size="sm">Invoiced</Badge> : null
      ),
    },
  ];

  // Column definitions for scheduled tasks
  const scheduledColumns: TaskListColumn<ScheduledRetainerTask>[] = [
    {
      key: 'title',
      header: 'Task',
      width: 'minmax(150px, 1fr)',
      cell: (task) => (
        <div className="min-w-0">
          <span className="font-medium text-text-main truncate block">{task.title}</span>
        </div>
      ),
    },
    {
      key: 'due_date',
      header: 'Due',
      width: '80px',
      cell: (task) => (
        <span className="text-sm text-text-sub">
          {formatShortDate(task.due_date)}
        </span>
      ),
    },
    {
      key: 'assignee',
      header: 'Assignee',
      width: '100px',
      cell: (task) => (
        <span className="text-sm text-text-sub truncate block">
          {task.assignee_name || '-'}
        </span>
      ),
    },
    {
      key: 'estimate',
      header: 'Estimate',
      width: '100px',
      cell: (task) => (
        <span className="text-sm text-text-sub">
          {formatEstimateRange(task.estimated_minutes_min, task.estimated_minutes_max)}
        </span>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <EmptyState
            icon={<AlertCircle className="h-12 w-12" />}
            title="Error loading retainer data"
            description="There was a problem loading the retainer usage."
          />
        </CardContent>
      </Card>
    );
  }

  const {
    usedMinutes = 0,
    scheduledMinutes = 0,
    projectedTotalMinutes = 0,
    tasks = [],
    scheduledTasks = [],
    unscheduledTasksCount = 0,
    unscheduledMinutes = 0,
  } = data || {};

  const retainerMinutes = retainerHours * 60;
  const remainingMinutes = Math.max(retainerMinutes - usedMinutes, 0);
  const projectedRemainingMinutes = Math.max(retainerMinutes - projectedTotalMinutes, 0);

  // Percentages for progress bar
  const usagePercent = retainerMinutes > 0 ? Math.round((usedMinutes / retainerMinutes) * 100) : 0;
  const scheduledPercent = retainerMinutes > 0 ? Math.round((scheduledMinutes / retainerMinutes) * 100) : 0;
  const projectedPercent = usagePercent + scheduledPercent;

  const actualStatus = getUsageStatus(usagePercent);
  const projectedStatus = getUsageStatus(projectedPercent);
  const hasProjectedOverage = projectedTotalMinutes > retainerMinutes;

  return (
    <div className="space-y-6">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={handlePrevMonth}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <h2 className="text-lg font-semibold text-text-main">
          {formatMonthDisplay(selectedMonth)}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNextMonth}
          disabled={!canGoNext}
          className={!canGoNext ? 'opacity-50 cursor-not-allowed' : ''}
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Unscheduled Warning */}
      {unscheduledTasksCount > 0 && (
        <div
          className="p-3 rounded-lg border flex items-start gap-2"
          style={{
            backgroundColor: 'var(--warning-subtle)',
            borderColor: 'var(--warning)',
            borderWidth: '1px',
          }}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} />
          <div>
            <p className="text-sm font-medium text-text-main">
              {unscheduledTasksCount} retainer task{unscheduledTasksCount > 1 ? 's' : ''} without due dates
            </p>
            <p className="text-xs text-text-sub">
              ~{formatHours(unscheduledMinutes)} estimated work not shown in projections
            </p>
          </div>
        </div>
      )}

      {/* Usage Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-text-sub">
              <Clock className="h-4 w-4" />
              Retainer
            </div>
            <div className="text-2xl font-semibold text-text-main mt-1">
              {retainerHours}h
            </div>
            <div className="text-xs text-text-sub">per month</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-text-sub">
              <CheckCircle className="h-4 w-4" style={{ color: getStatusColor(actualStatus) }} />
              Actual
            </div>
            <div className="text-2xl font-semibold text-text-main mt-1">
              {formatHours(usedMinutes)}
            </div>
            <div className="text-xs text-text-sub">{usagePercent}% used</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-text-sub">
              <Calendar className="h-4 w-4" style={{ color: 'var(--accent)' }} />
              Scheduled
            </div>
            <div className="text-2xl font-semibold text-text-main mt-1">
              {formatHours(scheduledMinutes)}
            </div>
            <div className="text-xs text-text-sub">estimated</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-text-sub">
              {hasProjectedOverage ? (
                <AlertTriangle className="h-4 w-4" style={{ color: 'var(--error)' }} />
              ) : (
                <CheckCircle className="h-4 w-4" style={{ color: 'var(--success)' }} />
              )}
              Projected
            </div>
            <div className="text-2xl font-semibold text-text-main mt-1">
              {formatHours(projectedTotalMinutes)}
            </div>
            {hasProjectedOverage ? (
              <Badge variant="error" size="sm">{formatHours(projectedTotalMinutes - retainerMinutes)} over</Badge>
            ) : (
              <div className="text-xs text-text-sub">{formatHours(projectedRemainingMinutes)} remaining</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dual-Segment Progress Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-text-sub">Monthly Usage</span>
            <span className="text-text-main font-medium">
              {formatHours(usedMinutes)} actual + {formatHours(scheduledMinutes)} scheduled
            </span>
          </div>
          <div className="h-4 bg-surface-alt rounded-full overflow-hidden relative">
            {/* Actual usage segment */}
            <div
              className="absolute inset-y-0 left-0 transition-all duration-300 rounded-l-full"
              style={{
                width: `${Math.min(usagePercent, 100)}%`,
                backgroundColor: getStatusColor(actualStatus),
              }}
            />
            {/* Scheduled usage segment */}
            {scheduledPercent > 0 && (
              <div
                className="absolute inset-y-0 transition-all duration-300"
                style={{
                  left: `${Math.min(usagePercent, 100)}%`,
                  width: `${Math.min(scheduledPercent, Math.max(0, 100 - usagePercent))}%`,
                  backgroundColor: getStatusColor(projectedStatus),
                  ...scheduledBarStyle,
                }}
              />
            )}
          </div>
          {/* Legend */}
          <div className="mt-3 flex items-center gap-6 text-xs text-text-sub">
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-3 rounded"
                style={{ backgroundColor: 'var(--success)' }}
              />
              <span>Actual ({usagePercent}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-3 rounded"
                style={{
                  backgroundColor: 'var(--success)',
                  ...scheduledBarStyle,
                }}
              />
              <span>Scheduled ({scheduledPercent}%)</span>
            </div>
            {projectedPercent > 100 && (
              <div className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" style={{ color: 'var(--error)' }} />
                <span style={{ color: 'var(--error)' }}>
                  {projectedPercent - 100}% projected overage
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Completed This Month */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Completed This Month</CardTitle>
            <Badge variant="default">{formatHours(usedMinutes)} logged</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {tasks.length === 0 ? (
            <p className="text-text-sub text-sm py-4">No time logged this month.</p>
          ) : (
            <TaskList
              groups={completedGroups}
              columns={completedColumns}
              onTaskClick={(task) => router.push(`/tasks/${task.id}`)}
              showHeaders={false}
              emptyMessage="No tasks"
            />
          )}
        </CardContent>
      </Card>

      {/* Scheduled This Month */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Scheduled This Month</CardTitle>
            <Badge variant="info">~{formatHours(scheduledMinutes)} estimated</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {scheduledTasks.length === 0 ? (
            <p className="text-text-sub text-sm py-4">No tasks scheduled for this month.</p>
          ) : (
            <TaskList
              groups={scheduledGroups}
              columns={scheduledColumns}
              onTaskClick={(task) => router.push(`/tasks/${task.id}`)}
              showHeaders={true}
              emptyMessage="No tasks"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
