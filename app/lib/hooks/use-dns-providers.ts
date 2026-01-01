'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

export interface DnsProvider {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface DnsProvidersResponse {
  providers: DnsProvider[];
}

export function useDnsProviders() {
  return useQuery({
    queryKey: queryKeys.dnsProviders.list(),
    queryFn: () => apiClient.get<DnsProvidersResponse>('/dns-providers'),
    select: (data) => data.providers,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateDnsProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiClient.post<DnsProvider>('/dns-providers', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dnsProviders.all });
    },
  });
}
