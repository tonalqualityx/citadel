'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface TimeEntry {
  id: string;
  user: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
  project: {
    id: string;
    name: string;
    client: { id: string; name: string } | null;
  } | null;
  started_at: string;
  ended_at: string | null;
  duration: number;
  description: string | null;
  is_billable: boolean;
  hourly_rate: number | null;
}

export interface TimeGroup {
  key: string;
  label: string;
  minutes: number;
  hours: number;
  count: number;
}

export interface TimeReportTotals {
  totalMinutes: number;
  totalHours: number;
  billableMinutes: number;
  billableHours: number;
  billablePercent: number;
  entryCount: number;
}

export interface TimeReportResponse {
  entries: TimeEntry[];
  grouped: TimeGroup[];
  totals: TimeReportTotals;
}

export interface TimeReportFilters {
  start?: string;
  end?: string;
  user_id?: string;
  client_id?: string;
  project_id?: string;
  group_by?: 'day' | 'week' | 'project' | 'user' | 'client';
}

export function useTimeReports(filters: TimeReportFilters = {}) {
  return useQuery({
    queryKey: ['time-reports', filters],
    queryFn: async (): Promise<TimeReportResponse> => {
      const params = new URLSearchParams();
      if (filters.start) params.set('start', filters.start);
      if (filters.end) params.set('end', filters.end);
      if (filters.user_id) params.set('user_id', filters.user_id);
      if (filters.client_id) params.set('client_id', filters.client_id);
      if (filters.project_id) params.set('project_id', filters.project_id);
      if (filters.group_by) params.set('group_by', filters.group_by);

      const queryString = params.toString();
      return apiClient.get<TimeReportResponse>(
        `/reports/time${queryString ? `?${queryString}` : ''}`
      );
    },
    enabled: !!filters.start && !!filters.end,
  });
}
