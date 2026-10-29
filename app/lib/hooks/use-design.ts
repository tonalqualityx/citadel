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
  session: (id: string) => [...designKeys.all, 'session', id] as const,
  feed: (id: string, after = 0) => [...designKeys.all, 'feed', id, after] as const,
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

// ---------------------------------------------------------------------------------------------------------
// Workspace: session load and feed poll (design 7.1)
// ---------------------------------------------------------------------------------------------------------

export interface SessionChange {
  id: string;
  [key: string]: unknown;
}

export interface DesignSessionView {
  id: string;
  task_id: string;
  site_id: string;
  project_id: string | null;
  designer_id: string;
  status: string;
  stale: boolean;
  preview_url: string | null;
  preview_sha: string | null;
  head_sha: string | null;
  base_sha: string | null;
  cost_usd: number | string;
  budget_usd: number | string;
  live_text: string | null;
  live_action: string | null;
  last_seq: number;
  publish_requested_at: string | null;
  last_publish_id: string | null;
  [key: string]: unknown;
}

export interface DesignSessionResponse {
  session: DesignSessionView;
  task: { id: string; title: string; description: string | null; requirements: unknown } | null;
  site: { name: string };
  pins: Array<Record<string, unknown>>;
  changes: SessionChange[];
  worker: { online: boolean; paused: boolean; last_heartbeat_at: string | null };
}

export interface DesignTimerView {
  running: boolean;
  elapsed_s: number;
}

export interface DesignFeedResponse {
  events: Array<{ seq: number; role: string; kind: string; payload: unknown; created_at: string }>;
  live: { text: string | null; action: string | null };
  status: string;
  stale: boolean;
  publish: {
    can_publish: boolean;
    reason?: string;
    main_role: string;
    precheck: unknown;
    running_publish_id?: string;
  };
  timer: DesignTimerView | null;
  cost_usd: number | string;
  budget_usd: number | string;
  preview_url: string | null;
  preview_sha: string | null;
  head_sha: string | null;
  last_heartbeat_at: string | null;
  next_poll_ms: number;
  last_seq: number;
  has_more: boolean;
}

/** Full workspace load. Not polled: the feed carries status, shas and preview_url. The GET itself counts as presence. */
export function useDesignSession(id: string) {
  return useQuery({
    queryKey: designKeys.session(id),
    queryFn: () => apiClient.get<DesignSessionResponse>(`/design/sessions/${id}`),
    refetchOnWindowFocus: false,
  });
}

/** True when the tab is visible. Read at call time, never cached. */
export function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Feed refetch interval: next_poll_ms from the last response while visible, 30 s (never faster) while hidden. */
export function feedInterval(nextPollMs?: number | null): number {
  if (!isDocumentVisible()) return HIDDEN_POLL_MS;
  return nextPollMs && nextPollMs > 0 ? nextPollMs : 5000;
}

export interface UseDesignFeedOptions {
  after?: number;
  limit?: number;
  enabled?: boolean;
}

/**
 * GET /api/design/sessions/:id/feed. `visible=1|0` is taken from document.visibilityState at each fetch (the server
 * keeps the automatic timer alive only on visible polls). The interval follows the last response's next_poll_ms.
 */
export function useDesignFeed(id: string, options: UseDesignFeedOptions = {}) {
  const after = options.after ?? 0;
  return useQuery({
    queryKey: designKeys.feed(id, after),
    queryFn: () =>
      apiClient.get<DesignFeedResponse>(`/design/sessions/${id}/feed`, {
        params: { after, ...(options.limit ? { limit: options.limit } : {}), visible: isDocumentVisible() ? 1 : 0 },
      }),
    enabled: options.enabled ?? true,
    refetchInterval: (query) => feedInterval((query.state.data as { next_poll_ms?: number } | undefined)?.next_poll_ms),
    refetchIntervalInBackground: true,
  });
}
