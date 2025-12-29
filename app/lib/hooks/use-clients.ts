'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { clientKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  ClientWithRelations,
  ClientListResponse,
  CreateClientInput,
  UpdateClientInput,
} from '@/types/entities';

interface ClientFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'active' | 'inactive' | 'delinquent';
  type?: 'direct' | 'agency_partner' | 'sub_client';
}

export function useClients(filters: ClientFilters = {}) {
  const { page = 1, limit = 20, search, status, type } = filters;

  return useQuery({
    queryKey: clientKeys.list(filters),
    queryFn: async (): Promise<ClientListResponse> => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (type) params.set('type', type);

      return apiClient.get<ClientListResponse>(`/clients?${params.toString()}`);
    },
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: clientKeys.detail(id!),
    queryFn: async (): Promise<ClientWithRelations> => {
      return apiClient.get<ClientWithRelations>(`/clients/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateClientInput): Promise<ClientWithRelations> => {
      return apiClient.post<ClientWithRelations>('/clients', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      showToast.created('Pact');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create pact');
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateClientInput;
    }): Promise<ClientWithRelations> => {
      return apiClient.patch<ClientWithRelations>(`/clients/${id}`, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      showToast.updated('Pact');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update pact');
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/clients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      showToast.deleted('Pact');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete pact');
    },
  });
}
