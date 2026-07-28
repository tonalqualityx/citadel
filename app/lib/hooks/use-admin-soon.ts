'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

// Clarity Phase 8 (composition) — Process mode's admin-soon stage. See
// app/api/oracle/admin-soon/route.ts for the documented pragmatic filter.
export interface AdminSoonTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  due_date: string | null;
  promised_to: string | null;
  client: { id: string; name: string } | null;
  source_intent: 'admin' | null;
}

export interface AdminSoonResponse {
  tasks: AdminSoonTask[];
  meta: { total: number; cap: number };
}

export function useAdminSoonTasks() {
  return useQuery({
    queryKey: ['oracle', 'admin-soon'],
    queryFn: () => apiClient.get<AdminSoonResponse>('/oracle/admin-soon'),
  });
}
