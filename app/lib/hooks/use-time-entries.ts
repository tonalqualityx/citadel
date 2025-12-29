import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface TimeEntry {
  id: string;
  user_id: string;
  task_id: string | null;
  project_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration: number;
  is_running: boolean;
  description: string | null;
  is_billable: boolean;
  user: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
  project: {
    id: string;
    name: string;
    client: { id: string; name: string } | null;
  } | null;
}

interface TimeEntriesResponse {
  entries: TimeEntry[];
  total: number;
  page: number;
  totalPages: number;
}

interface TimeEntriesParams {
  page?: number;
  limit?: number;
  user_id?: string;
  task_id?: string;
  project_id?: string;
  start_date?: string;
  end_date?: string;
}

export const timeEntryKeys = {
  all: ['time-entries'] as const,
  lists: () => [...timeEntryKeys.all, 'list'] as const,
  list: (params: TimeEntriesParams) => [...timeEntryKeys.lists(), params] as const,
  detail: (id: string) => [...timeEntryKeys.all, 'detail', id] as const,
};

export function useTimeEntries(params: TimeEntriesParams = {}) {
  const queryString = new URLSearchParams();
  if (params.page) queryString.set('page', params.page.toString());
  if (params.limit) queryString.set('limit', params.limit.toString());
  if (params.user_id) queryString.set('user_id', params.user_id);
  if (params.task_id) queryString.set('task_id', params.task_id);
  if (params.project_id) queryString.set('project_id', params.project_id);
  if (params.start_date) queryString.set('start_date', params.start_date);
  if (params.end_date) queryString.set('end_date', params.end_date);

  const url = `/time-entries${queryString.toString() ? `?${queryString}` : ''}`;

  return useQuery({
    queryKey: timeEntryKeys.list(params),
    queryFn: () => apiClient.get<TimeEntriesResponse>(url),
  });
}

export function useTimeEntry(id: string) {
  return useQuery({
    queryKey: timeEntryKeys.detail(id),
    queryFn: () => apiClient.get<{ entry: TimeEntry }>(`/time-entries/${id}`),
    enabled: !!id,
  });
}

interface CreateTimeEntryInput {
  task_id?: string | null;
  project_id?: string | null;
  started_at: string;
  ended_at?: string | null;
  duration: number;
  description?: string | null;
  is_billable?: boolean;
}

export function useCreateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTimeEntryInput) =>
      apiClient.post<{ entry: TimeEntry }>('/time-entries', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.lists() });
    },
  });
}

interface UpdateTimeEntryInput {
  task_id?: string | null;
  project_id?: string | null;
  started_at?: string;
  ended_at?: string | null;
  duration?: number;
  description?: string | null;
  is_billable?: boolean;
}

export function useUpdateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTimeEntryInput }) =>
      apiClient.patch<{ entry: TimeEntry }>(`/time-entries/${id}`, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.detail(id) });
    },
  });
}

export function useDeleteTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/time-entries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.lists() });
    },
  });
}
