import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...(args as [string])) },
}));

import { buildListLimitParams, useDashboard } from '../use-dashboard';

describe('buildListLimitParams', () => {
  it('returns an empty string when no counts are loaded', () => {
    expect(buildListLimitParams({})).toBe('');
  });

  it('emits a limit_<list> param for a single loaded list', () => {
    expect(buildListLimitParams({ focusTasks: 20 })).toBe('&limit_focusTasks=20');
  });

  it('emits a param for each loaded list', () => {
    const result = buildListLimitParams({ focusTasks: 20, awaitingReview: 30 });
    expect(result).toContain('&limit_focusTasks=20');
    expect(result).toContain('&limit_awaitingReview=30');
  });

  it('omits lists with zero or undefined counts', () => {
    expect(buildListLimitParams({ focusTasks: 0, myTasks: undefined })).toBe('');
  });

  it('keeps only the positive counts when mixed', () => {
    expect(buildListLimitParams({ focusTasks: 0, myTasks: 10 })).toBe('&limit_myTasks=10');
  });
});

// Build a minimal PM dashboard payload whose myTasks list has `count` items.
function pmDashboard(count: number, total = 50) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`,
    title: `Task ${i}`,
    status: 'todo',
    priority: 1,
    is_focus: false,
    due_date: null,
    energy_estimate: null,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    estimated_minutes: null,
    project: null,
  }));
  return {
    role: 'pm',
    activeTimer: null,
    recentTimeEntries: [],
    focusTasks: { items: [], total: 0, hasMore: false },
    awaitingReview: { items: [], total: 0, hasMore: false },
    unassignedTasks: { items: [], total: 0, hasMore: false },
    myTasks: { items, total, hasMore: count < total },
    myProjects: [],
    retainerAlerts: [],
    recentCompletions: [],
    completedToday: [],
  };
}

describe('useDashboard load-more behavior', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  function makeWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  // Regression guard for the "load more reloads / scrolls to top" bug: loadMore
  // bumps loadedCounts, which changes the query key. Without keepPreviousData the
  // new key has no cache, so `data` flips to undefined mid-fetch and the page
  // swaps in its full-screen spinner (the jarring reload). With it, the prior
  // list stays rendered in place until the larger page arrives.
  it('keeps the previously loaded list visible while expanding', async () => {
    // First page (limit_myTasks absent) resolves immediately; the expansion
    // (limit_myTasks=20) is held pending so we can observe the in-flight state.
    let resolveExpansion: (v: unknown) => void = () => {};
    const expansion = new Promise((resolve) => {
      resolveExpansion = resolve;
    });
    getMock.mockImplementation((endpoint: string) => {
      const match = /limit_myTasks=(\d+)/.exec(endpoint);
      const count = match ? Number(match[1]) : 10;
      return count > 10 ? expansion : Promise.resolve(pmDashboard(10));
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect((result.current.data as ReturnType<typeof pmDashboard>).myTasks.items).toHaveLength(10);

    act(() => {
      result.current.loadMore('myTasks', 10);
    });

    // Mid-expansion: data must NOT vanish (no full-page spinner / scroll jump),
    // and the per-list spinner is on for the list being expanded.
    expect(result.current.data).toBeDefined();
    expect((result.current.data as ReturnType<typeof pmDashboard>).myTasks.items).toHaveLength(10);
    expect(result.current.isLoadingMore('myTasks')).toBe(true);

    await act(async () => {
      resolveExpansion(pmDashboard(20));
      await expansion;
    });

    await waitFor(() =>
      expect((result.current.data as ReturnType<typeof pmDashboard>).myTasks.items).toHaveLength(20)
    );
    expect(result.current.isLoadingMore('myTasks')).toBe(false);
  });
});
