'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock,
  ListTodo,
  AlertCircle,
  Calendar,
  Timer,
  Zap,
} from 'lucide-react';
import { TechDashboardData, DashboardTask, useLoadMoreDashboard, type TaskSortBy } from '@/lib/hooks/use-dashboard';
import { useTimer } from '@/lib/contexts/timer-context';
import { useToggleFocus, useUpdateTask } from '@/lib/hooks/use-tasks';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { DashboardSection } from './dashboard-section';
import { FocusTargetMeter } from './focus-target-meter';
import { TaskQuickList } from './task-quick-list';
import { TimeclockIssues } from './timeclock-issues';
import { TaskPeekDrawer } from '@/components/domain/tasks/task-peek-drawer';
import { Button } from '@/components/ui/button';
import { formatDuration, energyToMinutes, getMysteryMultiplier } from '@/lib/calculations/energy';
import type { MysteryFactor } from '@prisma/client';
import { formatElapsedTime } from '@/lib/utils/time';
import { TaskList, type TaskListColumn } from '@/components/ui/task-list';
import { TaskGroupingSelect } from '@/components/ui/task-grouping-select';
import { useTaskGrouping } from '@/lib/hooks/use-task-grouping';
import {
  focusColumn,
  statusColumn,
  titleColumn,
  actionsColumn,
  clientProjectSiteColumn,
  rangedEstimateColumn,
  dueDateColumn,
  priorityColumn,
} from '@/components/ui/task-list-columns';
import { TaskSortSelect } from '@/components/ui/task-sort-select';

const FOCUS_TARGET_KEY = 'dashboard-focus-target-hours';

function getStoredTarget(): number {
  if (typeof window === 'undefined') return 4;
  const saved = localStorage.getItem(FOCUS_TARGET_KEY);
  return saved ? parseFloat(saved) : 4;
}

function calculateFocusEstimates(tasks: DashboardTask[]): { min: number; max: number } {
  let min = 0;
  let max = 0;

  for (const task of tasks) {
    if (task.energy_estimate) {
      const baseMinutes = energyToMinutes(task.energy_estimate);
      min += baseMinutes;

      const mysteryFactor = (task.mystery_factor || 'none') as MysteryFactor;
      const multiplier = getMysteryMultiplier(mysteryFactor);
      max += Math.round(baseMinutes * multiplier);
    }
  }

  return { min, max };
}

interface TechOverlookProps {
  data: TechDashboardData;
  myTasksSort: TaskSortBy;
  onMyTasksSortChange: (sort: TaskSortBy) => void;
}

