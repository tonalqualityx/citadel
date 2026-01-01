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
  ListTodo,
} from 'lucide-react';
import { PmDashboardData, DashboardTask, useLoadMoreDashboard } from '@/lib/hooks/use-dashboard';
import { useTimer } from '@/lib/contexts/timer-context';
import { useToggleFocus, useUpdateTask } from '@/lib/hooks/use-tasks';
import { DashboardSection } from './dashboard-section';
import { ProjectQuickList } from './project-quick-list';
import { RetainerAlert } from './retainer-alert';
import { TimeclockIssues } from './timeclock-issues';
import { TaskPeekDrawer } from '@/components/domain/tasks/task-peek-drawer';
import { Button } from '@/components/ui/button';
import { formatElapsedTime } from '@/lib/utils/time';
import { TaskList, type TaskListColumn } from '@/components/ui/task-list';
import { TaskGroupingSelect } from '@/components/ui/task-grouping-select';
import { useTaskGrouping } from '@/lib/hooks/use-task-grouping';
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
} from '@/components/ui/task-list-columns';

interface PmOverlookProps {
  data: PmDashboardData;
}

export function PmOverlook({ data }: PmOverlookProps) {
  const router = useRouter();
  const timer = useTimer();
  const toggleFocus = useToggleFocus();
  const updateTask = useUpdateTask();
  const { loadMore, isLoading } = useLoadMoreDashboard();

  // Peek drawer state
  const [peekTaskId, setPeekTaskId] = React.useState<string | null>(null);
  const [isPeekOpen, setIsPeekOpen] = React.useState(false);

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

  // Task grouping for My Quests section (shares storage key with tech dashboard)
  const { groupBy, setGroupBy, groups } = useTaskGrouping(data.myTasks.items, {
    storageKey: 'citadel-dashboard-grouping',
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-main">Overlook</h1>
        <p className="text-text-sub">Project management command center</p>
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
            title="Focus Quests"
            icon={Zap}
            count={data.focusTasks.total}
          >
            <TaskList<DashboardTask>
              tasks={data.focusTasks.items}
              columns={focusColumns}
              onTaskClick={handleTaskClick}
              onTaskUpdate={handleTaskUpdate}
              showHeaders={false}
              emptyMessage="No focus tasks - check a task to add it to your focus list"
              hasMore={data.focusTasks.hasMore}
              isLoading={isLoading('focusTasks')}
              onLoadMore={() => loadMore('focusTasks', data.focusTasks.items.length)}
            />
          </DashboardSection>

          {/* Awaiting Review */}
          <DashboardSection
            title="Awaiting Review"
            icon={CircleDot}
            count={data.awaitingReview.total}
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

          {/* Unassigned Tasks - only show if there are unassigned tasks */}
          {data.unassignedTasks.items.length > 0 && (
            <DashboardSection
              title="Unassigned Quests"
              icon={UserX}
              count={data.unassignedTasks.total}
            >
              <TaskList<DashboardTask>
                tasks={data.unassignedTasks.items}
                columns={unassignedColumns}
                onTaskClick={handleTaskClick}
                onTaskUpdate={handleTaskUpdate}
                showHeaders={false}
                emptyMessage="All quests are assigned"
                hasMore={data.unassignedTasks.hasMore}
                isLoading={isLoading('unassignedTasks')}
                onLoadMore={() => loadMore('unassignedTasks', data.unassignedTasks.items.length)}
              />
            </DashboardSection>
          )}

          {/* My Tasks */}
          <DashboardSection
            title="My Quests"
            icon={ListTodo}
            count={data.myTasks.total}
            headerActions={
              <TaskGroupingSelect
                value={groupBy}
                onChange={setGroupBy}
                compact
              />
            }
          >
            <TaskList<DashboardTask>
              tasks={groups ? undefined : data.myTasks.items}
              groups={groups || undefined}
              columns={myTasksColumns}
              onTaskClick={handleTaskClick}
              onTaskUpdate={handleTaskUpdate}
              showHeaders={false}
              emptyMessage="No tasks assigned to you"
              hasMore={data.myTasks.hasMore}
              isLoading={isLoading('myTasks')}
              onLoadMore={() => loadMore('myTasks', data.myTasks.items.length)}
            />
          </DashboardSection>
        </div>

        {/* Right Column - Projects & Activity */}
        <div className="space-y-6">
          {/* Timeclock Issues */}
          <TimeclockIssues />

          {/* Retainer Alerts */}
          {data.retainerAlerts.length > 0 && (
            <DashboardSection title="Retainer Alerts" icon={AlertTriangle}>
              <RetainerAlert alerts={data.retainerAlerts} />
            </DashboardSection>
          )}

          {/* My Projects */}
          <DashboardSection
            title="My Pacts"
            icon={FolderKanban}
            action={{ label: 'View All', href: '/projects' }}
          >
            <ProjectQuickList
              projects={data.myProjects}
              emptyMessage="No active projects"
              maxItems={5}
            />
          </DashboardSection>

          {/* Recent Completions */}
          <DashboardSection title="Recent Completions" icon={CheckCircle2}>
            {data.recentCompletions.length > 0 ? (
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
            ) : (
              <p className="text-center py-4 text-text-sub">
                No recent completions
              </p>
            )}
          </DashboardSection>
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
