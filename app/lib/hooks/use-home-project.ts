'use client';

/**
 * Client hook for the home screen's project drawer (Slice 8a): GET /api/home/projects/[id].
 * The key starts with 'home', so the refetch every item action already does after it succeeds
 * (use-home.ts refetchHome) also refreshes an open drawer. It never refetches on focus,
 * reconnect or a timer: nothing may move while he is reading it.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { HOME_KEYS } from '@/lib/hooks/use-home';
import type { HomeProjectResponse } from '@/lib/home/projects/types';

export const homeProjectKey = (projectId: string) => [...HOME_KEYS.all, 'project', projectId] as const;

export function useHomeProject(projectId: string | null) {
  return useQuery({
    queryKey: homeProjectKey(projectId ?? 'none'),
    queryFn: () => apiClient.get<HomeProjectResponse>(`/home/projects/${projectId}`),
    enabled: projectId !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
  });
}
