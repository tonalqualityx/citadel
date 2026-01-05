'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { clientKeys, clientActivityKeys } from '@/lib/api/query-keys';
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
      showToast.created('Client');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create client');
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
      showToast.updated('Client');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update client');
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
      showToast.deleted('Client');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete client');
    },
  });
}

// Client Activity types
export interface ClientActivityProject {
  id: string;
  name: string;
  status: string;
  type: string;
  target_date: string | null;
  task_count: number;
}

export interface ClientActivityTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  is_support: boolean;
  is_billable: boolean;
  due_date: string | null;
  completed_at: string | null;
  project: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
}

export interface ClientActivityStats {
  open_projects: number;
  open_tasks: number;
  support_tasks_this_month: number;
}

export interface ClientActivityResponse {
  projects: ClientActivityProject[];
  tasks: ClientActivityTask[];
  stats: ClientActivityStats;
}

export interface ClientActivityFilters {
  projectStatus?: 'open' | 'completed' | 'all';
  taskType?: 'support' | 'billable' | 'all';
  taskStatus?: 'open' | 'completed' | 'all';
}

export function useClientActivity(
  clientId: string | undefined,
  filters: ClientActivityFilters = {}
) {
  return useQuery({
    queryKey: clientActivityKeys.byClient(clientId!, filters),
    queryFn: async (): Promise<ClientActivityResponse> => {
      const params = new URLSearchParams();
      if (filters.projectStatus) params.set('project_status', filters.projectStatus);
      if (filters.taskType) params.set('task_type', filters.taskType);
      if (filters.taskStatus) params.set('task_status', filters.taskStatus);

      const queryString = params.toString();
      const url = `/clients/${clientId}/activity${queryString ? `?${queryString}` : ''}`;
      return apiClient.get<ClientActivityResponse>(url);
    },
    enabled: !!clientId,
  });
}
