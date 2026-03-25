'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { accordKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  AccordWithRelations,
  AccordListResponse,
  CreateAccordInput,
  UpdateAccordInput,
  AccordStatus,
} from '@/types/entities';

interface AccordFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  owner_id?: string;
  client_id?: string;
}

export function useAccords(filters: AccordFilters = {}) {
  const { page = 1, limit = 20, search, status, owner_id, client_id } = filters;

  return useQuery({
    queryKey: accordKeys.list(filters),
    queryFn: async (): Promise<AccordListResponse> => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (owner_id) params.set('owner_id', owner_id);
      if (client_id) params.set('client_id', client_id);

      return apiClient.get<AccordListResponse>(`/accords?${params.toString()}`);
    },
  });
}

export function useAccord(id: string | undefined) {
  return useQuery({
    queryKey: accordKeys.detail(id!),
    queryFn: async (): Promise<AccordWithRelations> => {
      return apiClient.get<AccordWithRelations>(`/accords/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateAccord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAccordInput): Promise<AccordWithRelations> => {
      return apiClient.post<AccordWithRelations>('/accords', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accordKeys.lists() });
      showToast.created('Accord');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create accord');
    },
  });
}

export function useUpdateAccord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateAccordInput;
    }): Promise<AccordWithRelations> => {
      return apiClient.patch<AccordWithRelations>(`/accords/${id}`, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: accordKeys.lists() });
      showToast.updated('Accord');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update accord');
    },
  });
}

export function useDeleteAccord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/accords/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accordKeys.lists() });
      showToast.deleted('Accord');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete accord');
    },
  });
}

export function useUpdateAccordStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      rejection_reason,
    }: {
      id: string;
      status: AccordStatus;
      rejection_reason?: string;
    }): Promise<AccordWithRelations> => {
      return apiClient.patch<AccordWithRelations>(`/accords/${id}/status`, {
        status,
        rejection_reason,
      });
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: accordKeys.lists() });
      showToast.updated('Accord status');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update accord status');
    },
  });
}


