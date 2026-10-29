import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: { apiError: vi.fn() } }));

import { useDesignFeed, feedInterval } from '../use-design';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
}
const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ next_poll_ms: 1500, events: [] });
});
afterEach(() => setVisibility('visible'));

describe('useDesignFeed', () => {
  it('sends visible=1 when the tab is visible', async () => {
    setVisibility('visible');
    renderHook(() => useDesignFeed('s1'), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls[0][0]).toBe('/design/sessions/s1/feed');
    expect(get.mock.calls[0][1].params.visible).toBe(1);
  });

  it('sends visible=0 when hidden', async () => {
    setVisibility('hidden');
    renderHook(() => useDesignFeed('s1'), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls[0][1].params.visible).toBe(0);
  });

  it('uses next_poll_ms while visible and 30 s while hidden', () => {
    setVisibility('visible');
    expect(feedInterval(1500)).toBe(1500);
    expect(feedInterval(undefined)).toBe(5000);
    setVisibility('hidden');
    expect(feedInterval(1500)).toBe(30_000);
  });
});
