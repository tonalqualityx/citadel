'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { charterKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  CharterWithRelations,
  CharterListResponse,
  CreateCharterInput,
  UpdateCharterInput,
  CharterStatus,
} from '@/types/entities';

interface CharterFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: CharterStatus;
  client_id?: string;
}

export function useCharters(filters: CharterFilters = {}) {
  const { page = 1, limit = 20, search, status, client_id } = filters;

  return useQuery({
    queryKey: charterKeys.list(filters),
    queryFn: async (): Promise<CharterListResponse> => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (client_id) params.set('client_id', client_id);

      return apiClient.get<CharterListResponse>(`/charters?${params.toString()}`);
    },
  });
}

export function useCharter(id: string | undefined) {
  return useQuery({
    queryKey: charterKeys.detail(id!),
    queryFn: async (): Promise<CharterWithRelations> => {
      return apiClient.get<CharterWithRelations>(`/charters/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateCharter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCharterInput): Promise<CharterWithRelations> => {
      return apiClient.post<CharterWithRelations>('/charters', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: charterKeys.lists() });
      showToast.created('Charter');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create charter');
    },
  });
}

export function useUpdateCharter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCharterInput }): Promise<CharterWithRelations> => {
      return apiClient.patch<CharterWithRelations>(`/charters/${id}`, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: charterKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: charterKeys.lists() });
      showToast.updated('Charter');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update charter');
    },
  });
}

export function useUpdateCharterStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status, cancellation_reason }: { id: string; status: CharterStatus; cancellation_reason?: string }): Promise<CharterWithRelations> => {
      return apiClient.patch<CharterWithRelations>(`/charters/${id}/status`, { status, cancellation_reason });
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: charterKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: charterKeys.lists() });
      showToast.updated('Charter status');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update status');
    },
  });
}

export function useDeleteCharter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/charters/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: charterKeys.lists() });
      showToast.deleted('Charter');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete charter');
    },
  });
}

export function useAddCharterWare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ charterId, data }: { charterId: string; data: { ware_id: string; price: number } }) => {
      return apiClient.post(`/charters/${charterId}/wares`, data);
    },
    onSuccess: (_, { charterId }) => {
      queryClient.invalidateQueries({ queryKey: charterKeys.detail(charterId) });
      showToast.created('Charter ware');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add ware');
    },
  });
}

export function useRemoveCharterWare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ charterId, wareId }: { charterId: string; wareId: string }) => {
      return apiClient.delete(`/charters/${charterId}/wares/${wareId}`);
    },
    onSuccess: (_, { charterId }) => {
      queryClient.invalidateQueries({ queryKey: charterKeys.detail(charterId) });
      showToast.deleted('Charter ware');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to remove ware');
    },
  });
}

export function useAddScheduledTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ charterId, data }: { charterId: string; data: { sop_id: string; cadence: string; charter_ware_id?: string; sort_order?: number } }) => {
      return apiClient.post(`/charters/${charterId}/scheduled-tasks`, data);
    },
    onSuccess: (_, { charterId }) => {
      queryClient.invalidateQueries({ queryKey: charterKeys.detail(charterId) });
      showToast.created('Scheduled task');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add scheduled task');
    },
  });
}

export function useRemoveScheduledTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ charterId, taskId }: { charterId: string; taskId: string }) => {
      return apiClient.delete(`/charters/${charterId}/scheduled-tasks/${taskId}`);
    },
    onSuccess: (_, { charterId }) => {
      queryClient.invalidateQueries({ queryKey: charterKeys.detail(charterId) });
      showToast.deleted('Scheduled task');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to remove scheduled task');
    },
  });
}

export function useLinkCommission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ charterId, data }: { charterId: string; data: { commission_id: string; allocated_hours_per_period?: number; start_period: string; end_period?: string } }) => {
      return apiClient.post(`/charters/${charterId}/commissions`, data);
    },
    onSuccess: (_, { charterId }) => {
      queryClient.invalidateQueries({ queryKey: charterKeys.detail(charterId) });
      showToast.created('Commission link');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to link commission');
    },
  });
}

export function useUnlinkCommission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ charterId, linkId }: { charterId: string; linkId: string }) => {
      return apiClient.delete(`/charters/${charterId}/commissions/${linkId}`);
    },
    onSuccess: (_, { charterId }) => {
      queryClient.invalidateQueries({ queryKey: charterKeys.detail(charterId) });
      showToast.deleted('Commission link');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to unlink commission');
    },
  });
}

export function useCharterUsage(charterId: string | undefined, period?: string) {
  return useQuery({
    queryKey: charterKeys.usage(charterId!, period),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (period) params.set('period', period);
      return apiClient.get(`/charters/${charterId}/usage?${params.toString()}`);
    },
    enabled: !!charterId,
  });
}
