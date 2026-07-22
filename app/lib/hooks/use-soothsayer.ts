'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { TodayPick } from '@/lib/hooks/use-today';

// Clarity Phase 5 — The Soothsayer: the week-plan visualization at /oracle/soothsayer.
// Single consolidated read backing the whole page (day columns, unplanned section, snoozed
// row) — "dumb data" like /api/today/calendar, encoding lives client-side.

export interface SoothsayerArc {
  id: string;
  name: string;
  status: 'empty' | 'open' | 'complete';
  client_id: string | null;
  client: { id: string; name: string } | null;
  task_count: number;
  progress_percent: number;
  snoozed_until: string | null;
}

export interface SoothsayerSession {
  external_id: string;
  title: string | null;
  status: string;
  remote_url: string | null;
  goal: string | null;
  cwd: string | null;
}

export interface SoothsayerDay {
  date: string;
  picks: TodayPick[];
  meeting_count: number;
  meeting_minutes: number;
}

export interface SoothsayerResponse {
  timezone: string;
  days: SoothsayerDay[];
  unplanned: {
    arcs: SoothsayerArc[];
    sessions: SoothsayerSession[];
  };
  snoozed: {
    arcs: SoothsayerArc[];
  };
  meta: { windowStart: string; windowEnd: string; windowEndInstant: string };
}

export const soothsayerKeys = {
  all: ['soothsayer'] as const,
  detail: (date?: string) => [...soothsayerKeys.all, date ?? 'default'] as const,
};

export function useSoothsayer(date?: string) {
  return useQuery({
    queryKey: soothsayerKeys.detail(date),
    queryFn: () => apiClient.get<SoothsayerResponse>('/oracle/soothsayer', { params: date ? { date } : undefined }),
  });
}
