import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface UserPreferences {
  naming_convention: 'awesome' | 'standard';
  theme: 'light' | 'dim' | 'dark' | 'system';
  notification_bundle: boolean;
}

interface PreferencesResponse {
  preferences: UserPreferences;
}

export const preferencesKeys = {
  all: ['preferences'] as const,
  current: () => [...preferencesKeys.all, 'current'] as const,
};

export function usePreferences() {
  return useQuery({
    queryKey: preferencesKeys.current(),
    queryFn: () => apiClient.get<PreferencesResponse>('/users/me/preferences'),
    staleTime: Infinity, // Preferences rarely change
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates: Partial<UserPreferences>) =>
      apiClient.patch<PreferencesResponse>('/users/me/preferences', updates),
    onSuccess: (data) => {
      queryClient.setQueryData(preferencesKeys.current(), data);
    },
  });
}
