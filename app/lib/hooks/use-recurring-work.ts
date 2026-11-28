import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/hooks/use-toast';
import { apiClient } from '@/lib/api/client';
import type { RecurringWorkItem } from '@/types/entities';

export interface RecurringWorkGroup {
  label: string;
  count: number;
  stopped: number;
  rows: RecurringWorkItem[];
}

/** The grouped list (design.md 3.2): groups with stopped rows first, and the count of active background rows. */
export interface GroupedRecurringWork {
  recurring_work: RecurringWorkItem[];
  total: number;
  groups: RecurringWorkGroup[];
  plumbing: { count: number; stopped: number };
}

export const recurringWorkKeys = {
  all: ['recurring-work'] as const,
  grouped: () => [...recurringWorkKeys.all, 'grouped'] as const,
};

/** One fetch for the Recurring work tab: grouped, with the background rows included so a stopped one can lift out. */
export function useGroupedRecurringWork() {
  return useQuery({
    queryKey: recurringWorkKeys.grouped(),
    queryFn: () => apiClient.get<GroupedRecurringWork>('/recurring-work?grouped=true&include_plumbing=true'),
  });
}

export interface RecurringPickResult {
  filed: boolean;
  already_open: boolean;
  task: { id: string; title: string; status: string } | null;
}

/** Keep, Cut or Make weekly on a row. Cut and Make weekly file one card for Bast; Keep only records the pick. */
export function useRecurringPick() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pick }: { id: string; pick: 'keep' | 'cut' | 'weekly' }) =>
      apiClient.post<RecurringPickResult>(`/recurring-work/${id}/pick`, { pick }),
    onSuccess: (data, { pick }) => {
      qc.invalidateQueries({ queryKey: recurringWorkKeys.grouped() });
      if (data.already_open) showToast.success('A card for this job is already open');
      else if (data.filed) showToast.success('Card filed for Bast');
      else if (pick === 'keep') showToast.success('Kept');
    },
    onError: (error) => showToast.apiError(error, 'Could not save the pick'),
  });
}

/** Change one job's priority (normal or low) from its row; the grouped list is updated in place, then refetched. */
export function useUpdateRecurringPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: 'normal' | 'low' }) =>
      apiClient.patch<unknown>(`/recurring-work/${id}`, { priority }),
    onSuccess: (_data, { id, priority }) => {
      qc.setQueryData<GroupedRecurringWork>(recurringWorkKeys.grouped(), (old) =>
        old
          ? {
              ...old,
              groups: old.groups.map((g) => ({ ...g, rows: g.rows.map((r) => (r.id === id ? { ...r, priority } : r)) })),
            }
          : old,
      );
      qc.invalidateQueries({ queryKey: recurringWorkKeys.grouped() });
      showToast.updated('Priority');
    },
    onError: (error) => showToast.apiError(error, 'Could not change the priority'),
  });
}
