'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Clock,
  ListTodo,
  AlertCircle,
  Calendar,
  PlayCircle,
  Timer,
  Zap,
} from 'lucide-react';
import { TechDashboardData, DashboardTask } from '@/lib/hooks/use-dashboard';
import { useTimer } from '@/lib/contexts/timer-context';
import { useToggleFocus, useUpdateTask } from '@/lib/hooks/use-tasks';
import { DashboardSection } from './dashboard-section';
import { StatCard } from './stat-card';
import { TaskQuickList } from './task-quick-list';
import { TaskPeekDrawer } from '@/components/domain/tasks/task-peek-drawer';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/calculations/energy';
import { formatElapsedTime } from '@/lib/utils/time';
import { TaskList, type TaskListColumn } from '@/components/ui/task-list';
import {
  focusColumn,
  statusColumn,
  titleColumn,
  actionsColumn,
  clientProjectSiteColumn,
  rangedEstimateColumn,
} from '@/components/ui/task-list-columns';

interface TechOverlookProps {
  data: TechDashboardData;
}

export function TechOverlook({ data }: TechOverlookProps) {
  const router = useRouter();
  const timer = useTimer();
  const toggleFocus = useToggleFocus();
  const updateTask = useUpdateTask();

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

  // Separate tasks by focus flag
  const focusTasks = data.myTasks.filter((t) => t.is_focus);

  // Column configs for different task lists
  const focusColumns: TaskListColumn<DashboardTask>[] = [
    focusColumn<DashboardTask>({ onToggleFocus: handleToggleFocus }),
    statusColumn({ editable: true }),
    titleColumn({ editable: true }),
    clientProjectSiteColumn(),
    rangedEstimateColumn(),
    actionsColumn<DashboardTask>({ onViewDetails: (task) => router.push(`/tasks/${task.id}`) }),
  ];

  const myTasksColumns: TaskListColumn<DashboardTask>[] = [
    focusColumn<DashboardTask>({ onToggleFocus: handleToggleFocus }),
    statusColumn({ editable: true }),
    titleColumn({ editable: true }),
    clientProjectSiteColumn(),
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

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Time Today"
          value={formatDuration(data.timeTodayMinutes)}
          icon={Clock}
          variant={data.timeTodayMinutes === 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Time This Week"
          value={formatDuration(data.timeThisWeekMinutes)}
          icon={Calendar}
        />
        <StatCard
          label="In Progress"
          value={data.inProgressTasks.length}
          icon={PlayCircle}
          variant={data.inProgressTasks.length > 3 ? 'warning' : 'default'}
        />
        <StatCard
          label="Blocked"
          value={data.blockedTasks.length}
          icon={AlertCircle}
          variant={data.blockedTasks.length > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* Missing Time Alert */}
      {data.timeTodayMinutes === 0 && !timer.isRunning && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <Clock className="h-5 w-5 text-amber-500" />
          <div className="flex-1">
            <div className="font-medium text-text-main">No time logged today</div>
            <div className="text-sm text-text-sub">
              Start a timer on one of your quests to begin tracking
            </div>
          </div>
          <Link href="/chronicles">
            <Button variant="secondary" size="sm">
              Log Time
            </Button>
          </Link>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - My Quests */}
        <div className="lg:col-span-2 space-y-6">
          {/* Focus Quests */}
          <DashboardSection
            title="Focus Quests"
            icon={Zap}
            action={{ label: 'View All', href: '/tasks?my_tasks=true' }}
          >
            <TaskList<DashboardTask>
              tasks={focusTasks}
              columns={focusColumns}
              onTaskClick={handleTaskClick}
              onTaskUpdate={handleTaskUpdate}
              showHeaders={false}
              emptyMessage="No focus tasks - check a task to add it to your focus list"
            />
          </DashboardSection>

          {/* All My Quests */}
          <DashboardSection
            title="My Quests"
            icon={ListTodo}
            action={{ label: 'View All', href: '/tasks?my_tasks=true' }}
          >
            <TaskList<DashboardTask>
              tasks={data.myTasks.slice(0, 10)}
              columns={myTasksColumns}
              onTaskClick={handleTaskClick}
              onTaskUpdate={handleTaskUpdate}
              showHeaders={false}
              emptyMessage="No quests assigned to you"
            />
          </DashboardSection>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Blocked Tasks */}
          {data.blockedTasks.length > 0 && (
            <DashboardSection title="Blocked" icon={AlertCircle}>
              <TaskQuickList
                tasks={data.blockedTasks}
                onTaskClick={handleTaskIdClick}
                maxItems={5}
              />
            </DashboardSection>
          )}

          {/* Upcoming Due Dates */}
          {data.upcomingTasks.length > 0 && (
            <DashboardSection title="Upcoming" icon={Calendar}>
              <TaskQuickList
                tasks={data.upcomingTasks}
                onTaskClick={handleTaskIdClick}
                showDueDate
                maxItems={5}
              />
            </DashboardSection>
          )}

          {/* Recent Time Entries */}
          <DashboardSection
            title="Recent Time"
            icon={Clock}
            action={{ label: 'View All', href: '/chronicles' }}
          >
            {data.recentTimeEntries.length > 0 ? (
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
            ) : (
              <p className="text-center py-4 text-text-sub">No recent time entries</p>
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
