import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: api }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useHomeProject, homeProjectKey } from '../use-home-project';

function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => api.get.mockReset());

describe('useHomeProject', () => {
  it('does nothing while no project is open', () => {
    const { result } = renderHook(() => useHomeProject(null), { wrapper: wrap(client()) });
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
  it('reads /home/projects/{id} once', async () => {
    api.get.mockResolvedValue({ project: { id: 'p1', name: 'P', client: null }, items: [], waits: [] });
    const { result } = renderHook(() => useHomeProject('p1'), { wrapper: wrap(client()) });
    await waitFor(() => expect(result.current.data?.project.id).toBe('p1'));
    expect(api.get).toHaveBeenCalledWith('/home/projects/p1');
  });
  it('its key sits under the home key, so the refetch after an item action also refreshes it', () => {
    expect(homeProjectKey('p1').slice(0, 1)).toEqual(['home']);
  });
});
