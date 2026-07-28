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

  // Clarity Phase 7 (repair, 2026-07-27) — an active energy filter hiding every pick from
  // one column (To Do, in Mike's actual incident) must show why the column is empty, never
  // render a bare empty box that reads as data loss.
  describe('hidden-by-filter messaging', () => {
    it('shows nothing when hiddenCountByColumn is omitted (no active filter)', () => {
      renderWithClient(<TodayBoard picks={[]} />);
      expect(screen.queryByTestId('today-board-column-hidden')).not.toBeInTheDocument();
    });

    it('shows "N hidden by filter" in an empty column that the filter hid picks from', () => {
      renderWithClient(
        <TodayBoard picks={[]} hiddenCountByColumn={{ todo: 3, doing: 0, done: 0 }} />
      );
      const todoColumn = screen.getByTestId('today-board-column-todo');
      expect(todoColumn.querySelector('[data-testid="today-board-column-hidden"]')).toHaveTextContent(
        '3 hidden by filter'
      );
      // Columns the filter didn't empty stay silent.
      const doingColumn = screen.getByTestId('today-board-column-doing');
      expect(doingColumn.querySelector('[data-testid="today-board-column-hidden"]')).toBeNull();
    });

    it('never shows the hidden line for a column that genuinely has cards', () => {
      renderWithClient(
        <TodayBoard picks={[pick({ id: 'todo-1' })]} hiddenCountByColumn={{ todo: 5, doing: 0, done: 0 }} />
      );
      expect(
        screen.getByTestId('today-board-column-todo').querySelector('[data-testid="today-board-column-hidden"]')
      ).toBeNull();
    });

    it('"show all" calls onShowAllFilter', () => {
      const onShowAllFilter = vi.fn();
      renderWithClient(
        <TodayBoard picks={[]} hiddenCountByColumn={{ todo: 2, doing: 0, done: 0 }} onShowAllFilter={onShowAllFilter} />
      );
      fireEvent.click(screen.getByText('show all'));
      expect(onShowAllFilter).toHaveBeenCalled();
    });
  });
});
