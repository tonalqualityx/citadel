'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { brandProfileKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  ClientBrandProfileResponse,
  SiteBrandProfileResponse,
  UpdateBrandProfileInput,
} from '@/types/entities';

export function useClientBrandProfile(clientId: string | undefined) {
  return useQuery({
    queryKey: brandProfileKeys.byClient(clientId!),
    queryFn: async (): Promise<ClientBrandProfileResponse> => {
      return apiClient.get<ClientBrandProfileResponse>(`/clients/${clientId}/brand-profile`);
    },
    enabled: !!clientId,
  });
}

export function useUpdateClientBrandProfile(clientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateBrandProfileInput): Promise<ClientBrandProfileResponse> => {
      return apiClient.put<ClientBrandProfileResponse>(`/clients/${clientId}/brand-profile`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brandProfileKeys.byClient(clientId) });
      // A client change shifts every site's resolved cascade — refresh all site profiles.
      queryClient.invalidateQueries({ queryKey: brandProfileKeys.all });
      showToast.updated('Brand profile');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to save brand profile');
    },
  });
}

export function useSiteBrandProfile(siteId: string | undefined) {
  return useQuery({
    queryKey: brandProfileKeys.bySite(siteId!),
    queryFn: async (): Promise<SiteBrandProfileResponse> => {
      return apiClient.get<SiteBrandProfileResponse>(`/sites/${siteId}/brand-profile`);
    },
    enabled: !!siteId,
  });
}

export function useUpdateSiteBrandProfile(siteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateBrandProfileInput): Promise<SiteBrandProfileResponse> => {
      return apiClient.put<SiteBrandProfileResponse>(`/sites/${siteId}/brand-profile`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brandProfileKeys.bySite(siteId) });
      showToast.updated('Brand profile');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to save brand profile');
    },
  });
}
