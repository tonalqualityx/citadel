'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { siteKeys, clientKeys } from '@/lib/api/query-keys';
import type {
  SiteWithRelations,
  SiteListResponse,
  CreateSiteInput,
  UpdateSiteInput,
} from '@/types/entities';

interface SiteFilters {
  page?: number;
  limit?: number;
  search?: string;
  client_id?: string;
  hosted_by?: 'indelible' | 'client' | 'other';
}

export function useSites(filters: SiteFilters = {}) {
  const { page = 1, limit = 20, search, client_id, hosted_by } = filters;

  return useQuery({
    queryKey: siteKeys.list(filters),
    queryFn: async (): Promise<SiteListResponse> => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (search) params.set('search', search);
      if (client_id) params.set('client_id', client_id);
      if (hosted_by) params.set('hosted_by', hosted_by);

      return apiClient.get<SiteListResponse>(`/sites?${params.toString()}`);
    },
  });
}

export function useSite(id: string | undefined) {
  return useQuery({
    queryKey: siteKeys.detail(id!),
    queryFn: async (): Promise<SiteWithRelations> => {
      return apiClient.get<SiteWithRelations>(`/sites/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSiteInput): Promise<SiteWithRelations> => {
      return apiClient.post<SiteWithRelations>('/sites', data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      // Also invalidate the client detail since site count changed
      if (data.client_id) {
        queryClient.invalidateQueries({ queryKey: clientKeys.detail(data.client_id) });
      }
    },
  });
}

export function useUpdateSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateSiteInput;
    }): Promise<SiteWithRelations> => {
      return apiClient.patch<SiteWithRelations>(`/sites/${id}`, data);
    },
    onSuccess: (result, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: siteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      // Invalidate client queries when client_id changes
      if ('client_id' in data) {
        // Invalidate the new client (if any)
        if (data.client_id) {
          queryClient.invalidateQueries({ queryKey: clientKeys.detail(data.client_id) });
        }
        // Also invalidate client lists to update site counts
        queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      }
    },
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/sites/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}

export interface BulkUpdateSitesInput {
  client_id?: string;
  hosted_by?: 'indelible' | 'client' | 'other';
  hosting_plan_id?: string | null;
  maintenance_plan_id?: string | null;
  maintenance_assignee_id?: string | null;
}

export function useBulkUpdateSites() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      site_ids,
      data,
    }: {
      site_ids: string[];
      data: BulkUpdateSitesInput;
    }): Promise<{ success: boolean; updated: number }> => {
      return apiClient.patch('/sites/bulk', { site_ids, data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}

export function useBulkDeleteSites() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (site_ids: string[]): Promise<{ success: boolean; deleted: number }> => {
      return apiClient.delete('/sites/bulk', { site_ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}
