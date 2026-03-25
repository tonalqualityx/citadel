'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { wareKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  WareWithRelations,
  WareListResponse,
  CreateWareInput,
  UpdateWareInput,
} from '@/types/entities';

interface WareFilters {
  page?: number;
  limit?: number;
  search?: string;
  type?: 'commission' | 'charter';
  is_active?: boolean;
}

export function useWares(filters: WareFilters = {}) {
  const { page = 1, limit = 20, search, type, is_active } = filters;

  return useQuery({
    queryKey: wareKeys.list(filters),
    queryFn: async (): Promise<WareListResponse> => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (search) params.set('search', search);
      if (type) params.set('type', type);
      if (is_active !== undefined) params.set('is_active', is_active.toString());

      return apiClient.get<WareListResponse>(`/wares?${params.toString()}`);
    },
  });
}

export function useWare(id: string | undefined) {
  return useQuery({
    queryKey: wareKeys.detail(id!),
    queryFn: async (): Promise<WareWithRelations> => {
      return apiClient.get<WareWithRelations>(`/wares/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateWare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateWareInput): Promise<WareWithRelations> => {
      return apiClient.post<WareWithRelations>('/wares', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wareKeys.lists() });
      showToast.created('Ware');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create ware');
    },
  });
}

export function useUpdateWare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateWareInput;
    }): Promise<WareWithRelations> => {
      return apiClient.patch<WareWithRelations>(`/wares/${id}`, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: wareKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: wareKeys.lists() });
      showToast.updated('Ware');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update ware');
    },
  });
}

export function useDeleteWare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/wares/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wareKeys.lists() });
      showToast.deleted('Ware');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete ware');
    },
  });
}
