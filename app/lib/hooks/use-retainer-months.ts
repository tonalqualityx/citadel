import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import type { RetainerMonthLine, RetainerMonthView } from '@/types/entities';

export const retainerMonthKeys = {
  all: ['retainer-months'] as const,
  list: (month?: string) => [...retainerMonthKeys.all, 'list', month ?? 'current'] as const,
  charter: (charterId: string) => [...retainerMonthKeys.all, 'charter', charterId] as const,
};

/** Every monthly retainer's month for one month (default: this month). */
export function useRetainerMonths(month?: string) {
  return useQuery({
    queryKey: retainerMonthKeys.list(month),
    queryFn: () => apiClient.get<{ month: string; retainers: RetainerMonthView[]; upcoming: RetainerMonthView[] }>(`/retainer-months${month ? `?month=${month}` : ''}`),
  });
}

/** A charter's current month in full and its past months as lines. */
export function useCharterRetainerMonths(charterId: string) {
  return useQuery({
    queryKey: retainerMonthKeys.charter(charterId),
    queryFn: () =>
      apiClient.get<{ charter_id: string; billing_period: string; current: RetainerMonthView | null; upcoming: RetainerMonthView | null; past: RetainerMonthLine[] }>(
        `/charters/${charterId}/retainer-months`,
      ),
  });
}

/** "Use this plan". */
export function useConfirmRetainerMonth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<RetainerMonthView>(`/retainer-months/${id}/confirm`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: retainerMonthKeys.all });
      showToast.success('Plan confirmed');
    },
    onError: (error) => showToast.apiError(error, 'The plan was not confirmed'),
  });
}
