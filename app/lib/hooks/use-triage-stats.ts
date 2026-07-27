'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q11) — the triage visibility chip: "N
// auto-archived today" (anti-silent-triage — the classifier's archiving must carry a
// checkable count, never happen invisibly). Phase 4 wires the classifier's POST; this
// reads whatever the count is right now (0 until that's wired).

export interface TriageStatsResponse {
  date: string;
  archived_count: number;
}

export function useTriageStats() {
  return useQuery({
    queryKey: ['triage-stats', 'today'],
    queryFn: () => apiClient.get<TriageStatsResponse>('/oracle/triage-stats'),
    refetchInterval: 5 * 60_000,
  });
}
