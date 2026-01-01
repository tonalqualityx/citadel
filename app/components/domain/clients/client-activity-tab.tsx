'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Folder, CheckSquare, Clock, AlertCircle } from 'lucide-react';
import {
  useClientActivity,
  type ClientActivityFilters,
  type ClientActivityProject,
  type ClientActivityTask,
} from '@/lib/hooks/use-clients';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface ClientActivityTabProps {
  clientId: string;
}

const PROJECT_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
] as const;

const TASK_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'support', label: 'Support' },
  { value: 'billable', label: 'Billable' },
] as const;

const TASK_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
] as const;

function getProjectStatusVariant(status: string): 'default' | 'success' | 'warning' {
  switch (status) {
    case 'active':
    case 'in_progress':
      return 'default';
    case 'completed':
    case 'launched':
      return 'success';
    case 'on_hold':
    case 'blocked':
      return 'warning';
    default:
      return 'default';
  }
}

function getTaskStatusVariant(status: string): 'default' | 'success' | 'warning' {
  switch (status) {
    case 'done':
      return 'success';
    case 'blocked':
      return 'warning';
    default:
      return 'default';
  }
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ClientActivityTab({ clientId }: ClientActivityTabProps) {
  const [filters, setFilters] = useState<ClientActivityFilters>({
    projectStatus: 'open',
    taskType: 'all',
    taskStatus: 'open',
  });

  const { data, isLoading, error } = useClientActivity(clientId, filters);

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
            title="Error loading activity"
            description="There was a problem loading the client activity."
          />
        </CardContent>
      </Card>
    );
  }

  const { projects = [], tasks = [], stats } = data || {};

  return (
    <div className="space-y-6">
      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-sm text-text-sub">Open Projects</div>
            <div className="text-2xl font-semibold text-text-main">{stats?.open_projects ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-sm text-text-sub">Open Tasks</div>
            <div className="text-2xl font-semibold text-text-main">{stats?.open_tasks ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-sm text-text-sub">Support Tasks (This Month)</div>
            <div className="text-2xl font-semibold text-text-main">{stats?.support_tasks_this_month ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Projects Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Folder className="h-4 w-4" />
            Projects
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-sub">Status:</span>
            <select
              value={filters.projectStatus || 'open'}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  projectStatus: e.target.value as 'open' | 'completed' | 'all',
                }))
              }
              className="text-sm border border-border rounded px-2 py-1 bg-surface"
            >
              {PROJECT_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-text-sub text-sm">No projects found.</p>
          ) : (
            <div className="space-y-2">
              {projects.map((project: ClientActivityProject) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block p-3 rounded-lg border border-border hover:bg-surface-alt transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-text-main">{project.name}</span>
                      <Badge variant={getProjectStatusVariant(project.status)}>
                        {formatStatus(project.status)}
                      </Badge>
                    </div>
                    <div className="text-sm text-text-sub">
                      {project.task_count} task{project.task_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  {project.target_date && (
                    <div className="text-xs text-text-sub mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Target: {new Date(project.target_date).toLocaleDateString()}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tasks Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            Tasks
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-sub">Type:</span>
              <select
                value={filters.taskType || 'all'}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    taskType: e.target.value as 'support' | 'billable' | 'all',
                  }))
                }
                className="text-sm border border-border rounded px-2 py-1 bg-surface"
              >
                {TASK_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-sub">Status:</span>
              <select
                value={filters.taskStatus || 'open'}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    taskStatus: e.target.value as 'open' | 'completed' | 'all',
                  }))
                }
                className="text-sm border border-border rounded px-2 py-1 bg-surface"
              >
                {TASK_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-text-sub text-sm">No tasks found.</p>
          ) : (
            <div className="space-y-2">
              {tasks.map((task: ClientActivityTask) => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="block p-3 rounded-lg border border-border hover:bg-surface-alt transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-text-main">{task.title}</span>
                      <Badge variant={getTaskStatusVariant(task.status)}>
                        {formatStatus(task.status)}
                      </Badge>
                      {task.is_support && (
                        <Badge variant="default">Support</Badge>
                      )}
                    </div>
                    {task.assignee && (
                      <span className="text-sm text-text-sub">{task.assignee.name}</span>
                    )}
                  </div>
                  {task.project && (
                    <div className="text-xs text-text-sub mt-1">
                      {task.project.name}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
