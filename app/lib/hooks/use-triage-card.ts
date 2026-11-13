import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { HomeTriageCard } from '@/lib/home/types';

export const triageCardKeys = {
  all: ['triage-card'] as const,
  task: (taskId: string) => ['triage-card', taskId] as const,
};

/**
 * GET /api/tasks/:id/triage: one Triage card as the tab shows it. Mike's session only; anyone else (403) or a card that is not in
 * Triage (404) reads as null, so the panel simply is not there.
 */
export function useTriageCard(taskId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: triageCardKeys.task(taskId ?? 'none'),
    enabled: enabled && !!taskId,
    queryFn: async (): Promise<HomeTriageCard | null> => {
      try {
        return await apiClient.get<HomeTriageCard>(`/tasks/${taskId}/triage`);
      } catch {
        return null;
      }
    },
    staleTime: 5_000,
    retry: 0,
  });
}
