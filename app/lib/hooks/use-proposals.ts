'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/hooks/use-toast';
import { proposalKeys, accordKeys } from '@/lib/api/query-keys';
import type { ProposalWithRelations, CreateProposalInput, UpdateProposalInput } from '@/types/entities';

// List proposals for an accord
export function useProposals(accordId: string) {
  return useQuery({
    queryKey: proposalKeys.byAccord(accordId),
    queryFn: async () => {
      const res = await fetch(`/api/accords/${accordId}/proposals`);
      if (!res.ok) throw new Error('Failed to fetch proposals');
      return res.json() as Promise<{ proposals: ProposalWithRelations[]; total: number }>;
    },
    enabled: !!accordId,
  });
}

// Get single proposal
export function useProposal(accordId: string, proposalId: string) {
  return useQuery({
    queryKey: proposalKeys.detail(accordId, proposalId),
    queryFn: async () => {
      const res = await fetch(`/api/accords/${accordId}/proposals/${proposalId}`);
      if (!res.ok) throw new Error('Failed to fetch proposal');
      return res.json() as Promise<ProposalWithRelations>;
    },
    enabled: !!accordId && !!proposalId,
  });
}

// Create proposal
export function useCreateProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accordId, data }: { accordId: string; data?: CreateProposalInput }) => {
      const res = await fetch(`/api/accords/${accordId}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create proposal');
      }
      return res.json() as Promise<ProposalWithRelations>;
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: proposalKeys.byAccord(accordId) });
      showToast.created('Proposal');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Update proposal
export function useUpdateProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accordId, proposalId, data }: { accordId: string; proposalId: string; data: UpdateProposalInput }) => {
      const res = await fetch(`/api/accords/${accordId}/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update proposal');
      }
      return res.json() as Promise<ProposalWithRelations>;
    },
    onSuccess: (_, { accordId, proposalId }) => {
      queryClient.invalidateQueries({ queryKey: proposalKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: proposalKeys.detail(accordId, proposalId) });
      showToast.updated('Proposal');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Delete proposal
export function useDeleteProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accordId, proposalId }: { accordId: string; proposalId: string }) => {
      const res = await fetch(`/api/accords/${accordId}/proposals/${proposalId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete proposal');
      }
      return res.json();
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: proposalKeys.byAccord(accordId) });
      showToast.deleted('Proposal');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}

// Send proposal
export function useSendProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accordId, proposalId }: { accordId: string; proposalId: string }) => {
      const res = await fetch(`/api/accords/${accordId}/proposals/${proposalId}/send`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send proposal');
      }
      return res.json() as Promise<ProposalWithRelations>;
    },
    onSuccess: (_, { accordId, proposalId }) => {
      queryClient.invalidateQueries({ queryKey: proposalKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: proposalKeys.detail(accordId, proposalId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.success('Proposal sent');
    },
    onError: (error: Error) => {
      showToast.error(error.message);
    },
  });
}
