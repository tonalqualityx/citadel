'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { oracleProjectsKeys } from '@/lib/hooks/use-oracle-projects';

// Oracle Projects Tab Phase 3 — mutations for the next-step engine. No UI yet (Phase 4
// wires these into ProjectDrawer); this hook exists so the machine-side job's contract
// is exercised from the client side too, and so Phase 4 doesn't need to touch API
// plumbing. All four invalidate the projects feed so the card/drawer picks up the
// change on the next refetch (or immediately, via the 60s poll already wired in
// use-oracle-projects.ts).

export interface OverrideNextStepInput {
  text: string;
  // Mutually exclusive — provide at most one.
  owner_id?: string;
  owner_label?: string;
}

export interface NextStepWriteResult {
  next_step: {
    text: string;
    owner: { id: string; name: string } | null;
    owner_label: string | null;
    source: 'graph' | 'bast' | 'mike';
    at: string | null;
  };
}

export interface RefreshRequestResult {
  requested_at: string;
}

export interface RefreshAllResult extends RefreshRequestResult {
  count: number;
}

/** PATCH /api/oracle/projects/[id]/next-step — Mike's manual override. */
export function useOverrideNextStep(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: OverrideNextStepInput) =>
      apiClient.patch<NextStepWriteResult>(`/oracle/projects/${projectId}/next-step`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
      showToast.updated('Next step');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update the next step');
    },
  });
}

/** DELETE /api/oracle/projects/[id]/next-step — clears Mike's override. */
export function useClearNextStepOverride(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.delete(`/oracle/projects/${projectId}/next-step`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
      showToast.updated('Next step');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to clear the next-step override');
    },
  });
}

/** POST /api/oracle/projects/[id]/refresh — queue an on-demand refresh for one project. */
export function useRefreshNextStep(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.post<RefreshRequestResult>(`/oracle/projects/${projectId}/refresh`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
      showToast.success('Refresh queued');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to queue the refresh');
    },
  });
}

/** POST /api/oracle/projects/refresh — queue an on-demand refresh for every project. */
export function useRefreshAllNextSteps() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.post<RefreshAllResult>('/oracle/projects/refresh'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
      showToast.success('Refresh queued for all projects');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to queue the refresh');
    },
  });
}
