'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { userFunctionKeys, referenceDataKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type { UserFunction, AddUserFunctionInput } from '@/types/entities';

interface UserFunctionListResponse {
  user_functions: UserFunction[];
}

// Get all functions for a user
export function useUserFunctions(userId: string) {
  return useQuery({
    queryKey: userFunctionKeys.byUser(userId),
    queryFn: async (): Promise<UserFunctionListResponse> => {
      return apiClient.get<UserFunctionListResponse>(`/users/${userId}/functions`);
    },
    enabled: !!userId,
  });
}

// Add a function to a user
export function useAddUserFunction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      data,
    }: {
      userId: string;
      data: AddUserFunctionInput;
    }): Promise<UserFunction> => {
      return apiClient.post<UserFunction>(`/users/${userId}/functions`, data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: userFunctionKeys.byUser(variables.userId) });
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.users });
      showToast.success('Function added');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add function');
    },
  });
}

// Remove a function from a user
export function useRemoveUserFunction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      functionId,
    }: {
      userId: string;
      functionId: string;
    }): Promise<{ success: boolean }> => {
      return apiClient.delete(`/users/${userId}/functions?function_id=${functionId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: userFunctionKeys.byUser(variables.userId) });
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.users });
      showToast.success('Function removed');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to remove function');
    },
  });
}

// Set a function as primary for a user
export function useSetPrimaryFunction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      functionId,
      isPrimary,
    }: {
      userId: string;
      functionId: string;
      isPrimary: boolean;
    }): Promise<UserFunction> => {
      return apiClient.patch<UserFunction>(
        `/users/${userId}/functions?function_id=${functionId}`,
        { is_primary: isPrimary }
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: userFunctionKeys.byUser(variables.userId) });
      showToast.success('Primary function updated');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update function');
    },
  });
}
