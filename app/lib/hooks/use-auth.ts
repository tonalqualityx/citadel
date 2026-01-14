'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'pm' | 'tech';
  avatar_url: string | null;
  preferences: {
    naming_convention: string;
    theme: string;
    notification_bundle: boolean;
  } | null;
}

interface AuthResponse {
  user: CurrentUser;
}

export function useAuth() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async (): Promise<AuthResponse> => {
      const response = await apiClient.get<AuthResponse>('/auth/me');
      // Mark token expiry on successful auth check
      apiClient.markLoggedIn();
      return response;
    },
    staleTime: 5 * 60 * 1000, // Consider fresh for 5 minutes
    retry: false,
    refetchOnWindowFocus: false, // Prevent logout issues when returning to tab
  });

  return {
    user: data?.user ?? null,
    isLoading,
    error,
    isAuthenticated: !!data?.user,
    isPmOrAdmin: data?.user?.role === 'pm' || data?.user?.role === 'admin',
    isAdmin: data?.user?.role === 'admin',
    isTech: data?.user?.role === 'tech',
  };
}
