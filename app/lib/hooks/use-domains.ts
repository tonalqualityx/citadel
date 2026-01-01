'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { domainKeys, siteKeys } from '@/lib/api/query-keys';
import type {
  DomainWithRelations,
  DomainListResponse,
  CreateDomainInput,
  UpdateDomainInput,
} from '@/types/entities';

interface DomainFilters {
  page?: number;
  limit?: number;
  search?: string;
  site_id?: string;
  client_id?: string;
  expiring_soon?: boolean;
  unassigned?: boolean; // Filter for domains not linked to any site
}

export function useDomains(filters: DomainFilters = {}) {
  const { page = 1, limit = 20, search, site_id, client_id, expiring_soon, unassigned } = filters;

  return useQuery({
    queryKey: domainKeys.list(filters),
    queryFn: async (): Promise<DomainListResponse> => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (search) params.set('search', search);
      if (site_id) params.set('site_id', site_id);
      if (client_id) params.set('client_id', client_id);
      if (expiring_soon) params.set('expiring_soon', 'true');
      if (unassigned) params.set('unassigned', 'true');

      return apiClient.get<DomainListResponse>(`/domains?${params.toString()}`);
    },
  });
}

export function useDomain(id: string | undefined) {
  return useQuery({
    queryKey: domainKeys.detail(id!),
    queryFn: async (): Promise<DomainWithRelations> => {
      return apiClient.get<DomainWithRelations>(`/domains/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateDomainInput): Promise<DomainWithRelations> => {
      return apiClient.post<DomainWithRelations>('/domains', data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
      // Also invalidate the site detail since domain count changed
      if (data.site_id) {
        queryClient.invalidateQueries({ queryKey: siteKeys.detail(data.site_id) });
      }
    },
  });
}

export function useUpdateDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
      previousSiteId,
    }: {
      id: string;
      data: UpdateDomainInput;
      previousSiteId?: string | null; // Pass this to invalidate old site when unlinking
    }): Promise<DomainWithRelations> => {
      return apiClient.patch<DomainWithRelations>(`/domains/${id}`, data);
    },
    onSuccess: (response, { id, previousSiteId }) => {
      queryClient.invalidateQueries({ queryKey: domainKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
      // Invalidate current site when domain changes (especially for is_primary)
      if (response.site_id) {
        queryClient.invalidateQueries({ queryKey: siteKeys.detail(response.site_id) });
        queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      }
      // Also invalidate the previous site if the domain was unlinked/moved
      if (previousSiteId && previousSiteId !== response.site_id) {
        queryClient.invalidateQueries({ queryKey: siteKeys.detail(previousSiteId) });
      }
    },
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/domains/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
    },
  });
}
