'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/hooks/use-toast';
import { msaKeys } from '@/lib/api/query-keys';
import type { MsaVersionWithRelations, CreateMsaVersionInput, UpdateMsaVersionInput } from '@/types/entities';

// List all MSA versions
export function useMsaVersions() {
  return useQuery({
    queryKey: msaKeys.list(),
    queryFn: async () => {
      const res = await fetch('/api/msa');
      if (!res.ok) throw new Error('Failed to fetch MSA versions');
      return res.json() as Promise<{ msa_versions: MsaVersionWithRelations[]; total: number }>;
    },
  });
}

// Get current MSA version
export function useCurrentMsa() {
  return useQuery({
    queryKey: msaKeys.current(),
    queryFn: async () => {
      const res = await fetch('/api/msa/current');
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to fetch current MSA');
      return res.json() as Promise<MsaVersionWithRelations>;
    },
  });
}

// Get single MSA version
export function useMsaVersion(id: string) {
  return useQuery({
    queryKey: msaKeys.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/msa/${id}`);
      if (!res.ok) throw new Error('Failed to fetch MSA version');
      return res.json() as Promise<MsaVersionWithRelations>;
    },
    enabled: !!id,
  });
}

// Create MSA version
export function useCreateMsaVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateMsaVersionInput) => {
      const res = await fetch('/api/msa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create MSA version');
      }
      return res.json() as Promise<MsaVersionWithRelations>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: msaKeys.all });
      showToast.created('MSA version');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Update MSA version
export function useUpdateMsaVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateMsaVersionInput }) => {
      const res = await fetch(`/api/msa/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update MSA version');
      }
      return res.json() as Promise<MsaVersionWithRelations>;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: msaKeys.all });
      queryClient.invalidateQueries({ queryKey: msaKeys.detail(id) });
      showToast.updated('MSA version');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Delete MSA version
export function useDeleteMsaVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/msa/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete MSA version');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: msaKeys.all });
      showToast.deleted('MSA version');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Check client MSA status
export function useClientMsaStatus(clientId: string) {
  return useQuery({
    queryKey: msaKeys.clientStatus(clientId),
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/msa-status`);
      if (!res.ok) throw new Error('Failed to fetch MSA status');
      return res.json() as Promise<{
        has_current_msa: boolean;
        signed_current: boolean;
        current_msa_version: string | null;
        signature: any | null;
      }>;
    },
    enabled: !!clientId,
  });
}
