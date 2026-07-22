'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Clarity Phase 3 — The Oracle Face: Today picks + the day/week calendar shape.

export type TodayPickItemType = 'arc' | 'task' | 'session' | 'lead' | 'note';
export type TodayPrimaryActionKind = 'respond' | 'resume' | 'arc' | 'quest' | 'charter' | 'toggle';

export interface TodayPick {
  id: string;
  date: string;
  item_type: TodayPickItemType;
  arc_id: string | null;
  arc: {
    id: string;
    name: string;
    status: 'empty' | 'open' | 'complete';
    task_count: number;
    // Clarity Phase 5 — the Soothsayer's day columns render "arc name + progress"; /api/today
    // itself never sets this (undefined there, unchanged behavior).
    progress_percent?: number;
    snoozed_until?: string | null;
  } | null;
  task_id: string | null;
  task: { id: string; title: string; status: string } | null;
  session_external_id: string | null;
  session: {
    external_id: string;
    title: string | null;
    status: string;
    remote_url: string | null;
    goal: string | null;
    // Clarity Phase 4c — parity fix: feeds the card's own quiet "waiting since <time>"
    // line, same signal the arc board's attention dot/session panel already use.
    needs_attention?: boolean;
    last_event_at?: string | null;
  } | null;
  charter_id: string | null;
  charter: { id: string; name: string } | null;
  label: string | null;
  sort: number;
  // Clarity Phase 4b — Today board lens's Doing column, persisted server-side.
  started_at: string | null;
  completed_at: string | null;
  primary_action: { kind: TodayPrimaryActionKind } | null;
  created_at: string;
  updated_at: string;
}

export interface TodayResponse {
  date: string;
  // Clarity Phase 3d — the resolved requester's IANA timezone (UserPreference.timezone
  // -> CITADEL_DISPLAY_TZ env -> America/New_York). `date` above is already computed
  // in this zone; render every rendered time client-side in THIS zone too, never the
  // browser's implicit locale zone.
  timezone: string;
  picks: TodayPick[];
  meta: { total: number; uncompleted: number; cap: number };
}

export interface TodayCalendarMeeting {
  id: string;
  title: string;
  start: string;
  end: string;
}

export interface TodayCalendarWeekDay {
  date: string;
  meeting_minutes: number;
  meetings_count: number;
  due_tasks_count: number;
}

export interface TodayCalendarResponse {
  date: string;
  // Clarity Phase 3d — see TodayResponse.timezone above; same resolution, same
  // requirement (format every rendered time/hour-axis in this zone).
  timezone: string;
  meetings: TodayCalendarMeeting[];
  // Clarity Phase 3b — all-day calendar events (e.g. "Home"/"Office" working-location
  // markers) for the day, excluded from the time-shape track entirely (no time cost, no
  // block placement) but still surfaced for context.
  allDay: TodayCalendarMeeting[];
  week: TodayCalendarWeekDay[];
}

export interface CreateTodayPickInput {
  date?: string;
  item_type: TodayPickItemType;
  arc_id?: string | null;
  task_id?: string | null;
  session_external_id?: string | null;
  charter_id?: string | null;
  label?: string | null;
  sort?: number;
}

export interface UpdateTodayPickInput {
  sort?: number;
  completed_at?: string | null;
  // Clarity Phase 4b — Today board lens drag: set on drop into Doing, cleared on drop back
  // into To do; preserved (untouched) when dropping into/out of Done.
  started_at?: string | null;
  label?: string | null;
}

// Clarity Phase 4a — the due-soon row at the foot of Today.
export interface DueSoonTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  due_date: string;
}

export interface DueSoonResponse {
  date: string;
  timezone: string;
  tasks: DueSoonTask[];
  meta: { total: number };
}

export const todayKeys = {
  all: ['today'] as const,
  picks: (date?: string) => [...todayKeys.all, 'picks', date ?? 'default'] as const,
  calendar: (date?: string) => [...todayKeys.all, 'calendar', date ?? 'default'] as const,
  dueSoon: (date?: string) => [...todayKeys.all, 'due-soon', date ?? 'default'] as const,
};

export function useTodayPicks(date?: string) {
  return useQuery({
    queryKey: todayKeys.picks(date),
    queryFn: () => apiClient.get<TodayResponse>('/today', { params: date ? { date } : undefined }),
  });
}

export function useTodayCalendar(date?: string) {
  return useQuery({
    queryKey: todayKeys.calendar(date),
    queryFn: () => apiClient.get<TodayCalendarResponse>('/today/calendar', { params: date ? { date } : undefined }),
  });
}

export function useDueSoonTasks(date?: string) {
  return useQuery({
    queryKey: todayKeys.dueSoon(date),
    queryFn: () => apiClient.get<DueSoonResponse>('/today/due-soon', { params: date ? { date } : undefined }),
  });
}

export function useCreateTodayPick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTodayPickInput) => apiClient.post<TodayPick>('/today', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todayKeys.all });
      // Clarity Phase 5 — the Soothsayer's "assign to day" action creates a pick through
      // this same mutation; its own read (GET /api/oracle/soothsayer) is a separate query
      // key, so it needs its own invalidation to reflect the new pick without a reload.
      queryClient.invalidateQueries({ queryKey: ['soothsayer'] });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add to Today');
    },
  });
}

export function useUpdateTodayPick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTodayPickInput }) =>
      apiClient.patch<TodayPick>(`/today/${id}`, data),
    onSuccess: () => {
      // Quiet completion: no toast on a plain toggle — the check-morph + count tick in the
      // UI is the feedback, per the evidence-bound "sub-second, quiet" completion rule.
      queryClient.invalidateQueries({ queryKey: todayKeys.all });
      queryClient.invalidateQueries({ queryKey: ['soothsayer'] });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update Today pick');
    },
  });
}

export function useDeleteTodayPick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/today/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todayKeys.all });
      queryClient.invalidateQueries({ queryKey: ['soothsayer'] });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to remove Today pick');
    },
  });
}
