'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap,
  CircleDot,
  UserX,
  FolderKanban,
  AlertTriangle,
  CheckCircle2,
  Timer,
  Users,
  ListTodo,
} from 'lucide-react';
import { AdminDashboardData, DashboardTask, useLoadMoreDashboard } from '@/lib/hooks/use-dashboard';
import { useTimer } from '@/lib/contexts/timer-context';
import { useToggleFocus, useUpdateTask } from '@/lib/hooks/use-tasks';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { DashboardSection } from './dashboard-section';
import { FocusTargetMeter } from './focus-target-meter';
import { ProjectQuickList } from './project-quick-list';
import { RetainerAlert } from './retainer-alert';
import { TimeclockIssues } from './timeclock-issues';
import { TaskPeekDrawer } from '@/components/domain/tasks/task-peek-drawer';
import { Button } from '@/components/ui/button';
import { formatElapsedTime } from '@/lib/utils/time';
import { energyToMinutes, getMysteryMultiplier } from '@/lib/calculations/energy';
import type { MysteryFactor } from '@prisma/client';
import { TaskList, type TaskListColumn } from '@/components/ui/task-list';
import {
  focusColumn,
  statusColumn,
  titleColumn,
  estimateColumn,
  assigneeColumn,
  timeSpentColumn,
  actionsColumn,
  clientProjectSiteColumn,
  rangedEstimateColumn,
  approveColumn,
  dueDateColumn,
  priorityColumn,
} from '@/components/ui/task-list-columns';
import { TaskSortSelect, type TaskSortBy } from '@/components/ui/task-sort-select';

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

interface AdminOverlookProps {
  data: AdminDashboardData;
}

