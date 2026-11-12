'use client';

/**
 * Client hook for the two clock lines on a project drawer or a task card (Work stage F): GET /api/work/<target_key>/clocks, his browser
 * session only. The key starts with 'home', so the refetch every item action does after it succeeds also refreshes an open line. No
 * refetch on focus, reconnect or a timer.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { HOME_KEYS } from '@/lib/hooks/use-home';

export interface WorkClocksResponse {
  target_key: string;
  month_start: string;
  mike: null | {
    minutes: number;
    unlogged_minutes: number;
    logged_minutes: number;
    sessions: number;
    days: number;
    inferred_from: string;
    basis: string[];
    suggested: number | null;
    choices: number[];
    line: string;
  };
  bast: null | { minutes: number; agent_minutes: number | null; cost_usd: number | null; line: string };
}

export const workClocksKey = (targetKey: string) => [...HOME_KEYS.all, 'work-clocks', targetKey] as const;

export function useWorkClocks(targetKey: string | null) {
  return useQuery({
    queryKey: workClocksKey(targetKey ?? 'none'),
    queryFn: () => apiClient.get<WorkClocksResponse>(`/work/${encodeURIComponent(targetKey as string)}/clocks`),
    enabled: targetKey !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    staleTime: Infinity,
    gcTime: 0,
    retry: 0,
  });
}
