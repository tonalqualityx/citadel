import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import * as React from 'react';

// Paginated list structure
export interface PaginatedList<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// Base data that all roles have
export interface DashboardBaseData {
  role: 'tech' | 'pm' | 'admin';
  activeTimer: {
    id: string;
    started_at: string;
    task: { id: string; title: string } | null;
    project: { id: string; name: string } | null;
  } | null;
  recentTimeEntries: {
    id: string;
    started_at: string;
    duration: number;
    description: string | null;
    task: { id: string; title: string } | null;
    project: { id: string; name: string } | null;
  }[];
}

// Task summary used in dashboard lists
export interface DashboardTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  is_focus: boolean;
  due_date: string | null;
  energy_estimate: number | null;
  mystery_factor: string;
  battery_impact: string;
  estimated_minutes: number | null;
  time_logged_minutes?: number; // Total time logged on this task
  needs_review?: boolean;
  approved?: boolean;
  assignee?: { id: string; name: string } | null;
  project: {
    id: string;
    name: string;
    status?: string;
    client: { id: string; name: string } | null;
    site: { id: string; name: string } | null;
  } | null;
  updated_at?: string;
}

// Project summary used in dashboard lists
export interface DashboardProject {
  id: string;
  name: string;
  status: string;
  client: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
  taskCount: number;
}

// Tech user dashboard data
export interface TechDashboardData extends DashboardBaseData {
  myTasks: PaginatedList<DashboardTask>;
  upcomingTasks: DashboardTask[];
  blockedTasks: DashboardTask[];
  inProgressTasks: DashboardTask[];
  timeThisWeekMinutes: number;
  timeTodayMinutes: number;
}

// PM user dashboard data
export interface PmDashboardData extends DashboardBaseData {
  focusTasks: PaginatedList<DashboardTask>;
  awaitingReview: PaginatedList<DashboardTask>;
  unassignedTasks: PaginatedList<DashboardTask>;
  myTasks: PaginatedList<DashboardTask>;
  myProjects: DashboardProject[];
  retainerAlerts: {
    client_id: string;
    client_name: string;
    retainer_hours: number;
    used_minutes: number;
    percent_used: number;
  }[];
  recentCompletions: {
    id: string;
    title: string;
    assignee: { id: string; name: string } | null;
    project: { id: string; name: string } | null;
    completed_at: string;
  }[];
}

// Admin user dashboard data
export interface AdminDashboardData extends PmDashboardData {
  allActiveProjects: DashboardProject[];
  teamUtilization: {
    user_id: string;
    user_name: string;
    minutes_this_week: number;
    hours_this_week: number;
  }[];
  systemStats: {
    activeProjectCount: number;
    openTaskCount: number;
    activeUserCount: number;
    totalTimeThisMonthMinutes: number;
  };
}

// List types for load more
export type DashboardListType = 'myTasks' | 'focusTasks' | 'awaitingReview' | 'unassignedTasks';

export type DashboardData = TechDashboardData | PmDashboardData | AdminDashboardData;

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.get<DashboardData>('/dashboard'),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

// Type guards to narrow dashboard data by role
export function isTechDashboard(data: DashboardData): data is TechDashboardData {
  return data.role === 'tech';
}

export function isPmDashboard(data: DashboardData): data is PmDashboardData {
  return data.role === 'pm';
}

export function isAdminDashboard(data: DashboardData): data is AdminDashboardData {
  return data.role === 'admin';
}

// Hook for loading more items in a dashboard list
export function useLoadMoreDashboard() {
  const queryClient = useQueryClient();
  const [loadingLists, setLoadingLists] = React.useState<Set<DashboardListType>>(new Set());

  const loadMore = React.useCallback(async (listType: DashboardListType, currentCount: number) => {
    setLoadingLists(prev => new Set(prev).add(listType));

    try {
      const result = await apiClient.get<PaginatedList<DashboardTask>>(
        `/dashboard/load-more?list=${listType}&skip=${currentCount}`
      );

      // Update the dashboard cache with the new items
      queryClient.setQueryData<DashboardData>(['dashboard'], (oldData) => {
        if (!oldData) return oldData;

        const listKey = listType as keyof DashboardData;
        const existingList = oldData[listKey] as PaginatedList<DashboardTask> | undefined;

        if (!existingList || !('items' in existingList)) {
          return oldData;
        }

        return {
          ...oldData,
          [listType]: {
            items: [...existingList.items, ...result.items],
            total: result.total,
            hasMore: result.hasMore,
          },
        };
      });

      return result;
    } finally {
      setLoadingLists(prev => {
        const next = new Set(prev);
        next.delete(listType);
        return next;
      });
    }
  }, [queryClient]);

  const isLoading = React.useCallback((listType: DashboardListType) => {
    return loadingLists.has(listType);
  }, [loadingLists]);

  return { loadMore, isLoading };
}

// Timeclock issues types
export interface TimeclockIssueTask {
  id: string;
  title: string;
  completed_at: string | null;
  project: { id: string; name: string; client: { id: string; name: string } | null } | null;
  client: { id: string; name: string } | null;
}

export interface TimeclockIssueTimer {
  id: string;
  started_at: string;
  description: string | null;
  task: { id: string; title: string } | null;
  project: { id: string; name: string } | null;
}

export interface TimeclockIssuesData {
  completedTasksNoTime: TimeclockIssueTask[];
  runningTimers: TimeclockIssueTimer[];
  hasIssues: boolean;
}

export function useTimeclockIssues() {
  return useQuery({
    queryKey: ['dashboard', 'timeclock-issues'],
    queryFn: () => apiClient.get<TimeclockIssuesData>('/dashboard/timeclock-issues'),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useMarkNoTimeNeeded() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      return apiClient.patch(`/tasks/${taskId}`, { no_time_needed: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'timeclock-issues'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useStopRunningTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryId, endTime }: { entryId: string; endTime?: Date }) => {
      return apiClient.patch(`/time-entries/${entryId}/stop`, {
        ended_at: endTime?.toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'timeclock-issues'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
    },
  });
}
