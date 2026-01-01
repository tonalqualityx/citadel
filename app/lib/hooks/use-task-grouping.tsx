'use client';

import * as React from 'react';
import { Building, FolderKanban, Globe } from 'lucide-react';
import type { TaskListGroup, TaskLike } from '@/components/ui/task-list';

// ============================================
// TYPES
// ============================================

export type TaskGroupBy = 'none' | 'client' | 'project' | 'site';

// Minimal task fields needed for grouping (extends TaskLike for TaskListGroup compatibility)
export interface TaskWithGroupingFields extends TaskLike {
  project?: {
    id: string;
    name: string;
    client?: { id: string; name: string } | null;
    site?: { id: string; name: string } | null;
  } | null;
  client?: { id: string; name: string } | null;
}

export interface UseTaskGroupingOptions {
  storageKey?: string;
  defaultGroupBy?: TaskGroupBy;
}

export interface UseTaskGroupingResult<T extends TaskLike> {
  groupBy: TaskGroupBy;
  setGroupBy: (value: TaskGroupBy) => void;
  groups: TaskListGroup<T>[] | null; // null means use flat list
}

// ============================================
// GROUP BY OPTIONS
// ============================================

export const groupByOptions = [
  { value: 'none', label: 'No Grouping' },
  { value: 'client', label: 'By Client' },
  { value: 'project', label: 'By Project' },
  { value: 'site', label: 'By Site' },
];

// ============================================
// GROUPING LOGIC
// ============================================

const UNGROUPED_KEY = '__ungrouped__';

function getGroupKeyAndName(
  task: TaskWithGroupingFields,
  groupBy: TaskGroupBy
): { key: string; name: string } {
  switch (groupBy) {
    case 'client': {
      const clientId = task.project?.client?.id || task.client?.id;
      const clientName = task.project?.client?.name || task.client?.name;
      return {
        key: clientId || UNGROUPED_KEY,
        name: clientName || 'Ungrouped',
      };
    }
    case 'project': {
      return {
        key: task.project?.id || UNGROUPED_KEY,
        name: task.project?.name || 'Ad-hoc Tasks',
      };
    }
    case 'site': {
      return {
        key: task.project?.site?.id || UNGROUPED_KEY,
        name: task.project?.site?.name || 'No Site',
      };
    }
    default:
      return { key: UNGROUPED_KEY, name: 'All Tasks' };
  }
}

function getGroupIcon(groupBy: TaskGroupBy): React.ReactNode {
  switch (groupBy) {
    case 'client':
      return <Building className="h-4 w-4" />;
    case 'project':
      return <FolderKanban className="h-4 w-4" />;
    case 'site':
      return <Globe className="h-4 w-4" />;
    default:
      return null;
  }
}

function groupTasks<T extends TaskWithGroupingFields>(
  tasks: T[],
  groupBy: TaskGroupBy
): TaskListGroup<T>[] | null {
  if (groupBy === 'none') return null;

  const groupMap = new Map<string, { name: string; tasks: T[] }>();

  tasks.forEach((task) => {
    const { key, name } = getGroupKeyAndName(task, groupBy);

    if (!groupMap.has(key)) {
      groupMap.set(key, { name, tasks: [] });
    }
    groupMap.get(key)!.tasks.push(task);
  });

  // Convert to TaskListGroup format, sorted alphabetically with ungrouped at end
  const groups = Array.from(groupMap.entries())
    .sort((a, b) => {
      // Ungrouped always at the end
      if (a[0] === UNGROUPED_KEY) return 1;
      if (b[0] === UNGROUPED_KEY) return -1;
      // Alphabetical sort by name
      return a[1].name.localeCompare(b[1].name);
    })
    .map(([id, { name, tasks }]) => ({
      id,
      title: `${name} (${tasks.length})`,
      icon: getGroupIcon(groupBy),
      tasks,
      collapsible: true,
      defaultCollapsed: false,
    }));

  return groups;
}

// ============================================
// HOOK
// ============================================

export function useTaskGrouping<T extends TaskWithGroupingFields>(
  tasks: T[],
  options?: UseTaskGroupingOptions
): UseTaskGroupingResult<T> {
  const { storageKey = 'citadel-task-grouping', defaultGroupBy = 'none' } = options || {};

  // Initialize with default, update from localStorage in effect (SSR-safe)
  const [groupBy, setGroupByState] = React.useState<TaskGroupBy>(defaultGroupBy);
  const [isHydrated, setIsHydrated] = React.useState(false);

  // Load from localStorage after mount
  React.useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored && ['none', 'client', 'project', 'site'].includes(stored)) {
      setGroupByState(stored as TaskGroupBy);
    }
    setIsHydrated(true);
  }, [storageKey]);

  // Setter that persists to localStorage
  const setGroupBy = React.useCallback(
    (value: TaskGroupBy) => {
      setGroupByState(value);
      localStorage.setItem(storageKey, value);
    },
    [storageKey]
  );

  // Memoize groups calculation
  const groups = React.useMemo(() => {
    // Don't compute groups until hydrated to avoid mismatch
    if (!isHydrated) return null;
    return groupTasks(tasks, groupBy);
  }, [tasks, groupBy, isHydrated]);

  return {
    groupBy,
    setGroupBy,
    groups,
  };
}
