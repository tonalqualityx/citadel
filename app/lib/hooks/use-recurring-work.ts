import { useQuery } from '@tanstack/react-query';
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
