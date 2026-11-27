import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { LedgerSummary } from '@/lib/model-ledger/types';

export type { LedgerSummary, LedgerLine } from '@/lib/model-ledger/types';

export const modelLedgerKeys = {
  all: ['model-ledger'] as const,
  window: (days: number) => [...modelLedgerKeys.all, days] as const,
};

/** The model ledger totals for the last `days` days (Recurring work tab). */
export function useModelLedger(days: number) {
  return useQuery({
    queryKey: modelLedgerKeys.window(days),
    queryFn: () => apiClient.get<LedgerSummary>(`/model-ledger/days?days=${days}`),
  });
}
