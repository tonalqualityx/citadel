'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import type { RitualBlocks } from '@/lib/waits/ritual-blocks';

// Wait record phase 1. The Work-mode blocks come from one route (GET /api/waits/mine) so the
// Seeing Stone and the ritual render exactly the same rows.

export type MyWaitBlocks = RitualBlocks & { summary: string };

export interface WaitDTO {
  id: string;
  kind: 'approval' | 'clock' | 'handoff' | 'meeting' | 'external' | 'switch';
  template_key: string;
  step: number;
  title: string;
  detail: string | null;
  state: 'waiting' | 'needs_human' | 'paused' | 'blocked_by_switch' | 'done' | 'expired';
  due_at: string;
  blocks_client: boolean;
  client_waiting_since: string | null;
  nag_level: number;
  client_id: string | null;
  project_id: string | null;
  task_id: string | null;
  resolved_owner: { user_id: string; source: string; role_key: string | null } | null;
  terminal_action: 'proceed' | 'send' | 'escalate' | 'task';
}

export interface WaitFilters {
  state?: string;
  kind?: string;
  owner?: string;
  client_id?: string;
  project_id?: string;
  task_id?: string;
  limit?: number;
}

export const WAIT_KEYS = {
  all: ['waits'] as const,
  mine: ['waits', 'mine'] as const,
  list: (f: WaitFilters) => ['waits', 'list', f] as const,
};

export function useMyWaitBlocks(enabled = true) {
  return useQuery({
    queryKey: WAIT_KEYS.mine,
    queryFn: () => apiClient.get<MyWaitBlocks>('/waits/mine'),
    refetchInterval: 5 * 60_000,
    enabled,
  });
}

export function useWaits(filters: WaitFilters = {}) {
  return useQuery({
    queryKey: WAIT_KEYS.list(filters),
    queryFn: () =>
      apiClient.get<{ data: WaitDTO[]; meta: { count: number; limit: number } }>('/waits', { params: { ...filters } }),
  });
}

export type WaitPatch =
  | { action: 'pause'; until: string; reason?: string }
  | { action: 'resume'; reason?: string }
  | { action: 'extend'; business_days?: number; until?: string; reason: string }
  | { action: 'redate'; due_at: string; reason: string }
  | { action: 'reassign'; owner_user_id?: string | null; owner_function_id?: string | null; reason?: string }
  | { action: 'stand_in'; stand_in_user_id: string | null; reason?: string }
  | { action: 'needs_human'; note: string }
  | { action: 'resolve'; resolution: 'approved' | 'completed' | 'cancelled' | 'sent' | 'booked' | 'signed' | 'declined'; reason?: string };

export function useUpdateWait() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WaitPatch }) => apiClient.patch<WaitDTO>(`/waits/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WAIT_KEYS.all });
    },
    onError: (error) => showToast.apiError(error, 'Could not update the wait'),
  });
}
