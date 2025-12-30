import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Types matching API response from /api/billing/unbilled
export interface UnbilledMilestone {
  id: string;
  name: string;
  billing_amount: number;
  project_id: string;
  project_name: string;
  triggered_at: string;
}

export interface UnbilledTask {
  id: string;
  title: string;
  time_spent_minutes: number;
  estimated_minutes: number | null;
  project_id: string | null;
  project_name: string | null;
  is_billable: boolean;
  billing_target: number | null;
  is_retainer_work: boolean;
  completed_at: string | null;
}

export interface ClientUnbilledData {
  clientId: string;
  clientName: string;
  parentAgencyId: string | null;
  parentAgencyName: string | null;
  hourlyRate: number | null;
  isRetainer: boolean;
  retainerHours: number | null;
  usedRetainerHoursThisMonth: number;
  milestones: UnbilledMilestone[];
  tasks: UnbilledTask[];
  totalMilestoneAmount: number;
  totalTaskMinutes: number;
}

export interface UnbilledResponse {
  byClient: ClientUnbilledData[];
  summary: {
    totalMilestoneAmount: number;
    totalTaskMinutes: number;
    clientCount: number;
  };
}

export interface BatchInvoiceInput {
  milestone_ids?: string[];
  task_ids?: string[];
}

export interface BatchInvoiceResponse {
  success: boolean;
  milestonesUpdated: number;
  tasksUpdated: number;
  totalUpdated: number;
  invoicedAt: string;
  invoicedById: string;
}

// Query key factory pattern
export const billingKeys = {
  all: ['billing'] as const,
  unbilled: () => [...billingKeys.all, 'unbilled'] as const,
};

/**
 * Fetch unbilled items grouped by client
 */
export function useUnbilledItems() {
  return useQuery({
    queryKey: billingKeys.unbilled(),
    queryFn: () => apiClient.get<UnbilledResponse>('/billing/unbilled'),
  });
}

/**
 * Mark a single milestone as invoiced
 */
export function useMarkMilestoneInvoiced() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/milestones/${id}`, { billing_status: 'invoiced' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.unbilled() });
      showToast.success('Milestone marked as invoiced');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to mark milestone as invoiced');
    },
  });
}

/**
 * Mark a single task as invoiced
 */
export function useMarkTaskInvoiced() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/tasks/${id}`, { invoiced: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.unbilled() });
      showToast.success('Task marked as invoiced');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to mark task as invoiced');
    },
  });
}

/**
 * Update task billing fields (is_billable, billing_target, is_retainer_work, invoiced)
 */
export function useUpdateTaskBilling() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, data }: {
      taskId: string;
      data: {
        is_billable?: boolean;
        billing_target?: number | null;
        is_retainer_work?: boolean;
        invoiced?: boolean;
      };
    }) => apiClient.patch(`/tasks/${taskId}/billing`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.unbilled() });
      if (variables.data.is_billable === false) {
        showToast.success('Task marked as not billable');
      } else if (variables.data.is_billable === true) {
        showToast.success('Task marked as billable');
      }
      if (variables.data.is_retainer_work === true) {
        showToast.success('Task marked as retainer work');
      } else if (variables.data.is_retainer_work === false) {
        showToast.success('Task marked as project work');
      }
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update task billing');
    },
  });
}

/**
 * Batch mark milestones and tasks as invoiced
 */
export function useBatchInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BatchInvoiceInput) =>
      apiClient.post<BatchInvoiceResponse>('/billing/batch-invoice', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.unbilled() });
      const parts = [];
      if (data.milestonesUpdated > 0) {
        parts.push(`${data.milestonesUpdated} milestone${data.milestonesUpdated !== 1 ? 's' : ''}`);
      }
      if (data.tasksUpdated > 0) {
        parts.push(`${data.tasksUpdated} task${data.tasksUpdated !== 1 ? 's' : ''}`);
      }
      showToast.success(`Marked ${parts.join(' and ')} as invoiced`);
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to batch invoice items');
    },
  });
}
