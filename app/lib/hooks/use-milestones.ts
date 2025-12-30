import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

export type BillingStatus = 'pending' | 'triggered' | 'invoiced';

export interface Milestone {
  id: string;
  name: string;
  project_id: string;
  phase_id: string | null;
  target_date: string | null;
  completed_at: string | null;
  notes: string | null;
  sort_order: number;
  billing_amount: number | null;
  billing_status: BillingStatus;
  triggered_at: string | null;
  triggered_by_id: string | null;
  invoiced_at: string | null;
  invoiced_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MilestonesResponse {
  milestones: Milestone[];
  count: number;
}

export interface CreateMilestoneInput {
  name: string;
  target_date?: string | null;
  notes?: string | null;
  billing_amount?: number | null;
  phase_id?: string | null;
}

export interface UpdateMilestoneInput {
  name?: string;
  target_date?: string | null;
  notes?: string | null;
  completed_at?: string | null;
  sort_order?: number;
  billing_amount?: number | null;
  phase_id?: string | null;
}

// Query keys for milestones
export const milestoneKeys = {
  all: ['milestones'] as const,
  project: (projectId: string) => [...milestoneKeys.all, projectId] as const,
  detail: (id: string) => ['milestone', id] as const,
};

/**
 * Fetch milestones for a project
 */
export function useMilestones(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: milestoneKeys.project(projectId),
    queryFn: () => apiClient.get<MilestonesResponse>(`/projects/${projectId}/milestones`),
    enabled: options?.enabled ?? !!projectId,
  });
}

/**
 * Fetch a single milestone by ID
 */
export function useMilestone(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: milestoneKeys.detail(id),
    queryFn: () => apiClient.get<Milestone>(`/milestones/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

/**
 * Create a new milestone for a project
 */
export function useCreateMilestone(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMilestoneInput) =>
      apiClient.post<Milestone>(`/projects/${projectId}/milestones`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.project(projectId) });
      showToast.success('Milestone created');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create milestone');
    },
  });
}

/**
 * Update an existing milestone
 */
export function useUpdateMilestone(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMilestoneInput }) =>
      apiClient.patch<Milestone>(`/milestones/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.project(projectId) });
      showToast.success('Milestone updated');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update milestone');
    },
  });
}

/**
 * Delete a milestone
 */
export function useDeleteMilestone(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/milestones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.project(projectId) });
      showToast.success('Milestone deleted');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete milestone');
    },
  });
}

/**
 * Toggle milestone completion status
 */
export function useToggleMilestoneComplete(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      apiClient.patch<Milestone>(`/milestones/${id}`, {
        completed_at: completed ? new Date().toISOString() : null,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: milestoneKeys.detail(data.id) });
      showToast.success(data.completed_at ? 'Milestone completed' : 'Milestone reopened');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update milestone');
    },
  });
}

/**
 * Trigger billing for a milestone (marks it as ready to invoice)
 */
export function useTriggerMilestone(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Milestone>(`/milestones/${id}/trigger`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: milestoneKeys.detail(data.id) });
      showToast.success('Milestone marked as ready to bill');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to trigger milestone billing');
    },
  });
}

/**
 * Mark a milestone as invoiced
 */
export function useInvoiceMilestone(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Milestone>(`/milestones/${id}/invoice`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: milestoneKeys.detail(data.id) });
      showToast.success('Milestone marked as invoiced');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to mark milestone as invoiced');
    },
  });
}
