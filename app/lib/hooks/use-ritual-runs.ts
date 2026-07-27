'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Clarity Phase 7 (Seeing Stone Reckoning P2) — the ritual gate's data layer.

export interface RitualRunResponse {
  date: string;
  kind: string;
  ran_at: string | null;
  bailed_at: string | null;
}

export const ritualRunKeys = {
  all: ['ritual-runs'] as const,
  status: (kind: string = 'morning') => [...ritualRunKeys.all, kind] as const,
};

export function useRitualRunStatus(kind: string = 'morning') {
  return useQuery({
    queryKey: ritualRunKeys.status(kind),
    queryFn: () => apiClient.get<RitualRunResponse>('/ritual-runs', { params: { kind } }),
    // Short-lived cache: the ritual session that satisfies this gate runs machine-side,
    // outside this browser tab — poll gently rather than staying stale for a whole session.
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useBailRitual() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (kind: string = 'morning') =>
      apiClient.post<RitualRunResponse>('/ritual-runs', { action: 'bailed', kind }),
    onSuccess: (data) => {
      queryClient.setQueryData(ritualRunKeys.status(data.kind), data);
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to record the bail');
    },
  });
}
