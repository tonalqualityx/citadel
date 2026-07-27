import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TodayBoard } from '../TodayBoard';
import type { TodayPick } from '@/lib/hooks/use-today';

vi.mock('@/lib/api/client', () => ({
  apiClient: { patch: vi.fn() },
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
    item_type: 'note',
    arc_id: null,
    arc: null,
    task_id: null,
    task: null,
    session_external_id: null,
    session: null,
    charter_id: null,
    charter: null,
    accord_id: null,
    accord: null,
    label: 'Call the bank',
    sort: 0,
    started_at: null,
    completed_at: null,
    calendar_event_id: null,
    primary_action: { kind: 'toggle' },
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('TodayBoard', () => {
  it('renders columns in Doing, To do, Done order', () => {
    renderWithClient(<TodayBoard picks={[]} />);
    const board = screen.getByTestId('today-board');
    const columnIds = Array.from(board.querySelectorAll('[data-testid^="today-board-column-"]')).map((el) =>
      el.getAttribute('data-testid')
    );
    expect(columnIds).toEqual([
      'today-board-column-doing',
      'today-board-column-todo',
      'today-board-column-done',
    ]);
  });

  it('renders Done collapsed by default — count shown, card hidden', () => {
    const donePick = pick({ id: 'done-1', label: 'Finished thing', completed_at: '2026-07-27T10:00:00.000Z' });
    renderWithClient(<TodayBoard picks={[donePick]} />);

    const doneColumn = screen.getByTestId('today-board-column-done');
    expect(doneColumn).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByText('Finished thing')).not.toBeInTheDocument();
    expect(screen.getByTestId('today-board-done-toggle')).toHaveTextContent('1 · Show');
  });

  it('clicking Show reveals the Done column cards', () => {
    const donePick = pick({ id: 'done-1', label: 'Finished thing', completed_at: '2026-07-27T10:00:00.000Z' });
    renderWithClient(<TodayBoard picks={[donePick]} />);

    fireEvent.click(screen.getByTestId('today-board-done-toggle'));

    expect(screen.getByText('Finished thing')).toBeVisible();
    expect(screen.getByTestId('today-board-done-toggle')).toHaveTextContent('1 · Hide');
  });

  it('a non-Done column never gets the collapse toggle', () => {
    renderWithClient(<TodayBoard picks={[pick({ id: 'todo-1' })]} />);
    expect(screen.getByTestId('today-board-column-todo').querySelector('[data-testid="today-board-done-toggle"]')).toBeNull();
  });
});
