'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { referenceDataKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';

// Types
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'tech' | 'pm' | 'admin';
  is_active: boolean;
  avatar_url: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface UserListResponse {
  users: User[];
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: 'tech' | 'pm' | 'admin';
  avatar_url?: string | null;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: 'tech' | 'pm' | 'admin';
  avatar_url?: string | null;
  is_active?: boolean;
}

interface UseUsersOptions {
  role?: string;
  includeInactive?: boolean;
}

// Hooks
export function useUsers(options: UseUsersOptions = {}) {
  const { role, includeInactive = false } = options;

  return useQuery({
    queryKey: [...referenceDataKeys.users, { role, includeInactive }],
    queryFn: async (): Promise<UserListResponse> => {
      const params = new URLSearchParams();
      if (role) params.set('role', role);
      if (includeInactive) params.set('include_inactive', 'true');
      const queryString = params.toString();
      return apiClient.get<UserListResponse>(`/users${queryString ? `?${queryString}` : ''}`);
    },
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: [...referenceDataKeys.users, 'detail', id],
    queryFn: async (): Promise<User> => {
      return apiClient.get<User>(`/users/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUserInput): Promise<User> => {
      return apiClient.post<User>('/users', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.users });
      showToast.created('User');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create user');
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateUserInput;
    }): Promise<User> => {
      return apiClient.patch<User>(`/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.users });
      showToast.updated('User');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update user');
    },
  });
}

export function useResetUserPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      password,
    }: {
      id: string;
      password: string;
    }): Promise<User> => {
      return apiClient.patch<User>(`/users/${id}`, { password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.users });
      showToast.success('Password reset successfully');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to reset password');
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<{ success?: boolean; deactivated?: boolean; message?: string }> => {
      return apiClient.delete(`/users/${id}`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.users });
      if (data.deactivated) {
        showToast.success('User deactivated (has related records)');
      } else {
        showToast.deleted('User');
      }
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete user');
    },
  });
}
