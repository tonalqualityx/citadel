import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: { apiError: vi.fn() } }));

import { useDesignFeedHistory } from '../use-design';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};
const ev = (seq: number) => ({ seq, role: 'assistant', kind: 'text', payload: { text: `m${seq}` }, created_at: 'x' });

beforeEach(() => get.mockReset());

describe('useDesignFeedHistory', () => {
  it('pages from after=0 through has_more and merges without duplicates', async () => {
    get
      .mockResolvedValueOnce({ events: [ev(1), ev(2)], has_more: true, last_seq: 2, next_poll_ms: 1500 })
      .mockResolvedValueOnce({ events: [ev(2), ev(3)], has_more: false, last_seq: 3, next_poll_ms: 1500 });
    const { result } = renderHook(() => useDesignFeedHistory('s1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.state.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(get.mock.calls.map((c) => c[1].params.after)).toEqual([0, 2]);
  });
});
