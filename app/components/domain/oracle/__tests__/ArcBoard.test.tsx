import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArcBoard } from '../ArcBoard';
import { TimerProvider } from '@/lib/contexts/timer-context';

const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    post: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({ t: (k: string) => k }),
}));

vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: vi.fn() }),
}));

function arcFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'arc-1',
    name: 'Demo arc',
    description: null,
    status: 'open',
    client_id: null,
    client: null,
    project_id: null,
    project: null,
    origin_session_external_id: null,
    closed_at: null,
    snoozed_until: null,
    estimate_override_minutes: null,
    estimated_minutes_total: 0,
    sessions: [],
    task_count: 0,
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
    tasks: [],
    email_asks: [],
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimerProvider>{ui}</TimerProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ArcBoard — close/reopen (Clarity Phase 7 completion nudge trigger)', () => {
  it('shows "Close arc" for an open arc', async () => {
    mockGet.mockResolvedValue(arcFixture());
    renderWithClient(<ArcBoard arcId="arc-1" />);

    expect(await screen.findByTestId('arc-board-close-toggle')).toHaveTextContent('Close arc');
  });

  it('shows "Reopen arc" for a closed arc', async () => {
    mockGet.mockResolvedValue(arcFixture({ closed_at: '2026-07-27T09:00:00.000Z' }));
    renderWithClient(<ArcBoard arcId="arc-1" />);

    expect(await screen.findByTestId('arc-board-close-toggle')).toHaveTextContent('Reopen arc');
  });

  it('clicking Close arc PATCHes closed_at', async () => {
    mockGet.mockResolvedValue(arcFixture());
    mockPatch.mockResolvedValue(arcFixture({ closed_at: '2026-07-27T10:00:00.000Z' }));
    renderWithClient(<ArcBoard arcId="arc-1" />);

    const button = await screen.findByTestId('arc-board-close-toggle');
    button.click();

    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('/arcs/arc-1', expect.objectContaining({ closed_at: expect.any(String) }))
    );
  });
});
