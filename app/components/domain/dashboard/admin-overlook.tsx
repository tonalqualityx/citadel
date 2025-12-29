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
  BarChart3,
  Activity,
} from 'lucide-react';
import { AdminDashboardData } from '@/lib/hooks/use-dashboard';
import { useTimer } from '@/lib/contexts/timer-context';
import { DashboardSection } from './dashboard-section';
import { StatCard } from './stat-card';
import { TaskQuickList } from './task-quick-list';
import { ProjectQuickList } from './project-quick-list';
import { RetainerAlert } from './retainer-alert';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/calculations/energy';
import { formatElapsedTime } from '@/lib/utils/time';

interface AdminOverlookProps {
  data: AdminDashboardData;
}

export function AdminOverlook({ data }: AdminOverlookProps) {
  const router = useRouter();
  const timer = useTimer();

  const handleTaskClick = (taskId: string) => {
    router.push(`/tasks/${taskId}`);
  };

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

      {/* System Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Active Pacts"
          value={data.systemStats.activeProjectCount}
          icon={FolderKanban}
        />
        <StatCard
          label="Open Quests"
          value={data.systemStats.openTaskCount}
          icon={Activity}
        />
        <StatCard
          label="Active Users"
          value={data.systemStats.activeUserCount}
          icon={Users}
        />
        <StatCard
          label="Time This Month"
          value={formatDuration(data.systemStats.totalTimeThisMonthMinutes)}
          icon={BarChart3}
        />
      </div>

      {/* Retainer Alerts */}
      {data.retainerAlerts.length > 0 && (
        <DashboardSection title="Retainer Alerts" icon={AlertTriangle}>
          <RetainerAlert alerts={data.retainerAlerts} />
        </DashboardSection>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Tasks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Focus Tasks */}
          <DashboardSection
            title="Focus Quests"
            icon={Zap}
            action={{ label: 'View All', href: '/tasks?status=in_progress&priority=1,2' }}
          >
            <TaskQuickList
              tasks={data.focusTasks}
              emptyMessage="No high-priority tasks in progress"
              onTaskClick={handleTaskClick}
              showAssignee
            />
          </DashboardSection>

          {/* Awaiting Review */}
          <DashboardSection
            title="Awaiting Review"
            icon={CircleDot}
            action={{ label: 'View All', href: '/tasks?status=review' }}
          >
            <TaskQuickList
              tasks={data.awaitingReview}
              emptyMessage="No tasks awaiting review"
              onTaskClick={handleTaskClick}
              showAssignee
            />
          </DashboardSection>

          {/* Unassigned Tasks */}
          <DashboardSection
            title="Unassigned Quests"
            icon={UserX}
            action={{ label: 'View All', href: '/tasks?assignee=unassigned' }}
          >
            <TaskQuickList
              tasks={data.unassignedTasks}
              emptyMessage="All quests are assigned"
              onTaskClick={handleTaskClick}
            />
          </DashboardSection>

          {/* All Active Projects */}
          <DashboardSection
            title="All Active Pacts"
            icon={FolderKanban}
            action={{ label: 'View All', href: '/projects' }}
          >
            <ProjectQuickList
              projects={data.allActiveProjects}
              emptyMessage="No active projects"
              maxItems={10}
            />
          </DashboardSection>
        </div>

        {/* Right Column - Team & Activity */}
        <div className="space-y-6">
          {/* Team Utilization */}
          <DashboardSection title="Team Utilization (This Week)" icon={Users}>
            {data.teamUtilization.length > 0 ? (
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
            ) : (
              <p className="text-center py-4 text-text-sub">
                No time logged this week
              </p>
            )}
          </DashboardSection>

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
    </div>
  );
}
