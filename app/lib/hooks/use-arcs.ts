'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Clarity Phase 1/3 — Arc (lightweight micro-project grouping) reads/writes for the Oracle
// Today section and the arc board (/oracle/arcs/[id]).

export type ArcStatus = 'empty' | 'open' | 'complete';

export interface ArcTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  due_date: string | null;
  assignee_id: string | null;
  assignee: { id: string; name: string } | null;
  needs_review: boolean;
  approved: boolean;
}

export interface ArcDetail {
  id: string;
  name: string;
  description: string | null;
  status: ArcStatus;
  client_id: string | null;
  client: { id: string; name: string } | null;
  project_id: string | null;
  project: { id: string; name: string; status: string } | null;
  origin_session_external_id: string | null;
  closed_at: string | null;
  // Clarity Phase 5 — the Soothsayer's snooze action.
  snoozed_until: string | null;
  task_count: number;
  created_at: string;
  updated_at: string;
  tasks: ArcTask[];
}

export interface ArcSummary {
  id: string;
  name: string;
  description: string | null;
  status: ArcStatus;
  client_id: string | null;
  client: { id: string; name: string } | null;
  project_id: string | null;
  project: { id: string; name: string; status: string } | null;
  origin_session_external_id: string | null;
  closed_at: string | null;
  // Clarity Phase 5 — the Soothsayer's snooze action.
  snoozed_until: string | null;
  task_count: number;
  created_at: string;
  updated_at: string;
}

export interface ArcsResponse {
  arcs: ArcSummary[];
  total: number;
}

export const arcKeys = {
  all: ['arcs'] as const,
  list: (status?: string) => [...arcKeys.all, 'list', status ?? 'any'] as const,
  detail: (id: string) => [...arcKeys.all, 'detail', id] as const,
};

export function useArcs(status?: ArcStatus) {
  return useQuery({
    queryKey: arcKeys.list(status),
    queryFn: () => apiClient.get<ArcsResponse>('/arcs', { params: status ? { status } : undefined }),
  });
}

export function useArc(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: arcKeys.detail(id),
    queryFn: () => apiClient.get<ArcDetail>(`/arcs/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

export function useCloseArc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, close }: { id: string; close: boolean }) =>
      apiClient.patch<ArcDetail>(`/arcs/${id}`, { closed_at: close ? new Date().toISOString() : null }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: arcKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: arcKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update arc');
    },
  });
}

// Clarity Phase 5 — the Soothsayer's snooze action. `snoozedUntil: null` un-snoozes.
export function useSnoozeArc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, snoozedUntil }: { id: string; snoozedUntil: string | null }) =>
      apiClient.patch<ArcDetail>(`/arcs/${id}`, { snoozed_until: snoozedUntil }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: arcKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: arcKeys.all });
      queryClient.invalidateQueries({ queryKey: ['soothsayer'] });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update snooze');
    },
  });
}
