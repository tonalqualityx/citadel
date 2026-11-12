'use client';

/**
 * Client hook for the project drawer's "Attached" list (Work stage D): GET /api/work/project:<id>/state. The key starts with 'home', so the
 * refetch every item action already does after it succeeds also refreshes an open drawer. No refetch on focus, reconnect or a timer.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { HOME_KEYS } from '@/lib/hooks/use-home';

export interface WorkStateResponse {
  target_key: string;
  type: 'project' | 'task';
  id: string;
  name: string;
  href: string;
  status: string;
  state: string;
  since: string | null;
  line: string;
  attached: { link_id: string; kind: string; ref: string; label: string; line: string; href: string | null; at: string; attached_by: string; target_key: string }[];
  evidence: { kind: string; at: string; line: string; href: string | null; source: string }[];
  live_session: boolean;
}

export const workStateKey = (targetKey: string) => [...HOME_KEYS.all, 'work-state', targetKey] as const;

export function useWorkState(targetKey: string | null) {
  return useQuery({
    queryKey: workStateKey(targetKey ?? 'none'),
    queryFn: () => apiClient.get<WorkStateResponse>(`/work/${encodeURIComponent(targetKey as string)}/state`),
    enabled: targetKey !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    staleTime: Infinity,
    gcTime: 0,
    retry: 0,
  });
}
