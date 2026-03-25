'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/hooks/use-toast';
import { contractKeys, accordKeys } from '@/lib/api/query-keys';
import type { ContractWithRelations, UpdateContractInput } from '@/types/entities';

// List contracts for an accord
export function useContracts(accordId: string) {
  return useQuery({
    queryKey: contractKeys.byAccord(accordId),
    queryFn: async () => {
      const res = await fetch(`/api/accords/${accordId}/contracts`);
      if (!res.ok) throw new Error('Failed to fetch contracts');
      return res.json() as Promise<{ contracts: ContractWithRelations[]; total: number }>;
    },
    enabled: !!accordId,
  });
}

// Get single contract
export function useContract(accordId: string, contractId: string) {
  return useQuery({
    queryKey: contractKeys.detail(accordId, contractId),
    queryFn: async () => {
      const res = await fetch(`/api/accords/${accordId}/contracts/${contractId}`);
      if (!res.ok) throw new Error('Failed to fetch contract');
      return res.json() as Promise<ContractWithRelations>;
    },
    enabled: !!accordId && !!contractId,
  });
}

// Create contract (generate from accord)
export function useCreateContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accordId, data }: { accordId: string; data?: { msa_version_id?: string; content?: string } }) => {
      const res = await fetch(`/api/accords/${accordId}/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate contract');
      }
      return res.json() as Promise<ContractWithRelations>;
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byAccord(accordId) });
      showToast.created('Contract');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Update contract
export function useUpdateContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accordId, contractId, data }: { accordId: string; contractId: string; data: UpdateContractInput }) => {
      const res = await fetch(`/api/accords/${accordId}/contracts/${contractId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update contract');
      }
      return res.json() as Promise<ContractWithRelations>;
    },
    onSuccess: (_, { accordId, contractId }) => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(accordId, contractId) });
      showToast.updated('Contract');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Delete contract
export function useDeleteContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accordId, contractId }: { accordId: string; contractId: string }) => {
      const res = await fetch(`/api/accords/${accordId}/contracts/${contractId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete contract');
      }
      return res.json();
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byAccord(accordId) });
      showToast.deleted('Contract');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Send contract
export function useSendContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accordId, contractId }: { accordId: string; contractId: string }) => {
      const res = await fetch(`/api/accords/${accordId}/contracts/${contractId}/send`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send contract');
      }
      return res.json() as Promise<ContractWithRelations>;
    },
    onSuccess: (_, { accordId, contractId }) => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(accordId, contractId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.success('Contract sent');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}
