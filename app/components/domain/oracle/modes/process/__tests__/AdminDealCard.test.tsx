import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminDealCard } from '../AdminDealCard';
import { TimerProvider } from '@/lib/contexts/timer-context';
import type { AdminSoonTask } from '@/lib/hooks/use-admin-soon';

const mockGet = vi.fn();
const mockPatch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

const mockOpenTaskPeek = vi.fn();
vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: mockOpenTaskPeek }),
}));

const mockToastSuccess = vi.fn();
vi.mock('@/lib/hooks/use-toast', () => ({
  showToast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
    apiError: vi.fn(),
  },
}));

function task(overrides: Partial<AdminSoonTask> = {}): AdminSoonTask {
  return {
    id: 'task-1',
    title: 'Pay Tara',
    status: 'not_started',
    priority: 3,
    due_date: null,
    promised_to: null,
    client: null,
    source_intent: 'admin',
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
  mockGet.mockResolvedValue({ timer: null });
});

describe('AdminDealCard — honesty pass (Clarity Phase 8 shakedown)', () => {
  it('Done patches the task, toasts what happened, and advances the card', async () => {
    mockPatch.mockResolvedValue({ id: 'task-1', status: 'done' });
    const onRouted = vi.fn();
    renderWithClient(<AdminDealCard task={task()} onRouted={onRouted} />);

    fireEvent.click(screen.getByTestId('admin-deal-done'));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Marked done'));
    expect(onRouted).toHaveBeenCalledTimes(1);
  });

  it('Skip toasts that it stayed in the queue and advances the card, without touching the task', () => {
    const onRouted = vi.fn();
    renderWithClient(<AdminDealCard task={task()} onRouted={onRouted} />);

    fireEvent.click(screen.getByTestId('admin-deal-skip'));

    expect(mockToastSuccess).toHaveBeenCalledWith('Skipped — still in the queue');
    expect(onRouted).toHaveBeenCalledTimes(1);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('Open opens the task peek drawer (its own visible feedback — no toast expected)', () => {
    renderWithClient(<AdminDealCard task={task()} onRouted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('admin-deal-open'));
    expect(mockOpenTaskPeek).toHaveBeenCalledWith('task-1');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
