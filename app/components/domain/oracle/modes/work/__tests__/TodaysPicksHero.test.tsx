import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TodaysPicksHero } from '../TodaysPicksHero';
import type { TodayPick } from '@/lib/hooks/use-today';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({ t: (k: string) => k }),
}));
vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: vi.fn() }),
}));
vi.mock('@/lib/contexts/focus-mode-context', () => ({
  useFocusMode: () => ({ enterFocus: vi.fn() }),
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

const noSessions: OracleSessionWithMachine[] = [];

// Clarity Phase 8 (shakedown, 2026-07-28) — the hero region IS the kanban board now (Mike's
// live shakedown: the old card-row hero dropped the board's columns/drag/soft-cap and made
// him hunt for the same picks again in Plan mode). These tests pin the shell contract: the
// "N of 3" note stays, the board renders in its place, and there is exactly one picks
// surface — no second grid anywhere in this component.
describe('TodaysPicksHero — the hero IS the board (Clarity Phase 8 shakedown)', () => {
  it('renders the Today board (doing/todo/done columns), not a card grid', () => {
    renderWithClient(
      <TodaysPicksHero picks={[pick()]} sessions={noSessions} todayDateStr="2026-07-27" />
    );
    expect(screen.getByTestId('today-board')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-grid')).not.toBeInTheDocument();
  });

  it('keeps the "N of 3 · sessions count toward the cap" note', () => {
    renderWithClient(
      <TodaysPicksHero
        picks={[pick({ id: 'a' }), pick({ id: 'b', completed_at: '2026-07-27T10:00:00.000Z' })]}
        sessions={noSessions}
        todayDateStr="2026-07-27"
      />
    );
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/sessions count toward the cap/)).toBeInTheDocument();
  });

  it('shows the empty-state copy and no board when there are no picks at all', () => {
    renderWithClient(<TodaysPicksHero picks={[]} sessions={noSessions} todayDateStr="2026-07-27" />);
    expect(screen.getByTestId('todays-picks-hero-empty')).toHaveTextContent('Nothing picked yet');
    expect(screen.queryByTestId('today-board')).not.toBeInTheDocument();
  });

  it('renders exactly one picks surface (no duplicate rendering of the same pick)', () => {
    renderWithClient(
      <TodaysPicksHero picks={[pick({ id: 'only-one' })]} sessions={noSessions} todayDateStr="2026-07-27" />
    );
    expect(screen.getAllByTestId('today-board-draggable-pick')).toHaveLength(1);
  });
});
