'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import type { CreateOracleCommandInput, OracleCommandDTO, OracleFleetResponse } from '@/lib/types/oracle';

// Fleet-visualizer polling precedent: use-dashboard.ts. 30s interval, and — this is
// the presence gating: hidden tab = no polling.
export function useOracleFleet() {
  return useQuery({
    queryKey: ['oracle', 'fleet'],
    queryFn: () => apiClient.get<OracleFleetResponse>('/oracle/fleet'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

// Phase 1.5b — Remote Spawn. POST /api/oracle/commands (admin-only server-side; the
// page gate guarantees that here) queues a spawn_session command; the local
// dispatcher claims it within ~1 heartbeat minute. Invalidate the fleet query on
// success so the new command's pending chip shows up on the next poll/refetch
// without waiting the full 30s.
export function useCreateOracleCommand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateOracleCommandInput) =>
      apiClient.post<OracleCommandDTO & { machine: string }>('/oracle/commands', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oracle', 'fleet'] });
      showToast.success('Spawn session queued');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to queue spawn session');
    },
  });
}
