'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { todayKeys } from '@/lib/hooks/use-today';

// Clarity Phase 7 (Seeing Stone Reckoning P2) — the ritual gate's data layer.

export interface RitualRunResponse {
  date: string;
  kind: string;
  ran_at: string | null;
  bailed_at: string | null;
  // Clarity Phase 8 (composition) — set only when the gate was satisfied via the
  // Quick-start door, not a full ritual.
  quickstart_at: string | null;
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

// Clarity Phase 8 (composition) — the gate's Quick-start door (DAY-REALITY ADDENDUM #2):
// "name the one thing, go." Two sequential calls, gate-first-satisfying-write-first:
//   1. POST /api/today { item_type: 'note', label: <the text> } — creates today's pick
//      from the one thing Mike named. If THIS fails, the gate must NOT open — never
//      satisfy the gate for a pick that didn't actually save.
//   2. POST /api/ritual-runs { action: 'ran', quickstart: true } — satisfies the gate,
//      flagged as the short door (so an ~11am "wave broke, want the full ritual?" offer
//      can be honest later instead of guessed).
// Landing in Work mode afterward needs no extra step — ModeShell always defaults there.
export function useQuickStartRitual() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ text, kind = 'morning' }: { text: string; kind?: string }) => {
      const trimmed = text.trim();
      await apiClient.post('/today', { item_type: 'note', label: trimmed });
      return apiClient.post<RitualRunResponse>('/ritual-runs', { action: 'ran', quickstart: true, kind });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(ritualRunKeys.status(data.kind), data);
      queryClient.invalidateQueries({ queryKey: todayKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to start the day');
    },
  });
}
