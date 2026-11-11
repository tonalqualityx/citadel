import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: api }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useHomeCalendar, useHomeCalendarEvent, homeCalendarKey, homeCalendarEventKey, HOME_CALENDAR_STALE_MS } from '../use-home-calendar';

function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => api.get.mockReset());

describe('useHomeCalendar', () => {
  it('reads /home/calendar once', async () => {
    api.get.mockResolvedValue({ upcoming: [], later: [], earlier: [], all_day: null, tomorrow: null, soon: null });
    const { result } = renderHook(() => useHomeCalendar(), { wrapper: wrap(client()) });
    await waitFor(() => expect(result.current.data?.upcoming).toEqual([]));
    expect(api.get).toHaveBeenCalledWith('/home/calendar');
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('does nothing when switched off', () => {
    renderHook(() => useHomeCalendar(false), { wrapper: wrap(client()) });
    expect(api.get).not.toHaveBeenCalled();
  });
  it('is stale after 10 minutes, refetches on focus, and never on a timer; a failure is not retried', async () => {
    const qc = client();
    api.get.mockResolvedValue({ upcoming: [], later: [], earlier: [], all_day: null, tomorrow: null, soon: null });
    const { result } = renderHook(() => useHomeCalendar(), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const opts = qc.getQueryCache().find({ queryKey: homeCalendarKey })?.options as { staleTime: number; refetchOnWindowFocus: boolean; refetchInterval: unknown; retry: unknown };
    expect(opts.retry).toBe(false);
    expect(opts.staleTime).toBe(HOME_CALENDAR_STALE_MS);
    expect(HOME_CALENDAR_STALE_MS).toBe(600_000);
    expect(opts.refetchOnWindowFocus).toBe(true);
    expect(opts.refetchInterval).toBe(false);
  });
  it('its key sits under the home key', () => {
    expect(homeCalendarKey.slice(0, 1)).toEqual(['home']);
    expect(homeCalendarEventKey('e1').slice(0, 1)).toEqual(['home']);
  });
});

describe('useHomeCalendarEvent', () => {
  it('does nothing while no event is open', () => {
    const { result } = renderHook(() => useHomeCalendarEvent(null), { wrapper: wrap(client()) });
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
  it('reads /home/calendar/{id}, with infinite staleness and no cache after close', async () => {
    const qc = client();
    api.get.mockResolvedValue({ event: { id: 'e1' } });
    const { result } = renderHook(() => useHomeCalendarEvent('e1'), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.data?.event.id).toBe('e1'));
    expect(api.get).toHaveBeenCalledWith('/home/calendar/e1');
    const opts = qc.getQueryCache().find({ queryKey: homeCalendarEventKey('e1') })?.options as { staleTime: number; gcTime: number; refetchOnWindowFocus: boolean };
    expect(opts.staleTime).toBe(Infinity);
    expect(opts.gcTime).toBe(0);
    expect(opts.refetchOnWindowFocus).toBe(false);
  });
});