export function AdminOverlook({ data, myTasksSort, onMyTasksSortChange }: AdminOverlookProps & { myTasksSort: TaskSortBy; onMyTasksSortChange: (sort: TaskSortBy) => void }) {
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

  // Calculate focus task estimates for meter
  const focusEstimates = calculateFocusEstimates(data.focusTasks.items);

  const handleTaskClick = (task: DashboardTask) => {
    setPeekTaskId(task.id);
    setIsPeekOpen(true);
  };

  const handleToggleFocus = (taskId: string, isFocus: boolean) => {
    toggleFocus.mutate({ id: taskId, is_focus: isFocus });
  };

  const handleTaskUpdate = (taskId: string, updates: Partial<DashboardTask>) => {
    updateTask.mutate({ id: taskId, data: updates as any });
  };

  const handleApprove = (taskId: string) => {
    updateTask.mutate({ id: taskId, data: { approved: true } as any });
  };

  // Column configs for different task lists
  const focusColumns: TaskListColumn<DashboardTask>[] = [
    focusColumn<DashboardTask>({ onToggleFocus: handleToggleFocus }),
    statusColumn({ editable: true }),
    titleColumn({ editable: true }),
    clientProjectSiteColumn(),
    rangedEstimateColumn(),
    actionsColumn<DashboardTask>({ onViewDetails: (task) => router.push(`/tasks/${task.id}`) }),
  ];

  const reviewColumns: TaskListColumn<DashboardTask>[] = [
    approveColumn<DashboardTask>({ onApprove: handleApprove }),
    titleColumn({ editable: true }),
    assigneeColumn({ editable: true }),
    estimateColumn(),
    timeSpentColumn<DashboardTask>(),
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

  const unassignedColumns: TaskListColumn<DashboardTask>[] = [
    titleColumn({ editable: true }),
    assigneeColumn({ editable: true }),
    clientProjectSiteColumn(),
    dueDateColumn({ editable: true }),
    rangedEstimateColumn(),
    actionsColumn<DashboardTask>({ onViewDetails: (task) => router.push(`/tasks/${task.id}`) }),
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-main">Overlook</h1>
        <p className="text-text-sub">System administration command center</p>
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
        {/* Left Column - Tasks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Focus Tasks */}
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
              tasks={data.focusTasks.items}
              columns={focusColumns}
              onTaskClick={handleTaskClick}
              onTaskUpdate={handleTaskUpdate}
              showHeaders={false}
              emptyMessage={`No focus ${t('tasks').toLowerCase()} - check a ${t('task').toLowerCase()} to add it to your focus list`}
              hasMore={data.focusTasks.hasMore}
              isLoading={isLoading('focusTasks')}
              onLoadMore={() => loadMore('focusTasks', data.focusTasks.items.length)}
            />
          </DashboardSection>

          {/* Awaiting Review - hidden when empty */}
          {data.awaitingReview.items.length > 0 && (
            <DashboardSection
              title="Awaiting Review"
              icon={CircleDot}
              iconColor="text-purple-500"
              action={{ label: 'View All', href: '/tasks?pending_review=true' }}
            >
              <TaskList<DashboardTask>
                tasks={data.awaitingReview.items}
                columns={reviewColumns}
                onTaskClick={handleTaskClick}
                onTaskUpdate={handleTaskUpdate}
                showHeaders={false}
                emptyMessage="No tasks awaiting review"
                hasMore={data.awaitingReview.hasMore}
                isLoading={isLoading('awaitingReview')}
                onLoadMore={() => loadMore('awaitingReview', data.awaitingReview.items.length)}
              />
            </DashboardSection>
          )}

          {/* Unassigned Tasks - only show if there are unassigned tasks */}
          {data.unassignedTasks.items.length > 0 && (
            <DashboardSection
              title={`Unassigned ${t('tasks')}`}
              icon={UserX}
              iconColor="text-orange-500"
              action={{ label: 'View All', href: '/tasks?assignee=unassigned' }}
            >
              <TaskList<DashboardTask>
                tasks={data.unassignedTasks.items}
                columns={unassignedColumns}
                onTaskClick={handleTaskClick}
                onTaskUpdate={handleTaskUpdate}
                showHeaders={false}
                emptyMessage={`All ${t('tasks').toLowerCase()} are assigned`}
                hasMore={data.unassignedTasks.hasMore}
                isLoading={isLoading('unassignedTasks')}
                onLoadMore={() => loadMore('unassignedTasks', data.unassignedTasks.items.length)}
              />
            </DashboardSection>
          )}

          {/* My Tasks - hidden when empty */}
          {data.myTasks.items.length > 0 && (
            <DashboardSection
              title={`My ${t('tasks')}`}
              icon={ListTodo}
              iconColor="text-blue-500"
              action={{ label: 'View All', href: '/tasks?my_tasks=true' }}
              headerActions={
                <TaskSortSelect
                  value={myTasksSort}
                  onChange={onMyTasksSortChange}
                  compact
                />
              }
            >
              <TaskList<DashboardTask>
                tasks={data.myTasks.items}
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

          {/* All Active Projects - hidden when empty */}
          {data.allActiveProjects.length > 0 && (
            <DashboardSection
              title={`All Active ${t('projects')}`}
              icon={FolderKanban}
              iconColor="text-teal-500"
              action={{ label: 'View All', href: '/projects' }}
            >
              <ProjectQuickList
                projects={data.allActiveProjects}
                emptyMessage="No active projects"
                maxItems={10}
              />
            </DashboardSection>
          )}
        </div>

        {/* Right Column - Team & Activity */}
        <div className="space-y-6">
          {/* Timeclock Issues */}
          <TimeclockIssues />

          {/* Retainer Alerts */}
          {data.retainerAlerts.length > 0 && (
            <DashboardSection title="Retainer Alerts" icon={AlertTriangle} iconColor="text-amber-500">
              <RetainerAlert alerts={data.retainerAlerts} />
            </DashboardSection>
          )}

          {/* Team Utilization - hidden when empty */}
          {data.teamUtilization.length > 0 && (
            <DashboardSection title="Team Utilization (This Week)" icon={Users} iconColor="text-indigo-500">
              <div className="space-y-2">
                {data.teamUtilization.map((user) => (
                  <div
                    key={user.user_id}
                    className="flex items-center justify-between p-2 rounded-lg bg-surface-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                        {user.user_name.charAt(0)}
                      </div>
                      <span className="font-medium text-text-main">
                        {user.user_name}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-text-main">
                      {user.hours_this_week}h
                    </span>
                  </div>
                ))}
              </div>
            </DashboardSection>
          )}

          {/* My Projects - hidden when empty */}
          {data.myProjects.length > 0 && (
            <DashboardSection
              title={`My ${t('projects')}`}
              icon={FolderKanban}
              iconColor="text-teal-500"
              action={{ label: 'View All', href: '/projects' }}
            >
              <ProjectQuickList
                projects={data.myProjects}
                emptyMessage="No active projects"
                maxItems={5}
              />
            </DashboardSection>
          )}

          {/* Recent Completions - hidden when empty */}
          {data.recentCompletions.length > 0 && (
            <DashboardSection title="Recent Completions" icon={CheckCircle2} iconColor="text-green-500">
              <div className="space-y-2">
                {data.recentCompletions.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text-main truncate">
                        {task.title}
                      </div>
                      <div className="text-xs text-text-sub">
                        {task.assignee?.name || 'Unassigned'} •{' '}
                        {task.project?.name}
                      </div>
                    </div>
                    <div className="text-xs text-text-sub">
                      {task.completed_at
                        ? new Date(task.completed_at).toLocaleDateString()
                        : ''}
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
