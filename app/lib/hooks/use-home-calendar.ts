'use client';

/**
 * Client hooks for today's calendar on the home screen (Slice 10a): the strip
 * (GET /api/home/calendar) and the meeting drawer (GET /api/home/calendar/[id]). Both keys sit
 * under HOME_KEYS.all, so the refetch every item action already does also refreshes them.
 *
 * The strip refetches on window focus only when its data is stale (10 minutes), and never on a
 * timer. A 403 (another admin, or an API key) is not retried: the strip just stays empty.
 * The drawer never refetches on focus, reconnect or a timer: nothing may move while he reads it.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { HOME_KEYS } from '@/lib/hooks/use-home';
import type { HomeCalendarEventResponse, HomeCalendarStrip } from '@/lib/home/calendar/types';

export const HOME_CALENDAR_STALE_MS = 10 * 60 * 1000;

export const homeCalendarKey = [...HOME_KEYS.all, 'calendar'] as const;
export const homeCalendarEventKey = (eventId: string) => [...HOME_KEYS.all, 'calendar-event', eventId] as const;

export function useHomeCalendar(enabled = true) {
  return useQuery({
    queryKey: homeCalendarKey,
    queryFn: () => apiClient.get<HomeCalendarStrip>('/home/calendar'),
    enabled,
    staleTime: HOME_CALENDAR_STALE_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: false,
  });
}

export function useHomeCalendarEvent(eventId: string | null) {
  return useQuery({
    queryKey: homeCalendarEventKey(eventId ?? 'none'),
    queryFn: () => apiClient.get<HomeCalendarEventResponse>(`/home/calendar/${eventId}`),
    enabled: eventId !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
  });
}
