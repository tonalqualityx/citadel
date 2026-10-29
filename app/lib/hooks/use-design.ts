'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import type { DrawerResponse } from '@/lib/design/projections';

// Designer Portal hooks (design 7.1). Only /api/design/* routes: a designer is 403 on most others.

export type DesignDrawer = DrawerResponse;
export type DrawerProject = DrawerResponse['projects'][number];
export type DrawerTask = DrawerProject['phases'][number]['tasks'][number];

export interface SessionListItem {
  id: string;
  task: { id: string; title: string };
  site: { name: string };
  status: string;
  last_publish: { id: string; status: string; finished_at: string | null } | null;
  cost_usd: number;
  budget_usd: number;
  updated_at: string;
}

export const designKeys = {
  all: ['design'] as const,
  drawer: (projectId?: string | null) => [...designKeys.all, 'drawer', projectId ?? 'all'] as const,
  sessions: (status?: string | null) => [...designKeys.all, 'sessions', status ?? 'all'] as const,
};

/** Poll cadence: the drawer has no next_poll_ms, so a fixed 15 s foreground, 30 s when the tab is hidden. */
export const DRAWER_POLL_MS = 15_000;
export const HIDDEN_POLL_MS = 30_000;

/** The refetch interval for a poll: next_poll_ms when the server gave one, slowed to 30 s when hidden. */
export function pollInterval(nextPollMs?: number | null): number {
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (hidden) return Math.max(HIDDEN_POLL_MS, nextPollMs ?? 0);
  return nextPollMs && nextPollMs > 0 ? nextPollMs : DRAWER_POLL_MS;
}

export function useDesignDrawer(projectId?: string | null) {
  return useQuery({
    queryKey: designKeys.drawer(projectId),
    queryFn: () => apiClient.get<DesignDrawer>('/design/tasks', projectId ? { params: { project_id: projectId } } : undefined),
    refetchInterval: (query) => pollInterval((query.state.data as { next_poll_ms?: number } | undefined)?.next_poll_ms),
  });
}

export function useDesignSessions(status?: string | null) {
  return useQuery({
    queryKey: designKeys.sessions(status),
    queryFn: () => apiClient.get<{ sessions: SessionListItem[] }>('/design/sessions', status ? { params: { status } } : undefined),
    refetchInterval: () => pollInterval(),
  });
}

/** POST /api/design/sessions {task_id}: idempotent per task (201 new, 200 existing). */
export function useOpenDesignSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => apiClient.post<{ session: { id: string } }>('/design/sessions', { task_id: taskId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designKeys.all });
    },
    onError: (error) => showToast.apiError(error, 'Could not open the session'),
  });
}
