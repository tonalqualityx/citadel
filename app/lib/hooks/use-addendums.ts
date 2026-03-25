'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { addendumKeys, accordKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  AddendumWithRelations,
  AddendumListResponse,
  CreateAddendumInput,
  UpdateAddendumInput,
} from '@/types/entities';

export function useAddendums(accordId: string | undefined) {
  return useQuery({
    queryKey: addendumKeys.byAccord(accordId!),
    queryFn: async (): Promise<AddendumListResponse> => {
      return apiClient.get<AddendumListResponse>(`/accords/${accordId}/addendums`);
    },
    enabled: !!accordId,
  });
}

export function useAddendum(accordId: string | undefined, addendumId: string | undefined) {
  return useQuery({
    queryKey: addendumKeys.detail(accordId!, addendumId!),
    queryFn: async (): Promise<AddendumWithRelations> => {
      return apiClient.get<AddendumWithRelations>(`/accords/${accordId}/addendums/${addendumId}`);
    },
    enabled: !!accordId && !!addendumId,
  });
}

export function useCreateAddendum() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      data,
    }: {
      accordId: string;
      data: CreateAddendumInput;
    }): Promise<AddendumWithRelations> => {
      return apiClient.post<AddendumWithRelations>(`/accords/${accordId}/addendums`, data);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: addendumKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.created('Addendum');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create addendum');
    },
  });
}

export function useUpdateAddendum() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      addendumId,
      data,
    }: {
      accordId: string;
      addendumId: string;
      data: UpdateAddendumInput;
    }): Promise<AddendumWithRelations> => {
      return apiClient.patch<AddendumWithRelations>(
        `/accords/${accordId}/addendums/${addendumId}`,
        data
      );
    },
    onSuccess: (_, { accordId, addendumId }) => {
      queryClient.invalidateQueries({ queryKey: addendumKeys.detail(accordId, addendumId) });
      queryClient.invalidateQueries({ queryKey: addendumKeys.byAccord(accordId) });
      showToast.updated('Addendum');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update addendum');
    },
  });
}

export function useDeleteAddendum() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      addendumId,
    }: {
      accordId: string;
      addendumId: string;
    }): Promise<void> => {
      await apiClient.delete(`/accords/${accordId}/addendums/${addendumId}`);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: addendumKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.deleted('Addendum');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete addendum');
    },
  });
}

export function useSendAddendum() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      addendumId,
    }: {
      accordId: string;
      addendumId: string;
    }): Promise<AddendumWithRelations> => {
      return apiClient.post<AddendumWithRelations>(
        `/accords/${accordId}/addendums/${addendumId}/send`,
        {}
      );
    },
    onSuccess: (_, { accordId, addendumId }) => {
      queryClient.invalidateQueries({ queryKey: addendumKeys.detail(accordId, addendumId) });
      queryClient.invalidateQueries({ queryKey: addendumKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.success('Addendum sent to client');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to send addendum');
    },
  });
}
