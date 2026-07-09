'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { OracleFleetResponse } from '@/lib/types/oracle';

// Fleet-visualizer polling precedent: use-dashboard.ts. 30s interval, and — this is
// the presence gating — no polling while the tab is hidden/backgrounded.
export function useOracleFleet() {
  return useQuery({
    queryKey: ['oracle', 'fleet'],
    queryFn: () => apiClient.get<OracleFleetResponse>('/oracle/fleet'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
