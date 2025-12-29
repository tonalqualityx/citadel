'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  avatar_url: string | null;
}

interface UsersResponse {
  users: User[];
}

interface UseUsersOptions {
  role?: string;
  includeInactive?: boolean;
}

export function useUsers(options: UseUsersOptions = {}) {
  const { role, includeInactive = false } = options;

  return useQuery({
    queryKey: ['users', { role, includeInactive }],
    queryFn: async (): Promise<UsersResponse> => {
      const params = new URLSearchParams();
      if (role) params.set('role', role);
      if (includeInactive) params.set('include_inactive', 'true');
      const queryString = params.toString();
      return apiClient.get<UsersResponse>(`/users${queryString ? `?${queryString}` : ''}`);
    },
  });
}
