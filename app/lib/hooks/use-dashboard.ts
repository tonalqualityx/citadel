import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import * as React from 'react';

// Task sort options
export type TaskSortBy = 'priority' | 'due_date' | 'estimate';

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
  client?: { id: string; name: string } | null; // Direct client for ad-hoc tasks
  site?: { id: string; name: string } | null; // Direct site for ad-hoc tasks
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
  completedToday: {
    id: string;
    title: string;
    energy_estimate: number | null;
    mystery_factor: string;
    completed_at: string;
    assignee: { id: string; name: string } | null;
    project: { id: string; name: string } | null;
  }[];
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
  completedToday: {
    id: string;
    title: string;
    energy_estimate: number | null;
    mystery_factor: string;
    completed_at: string;
    assignee: { id: string; name: string } | null;
    project: { id: string; name: string } | null;
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

interface DashboardOptions {
  orderBy?: TaskSortBy;
  enabled?: boolean;
}

// How many extra items each "load more" click fetches
export const DASHBOARD_PAGE_SIZE = 10;

function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

// Build the `&limit_<list>=N` query string from per-list loaded counts.
// Pure + exported so it can be unit tested without React.
export function buildListLimitParams(
  loadedCounts: Partial<Record<DashboardListType, number>>
): string {
  return (Object.entries(loadedCounts) as [DashboardListType, number | undefined][])
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([list, count]) => `&limit_${list}=${count}`)
    .join('');
}

export function useDashboard(options: DashboardOptions = {}) {
  const orderBy = options.orderBy || 'priority';
  const tz = getUserTimezone();
  const tzParam = tz ? `&tz=${encodeURIComponent(tz)}` : '';

  // Per-list loaded counts drive "load more". A list absent here uses the
  // server's default page size. Keeping the counts in the query key (and query
  // string) means any refetch — mutation invalidation OR the 30s interval —
  // returns the full loaded set instead of collapsing back to the first page.
  const [loadedCounts, setLoadedCounts] = React.useState<
    Partial<Record<DashboardListType, number>>
  >({});
  // Lists currently fetching an expansion, for per-list "loading more" spinners.
  const [loadingLists, setLoadingLists] = React.useState<Set<DashboardListType>>(new Set());

  const limitParams = buildListLimitParams(loadedCounts);

  const query = useQuery({
    queryKey: ['dashboard', { orderBy, tz, loadedCounts }],
    queryFn: () => apiClient.get<DashboardData>(`/dashboard?orderBy=${orderBy}${tzParam}${limitParams}`),
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: options.enabled !== false,
  });

  // Clear per-list loading flags once a fetch settles (data or error arrives).
  const { dataUpdatedAt, errorUpdatedAt } = query;
  React.useEffect(() => {
    setLoadingLists((prev) => (prev.size > 0 ? new Set() : prev));
  }, [dataUpdatedAt, errorUpdatedAt]);

  const loadMore = React.useCallback((listType: DashboardListType, currentCount: number) => {
    setLoadingLists((prev) => new Set(prev).add(listType));
    setLoadedCounts((prev) => ({
      ...prev,
      [listType]: Math.max(currentCount, prev[listType] ?? 0) + DASHBOARD_PAGE_SIZE,
    }));
  }, []);

  const isLoadingMore = React.useCallback(
    (listType: DashboardListType) => loadingLists.has(listType),
    [loadingLists]
  );

  return { ...query, loadMore, isLoadingMore };
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