export function TechOverlook({ data, myTasksSort, onMyTasksSortChange }: TechOverlookProps) {
  const router = useRouter();
  const { t } = useTerminology();
  const timer = useTimer();
  const toggleFocus = useToggleFocus();
  const updateTask = useUpdateTask();
  const { loadMore, isLoading } = useLoadMoreDashboard(myTasksSort);

  // Peek drawer state
  const [peekTaskId, setPeekTaskId] = React.useState<string | null>(null);
  const [isPeekOpen, setIsPeekOpen] = React.useState(false);

  // Focus target state (persisted to localStorage)
  const [availableHours, setAvailableHours] = React.useState<number>(4);
  // Battery level (resets each session - not persisted)
  const [batteryLevel, setBatteryLevel] = React.useState<'full' | 'mid' | 'depleted'>('mid');

  React.useEffect(() => {
    setAvailableHours(getStoredTarget());
  }, []);

  const handleAvailableHoursChange = (hours: number) => {
    setAvailableHours(hours);
    localStorage.setItem(FOCUS_TARGET_KEY, hours.toString());
  };

  const handleTaskClick = (task: DashboardTask) => {
    setPeekTaskId(task.id);
    setIsPeekOpen(true);
  };

  const handleTaskIdClick = (taskId: string) => {
    setPeekTaskId(taskId);
    setIsPeekOpen(true);
  };

  const handleToggleFocus = (taskId: string, isFocus: boolean) => {
    toggleFocus.mutate({ id: taskId, is_focus: isFocus });
  };

  const handleTaskUpdate = (taskId: string, updates: Partial<DashboardTask>) => {
    updateTask.mutate({ id: taskId, data: updates as any });
  };

  // Separate tasks by focus flag
  const focusTasks = data.myTasks.items.filter((t) => t.is_focus);

  // Calculate focus task estimates for meter
  const focusEstimates = calculateFocusEstimates(focusTasks);

  // Task grouping for My Tasks section
  const { groupBy, setGroupBy, groups } = useTaskGrouping(data.myTasks.items, {
    storageKey: 'citadel-dashboard-grouping',
  });

  // Column configs for different task lists
  const focusColumns: TaskListColumn<DashboardTask>[] = [
    focusColumn<DashboardTask>({ onToggleFocus: handleToggleFocus }),
    statusColumn({ editable: true }),
    titleColumn({ editable: true }),
    clientProjectSiteColumn(),
    dueDateColumn(),
    rangedEstimateColumn(),
    actionsColumn<DashboardTask>({ onViewDetails: (task) => router.push(`/tasks/${task.id}`) }),
  ];

  const myTasksColumns: TaskListColumn<DashboardTask>[] = [
    focusColumn<DashboardTask>({ onToggleFocus: handleToggleFocus }),
    priorityColumn(),
    statusColumn({ editable: true }),
    titleColumn({ editable: true }),
    clientProjectSiteColumn(),
    dueDateColumn(),
    rangedEstimateColumn(),
    actionsColumn<DashboardTask>({ onViewDetails: (task) => router.push(`/tasks/${task.id}`) }),
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-main">Overlook</h1>
        <p className="text-text-sub">Your personal command center</p>
      </div>

      {/* Active Timer Banner */}
      {timer.isRunning && (
        <div className="flex items-center justify-between p-4 bg-primary/10 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-3">
            <Timer className="h-5 w-5 text-primary animate-pulse" />
            <div>
              <div className="font-medium text-text-main">
                Timer Running: {timer.taskTitle || 'Ad-hoc time'}
              </div>
              {timer.projectName && (
                <div className="text-sm text-text-sub">{timer.projectName}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-2xl font-mono font-semibold text-primary">
              {formatElapsedTime(timer.elapsedSeconds)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => timer.stopTimer()}
            >
              Stop
            </Button>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - My Quests */}
        <div className="lg:col-span-2 space-y-6">
          {/* Focus Quests */}
          <DashboardSection
            title={`Focus ${t('tasks')}`}
            icon={Zap}
            iconColor="text-amber-500"
            action={{ label: 'View All', href: '/tasks?my_tasks=true' }}
          >
            <FocusTargetMeter
              availableHours={availableHours}
              onAvailableHoursChange={handleAvailableHoursChange}
              batteryLevel={batteryLevel}
              onBatteryLevelChange={setBatteryLevel}
              estimatedMinutesLow={focusEstimates.min}
              estimatedMinutesHigh={focusEstimates.max}
            />
            <TaskList<DashboardTask>
              tasks={focusTasks}
              columns={focusColumns}
              onTaskClick={handleTaskClick}
              onTaskUpdate={handleTaskUpdate}
              showHeaders={false}
              emptyMessage={`No focus ${t('tasks').toLowerCase()} - check a ${t('task').toLowerCase()} to add it to your focus list`}
            />
          </DashboardSection>

          {/* All My Quests - hidden when empty */}
          {data.myTasks.items.length > 0 && (
            <DashboardSection
              title={`My ${t('tasks')}`}
              icon={ListTodo}
              iconColor="text-blue-500"
              count={data.myTasks.total}
              headerActions={
                <div className="flex items-center gap-2">
                  <TaskSortSelect
                    value={myTasksSort}
                    onChange={onMyTasksSortChange}
                    compact
                  />
                  <TaskGroupingSelect
                    value={groupBy}
                    onChange={setGroupBy}
                    compact
                  />
                </div>
              }
            >
              <TaskList<DashboardTask>
                tasks={groups ? undefined : data.myTasks.items}
                groups={groups || undefined}
                columns={myTasksColumns}
                onTaskClick={handleTaskClick}
                onTaskUpdate={handleTaskUpdate}
                showHeaders={false}
                emptyMessage={`No ${t('tasks').toLowerCase()} assigned to you`}
                hasMore={data.myTasks.hasMore}
                isLoading={isLoading('myTasks')}
                onLoadMore={() => loadMore('myTasks', data.myTasks.items.length)}
              />
            </DashboardSection>
          )}
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Timeclock Issues */}
          <TimeclockIssues />

          {/* Blocked Tasks */}
          {data.blockedTasks.length > 0 && (
            <DashboardSection title="Blocked" icon={AlertCircle} iconColor="text-red-500">
              <TaskQuickList
                tasks={data.blockedTasks}
                onTaskClick={handleTaskIdClick}
                maxItems={5}
              />
            </DashboardSection>
          )}

          {/* Upcoming Due Dates */}
          {data.upcomingTasks.length > 0 && (
            <DashboardSection title="Upcoming" icon={Calendar} iconColor="text-cyan-500">
              <TaskQuickList
                tasks={data.upcomingTasks}
                onTaskClick={handleTaskIdClick}
                showDueDate
                maxItems={5}
              />
            </DashboardSection>
          )}

          {/* Recent Time Entries - hidden when empty */}
          {data.recentTimeEntries.length > 0 && (
            <DashboardSection
              title="Recent Time"
              icon={Clock}
              iconColor="text-violet-500"
              action={{ label: 'View All', href: '/chronicles' }}
            >
              <div className="space-y-2">
                {data.recentTimeEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text-main truncate">
                        {entry.task?.title || entry.project?.name || 'Ad-hoc'}
                      </div>
                      <div className="text-xs text-text-sub">
                        {new Date(entry.started_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-text-main">
                      {formatDuration(entry.duration)}
                    </div>
                  </div>
                ))}
              </div>
            </DashboardSection>
          )}
        </div>
      </div>

      {/* Task Peek Drawer */}
      <TaskPeekDrawer
        taskId={peekTaskId}
        open={isPeekOpen}
        onOpenChange={setIsPeekOpen}
      />
    </div>
  );
}
