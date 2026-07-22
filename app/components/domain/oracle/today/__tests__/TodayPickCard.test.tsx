import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TodayPickCard } from '../TodayPickCard';
import type { TodayPick } from '@/lib/hooks/use-today';

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({
    t: (key: string) => (key === 'task' ? 'Quest' : key === 'tasks' ? 'Quests' : key),
  }),
}));

// Clarity Phase 4b — the "quest" primary action now opens the peek instead of navigating.
const mockOpenTaskPeek = vi.fn();
vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: mockOpenTaskPeek }),
}));

const mockPatch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function questPick(overrides: Partial<TodayPick> = {}): TodayPick {
  return {
    id: 'pick-1',
    date: '2026-07-22',
    item_type: 'task',
    arc_id: null,
    arc: null,
    task_id: 'task-99',
    task: { id: 'task-99', title: 'Fix the thing', status: 'in_progress' },
    session_external_id: null,
    session: null,
    charter_id: null,
    charter: null,
    label: null,
    sort: 0,
    started_at: null,
    completed_at: null,
    primary_action: { kind: 'quest' },
    created_at: '2026-07-22T00:00:00.000Z',
    updated_at: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockOpenTaskPeek.mockClear();
  mockPatch.mockClear();
});

describe('TodayPickCard', () => {
  it('the quest action opens the peek with the task id, not a navigation link', () => {
    renderWithClient(<TodayPickCard pick={questPick()} />);

    const button = screen.getByRole('button', { name: /^quest$/i });
    expect(button).not.toHaveAttribute('href');

    fireEvent.click(button);
    expect(mockOpenTaskPeek).toHaveBeenCalledWith('task-99');
  });

  it('the arc action still navigates (arc board is a workspace, not a peek)', () => {
    renderWithClient(
      <TodayPickCard
        pick={questPick({
          item_type: 'arc',
          task_id: null,
          task: null,
          arc_id: 'arc-1',
          arc: { id: 'arc-1', name: 'Demo Arc', status: 'open', task_count: 3 },
          primary_action: { kind: 'arc' },
        })}
      />
    );

    const link = screen.getByRole('link', { name: /arc/i });
    expect(link).toHaveAttribute('href', '/oracle/arcs/arc-1');
    expect(mockOpenTaskPeek).not.toHaveBeenCalled();
  });
});
