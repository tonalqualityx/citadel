import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NowStrip } from '../NowStrip';
import type { TodayPick } from '@/lib/hooks/use-today';

vi.mock('@/lib/api/client', () => ({
  apiClient: { patch: vi.fn(), get: vi.fn() },
}));
vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({ t: (k: string) => k }),
}));
vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: vi.fn() }),
}));

function pick(overrides: Partial<TodayPick> = {}): TodayPick {
  return {
    id: 'pick-1',
    date: '2026-07-27',
    item_type: 'task',
    arc_id: null,
    arc: null,
    task_id: 'task-1',
    task: { id: 'task-1', title: 'Do the thing', status: 'not_started', priority: 1, due_date: null, energy_estimate: null, battery_impact: null, mystery_factor: null  },
    session_external_id: null,
    session: null,
    charter_id: null,
    charter: null,
    accord_id: null,
    accord: null,
    label: null,
    sort: 0,
    started_at: null,
    completed_at: null,
    calendar_event_id: null,
    primary_action: { kind: 'quest' },
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('NowStrip', () => {
  it('renders nothing when there are no uncompleted picks', () => {
    const { container } = renderWithClient(<NowStrip picks={[]} todayDateStr="2026-07-27" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders up to 3 picks with a reason chip each', () => {
    const picks = [
      pick({ id: 'p1', task: { id: 't1', title: 'Task one', status: 'not_started', priority: 1, due_date: null, energy_estimate: null, battery_impact: null, mystery_factor: null  } }),
      pick({ id: 'p2', started_at: '2026-07-27T08:00:00.000Z' }),
    ];
    renderWithClient(<NowStrip picks={picks} todayDateStr="2026-07-27" />);

    expect(screen.getByTestId('now-strip')).toBeVisible();
    expect(screen.getAllByTestId('now-strip-reason-chip')).toHaveLength(2);
    expect(screen.getByText('P1')).toBeVisible();
    expect(screen.getByText('in progress')).toBeVisible();
  });
});
