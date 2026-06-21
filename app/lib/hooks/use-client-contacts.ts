'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { clientContactKeys, clientKeys } from '@/lib/api/query-keys';
import type {
  ClientContact,
  ClientContactListResponse,
  CreateClientContactInput,
  UpdateClientContactInput,
} from '@/types/entities';

export function useClientContacts(clientId: string | undefined) {
  return useQuery({
    queryKey: clientContactKeys.byClient(clientId!),
    queryFn: async (): Promise<ClientContactListResponse> => {
      return apiClient.get<ClientContactListResponse>(`/clients/${clientId}/contacts`);
    },
    enabled: !!clientId,
  });
}

export function useCreateClientContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      clientId,
      data,
    }: {
      clientId: string;
      data: CreateClientContactInput;
    }): Promise<ClientContact> => {
      return apiClient.post<ClientContact>(`/clients/${clientId}/contacts`, data);
    },
    onSuccess: (_result, { clientId }) => {
      queryClient.invalidateQueries({ queryKey: clientContactKeys.byClient(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
    },
  });
}

export function useUpdateClientContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      clientId: string;
      data: UpdateClientContactInput;
    }): Promise<ClientContact> => {
      return apiClient.patch<ClientContact>(`/contacts/${id}`, data);
    },
    onSuccess: (_result, { clientId }) => {
      queryClient.invalidateQueries({ queryKey: clientContactKeys.byClient(clientId) });
    },
  });
}

export interface ContactPortalLoginLinkResponse {
  url: string;
  expires_at: string;
  sent: boolean;
  contact: { id: string; name: string | null; email: string };
}

/**
 * Team action: get a contact's portal login link. send=false returns the URL to copy;
 * send=true has Citadel email the contact the link.
 */
export function useContactPortalLoginLink() {
  return useMutation({
    mutationFn: async ({
      id,
      send = false,
    }: {
      id: string;
      send?: boolean;
    }): Promise<ContactPortalLoginLinkResponse> => {
      return apiClient.post<ContactPortalLoginLinkResponse>(
        `/contacts/${id}/portal-login-link`,
        { send }
      );
    },
  });
}

export function useDeleteClientContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; clientId: string }): Promise<void> => {
      await apiClient.delete(`/contacts/${id}`);
    },
    onSuccess: (_result, { clientId }) => {
      queryClient.invalidateQueries({ queryKey: clientContactKeys.byClient(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
    },
  });
}
