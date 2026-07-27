'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import type { CronChipStateRow } from '@/lib/cron-chips';

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q14) — cron chips v1's snooze/dismiss.

export const cronChipKeys = {
  all: ['cron-chips'] as const,
};

export function useCronChipStates() {
  return useQuery({
    queryKey: cronChipKeys.all,
    queryFn: () => apiClient.get<{ states: CronChipStateRow[] }>('/oracle/cron-chips'),
    // Cron health is checked far less often than most Oracle data; a short refetch
    // interval keeps a snoozed/dismissed chip from silently going stale for hours.
    refetchInterval: 60_000,
  });
}

function useUpsertCronChip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { cron_key: string; action: 'snooze' | 'dismiss'; reason?: string | null }) =>
      apiClient.post<CronChipStateRow>('/oracle/cron-chips', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cronChipKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update cron chip');
    },
  });
}

export function useSnoozeCron() {
  const upsert = useUpsertCronChip();
  return {
    ...upsert,
    mutate: (cronKey: string) => upsert.mutate({ cron_key: cronKey, action: 'snooze' }),
  };
}

export function useDismissCron() {
  const upsert = useUpsertCronChip();
  return {
    ...upsert,
    mutate: (cronKey: string, reason: string | null) =>
      upsert.mutate({ cron_key: cronKey, action: 'dismiss', reason }),
  };
}
