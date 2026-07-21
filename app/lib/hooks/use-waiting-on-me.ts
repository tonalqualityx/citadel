'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

// Clarity Phase 1/3 — the merged "everything waiting on Mike" feed backing the Oracle's
// Needs Reshi section (Decide/Answer/Review columns; `do` is fetched but deliberately not
// rendered there — DO-work surfaces via Today/quests instead, per the mockup's own note).

export interface WaitingOnMeCard {
  type: 'task' | 'session_ask';
  id: string;
  title: string | null;
  status: string;
  priority: number | null;
  severity: 'client_blocking' | 'launch_blocking' | 'internal' | null;
  task_id: string | null;
  session_external_id: string | null;
  arc: { id: string; name: string } | null;
  due_date: string | null;
}

export interface WaitingOnMeResponse {
  decide: WaitingOnMeCard[];
  answer: WaitingOnMeCard[];
  review: WaitingOnMeCard[];
  do: WaitingOnMeCard[];
  meta: { counts: { decide: number; answer: number; review: number; do: number; total: number } };
}

export function useWaitingOnMe(userId?: string) {
  return useQuery({
    queryKey: ['waiting-on-me', userId ?? 'self'],
    queryFn: () =>
      apiClient.get<WaitingOnMeResponse>('/waiting-on-me', { params: userId ? { user_id: userId } : undefined }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
