'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { apiKeyKeys } from '@/lib/api/query-keys';
import { toast } from 'sonner';

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ApiKeyCreateResponse {
  id: string;
  name: string;
  key: string;
  key_prefix: string;
  expires_at: string | null;
  created_at: string;
}

export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyKeys.lists(),
    queryFn: async (): Promise<{ api_keys: ApiKey[] }> => {
      return apiClient.get<{ api_keys: ApiKey[] }>('/api-keys');
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      expires_at?: string;
    }): Promise<ApiKeyCreateResponse> => {
      return apiClient.post<ApiKeyCreateResponse>('/api-keys', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all });
      toast.success('API key created');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create API key');
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all });
      toast.success('API key revoked');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to revoke API key');
    },
  });
}
