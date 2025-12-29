import { TaskStatus, ProjectStatus } from '@prisma/client';

// Valid task status transitions
const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  not_started: ['in_progress', 'blocked', 'abandoned'],
  in_progress: ['review', 'not_started', 'blocked', 'abandoned'],
  review: ['done', 'in_progress', 'abandoned'],
  done: ['in_progress'], // Reopen
  blocked: ['not_started', 'in_progress', 'abandoned'],
  abandoned: ['not_started'], // Resurrect
};

// Valid project status transitions
const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  quote: ['queue', 'cancelled'],
  queue: ['ready', 'quote', 'suspended', 'cancelled'],
  ready: ['in_progress', 'queue', 'suspended', 'cancelled'],
  in_progress: ['review', 'ready', 'suspended', 'cancelled'],
  review: ['done', 'in_progress', 'suspended'],
  done: ['in_progress'], // Reopen if needed
  suspended: ['queue', 'ready', 'in_progress', 'cancelled'],
  cancelled: [], // Terminal state
};

export function canTransitionTaskStatus(
  from: TaskStatus,
  to: TaskStatus
): boolean {
  if (from === to) return true;
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidNextTaskStatuses(current: TaskStatus): TaskStatus[] {
  return TASK_TRANSITIONS[current] ?? [];
}

export function canTransitionProjectStatus(
  from: ProjectStatus,
  to: ProjectStatus
): boolean {
  if (from === to) return true;
  return PROJECT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidNextProjectStatuses(current: ProjectStatus): ProjectStatus[] {
  return PROJECT_TRANSITIONS[current] ?? [];
}

// Project statuses where tasks are visible to assignees
const VISIBLE_PROJECT_STATUSES: ProjectStatus[] = [
  'ready',
  'in_progress',
  'review',
  'done',
];

export function isTaskVisibleToAssignee(
  taskProjectId: string | null,
  projectStatus: ProjectStatus | null
): boolean {
  // Ad-hoc tasks (no project) are always visible
  if (!taskProjectId) return true;

  // Check if project status allows visibility
  if (!projectStatus) return false;
  return VISIBLE_PROJECT_STATUSES.includes(projectStatus);
}

export function getProjectStatusLabel(status: ProjectStatus): string {
  const labels: Record<ProjectStatus, string> = {
    quote: 'Quote',
    queue: 'Queue',
    ready: 'Ready',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
    suspended: 'Suspended',
    cancelled: 'Cancelled',
  };
  return labels[status];
}

export function getTaskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
    blocked: 'Blocked',
    abandoned: 'Abandoned',
  };
  return labels[status];
}

export function getProjectStatusVariant(
  status: ProjectStatus
): 'default' | 'success' | 'warning' | 'error' | 'info' {
  const variants: Record<ProjectStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    quote: 'default',
    queue: 'info',
    ready: 'info',
    in_progress: 'warning',
    review: 'warning',
    done: 'success',
    suspended: 'error',
    cancelled: 'error',
  };
  return variants[status];
}

export function getTaskStatusVariant(
  status: TaskStatus
): 'default' | 'success' | 'warning' | 'error' | 'info' {
  const variants: Record<TaskStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    not_started: 'default',
    in_progress: 'info',
    review: 'warning',
    done: 'success',
    blocked: 'error',
    abandoned: 'default',
  };
  return variants[status];
}

export function getPriorityLabel(priority: number): string {
  const labels: Record<number, string> = {
    1: 'Critical',
    2: 'High',
    3: 'Medium',
    4: 'Low',
    5: 'Trivial',
  };
  return labels[priority] ?? 'Medium';
}

export function getPriorityVariant(
  priority: number
): 'default' | 'success' | 'warning' | 'error' | 'info' {
  const variants: Record<number, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    1: 'error',
    2: 'warning',
    3: 'default',
    4: 'info',
    5: 'default',
  };
  return variants[priority] ?? 'default';
}
