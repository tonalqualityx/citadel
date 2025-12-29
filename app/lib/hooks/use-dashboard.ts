import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

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
  myTasks: DashboardTask[];
  upcomingTasks: DashboardTask[];
  blockedTasks: DashboardTask[];
  inProgressTasks: DashboardTask[];
  timeThisWeekMinutes: number;
  timeTodayMinutes: number;
}

// PM user dashboard data
export interface PmDashboardData extends DashboardBaseData {
  focusTasks: DashboardTask[];
  awaitingReview: DashboardTask[];
  unassignedTasks: DashboardTask[];
  myTasks: DashboardTask[]; // Tasks assigned to current user
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

export type DashboardData = TechDashboardData | PmDashboardData | AdminDashboardData;

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.get<DashboardData>('/dashboard'),
    refetchInterval: 60000, // Refresh every minute
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
