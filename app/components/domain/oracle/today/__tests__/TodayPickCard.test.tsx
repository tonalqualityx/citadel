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
    task: { id: 'task-99', title: 'Fix the thing', status: 'in_progress', priority: 3, due_date: null, energy_estimate: null, battery_impact: null, mystery_factor: null  },
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
  it('shows the Focus button by default', () => {
    renderWithClient(<TodayPickCard pick={questPick()} />);
    expect(screen.getByTestId('today-pick-focus-button')).toBeVisible();
  });

  it('hides the Focus button when showFocusButton is false (Soothsayer day columns)', () => {
    renderWithClient(<TodayPickCard pick={questPick()} showFocusButton={false} />);
    expect(screen.queryByTestId('today-pick-focus-button')).not.toBeInTheDocument();
  });

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

  // Clarity Phase 5 — the arc attention dot (legacy needs-attention session linked to this arc).
  it('renders the attention dot on an arc pick when hasAttentionDot is true', () => {
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
        hasAttentionDot
      />
    );
    expect(screen.getByTestId('arc-attention-dot')).toBeInTheDocument();
  });

  it('renders no attention dot when hasAttentionDot is false/absent', () => {
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
    expect(screen.queryByTestId('arc-attention-dot')).not.toBeInTheDocument();
  });

  it('never renders the attention dot on a non-arc pick even if hasAttentionDot is true', () => {
    renderWithClient(<TodayPickCard pick={questPick()} hasAttentionDot />);
    expect(screen.queryByTestId('arc-attention-dot')).not.toBeInTheDocument();
  });

  // Clarity Phase 4c — parity fix: a session-type pick's card renders the same quiet
  // "waiting since <time>" line the arc board's session panel does.
  describe('session pick waiting-since parity fix', () => {
    function sessionPick(overrides: Partial<TodayPick> = {}): TodayPick {
      return questPick({
        item_type: 'session',
        task_id: null,
        task: null,
        session_external_id: 'ext-1',
        session: {
          external_id: 'ext-1',
          title: 'A live session',
          status: 'waiting',
          remote_url: 'https://claude.ai/code/session_x',
          goal: null,
          needs_attention: true,
          last_event_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        },
        primary_action: { kind: 'respond' },
        ...overrides,
      });
    }

    it('renders the waiting-since line when the session is needs_attention', () => {
      renderWithClient(<TodayPickCard pick={sessionPick()} />);
      expect(screen.getByTestId('today-pick-waiting-since')).toHaveTextContent('waiting since 5m ago');
    });

    it('does not render the waiting-since line when needs_attention is false', () => {
      renderWithClient(
        <TodayPickCard pick={sessionPick({ session: { ...sessionPick().session!, needs_attention: false } })} />
      );
      expect(screen.queryByTestId('today-pick-waiting-since')).not.toBeInTheDocument();
    });

    it('does not render the waiting-since line without a last_event_at', () => {
      renderWithClient(
        <TodayPickCard pick={sessionPick({ session: { ...sessionPick().session!, last_event_at: null } })} />
      );
      expect(screen.queryByTestId('today-pick-waiting-since')).not.toBeInTheDocument();
    });

    it('does not render the waiting-since line on a non-session pick', () => {
      renderWithClient(<TodayPickCard pick={questPick()} />);
      expect(screen.queryByTestId('today-pick-waiting-since')).not.toBeInTheDocument();
    });
  });

  describe('cover band (Clarity Phase 7)', () => {
    it('renders no cover band when the task has no cover_url', () => {
      renderWithClient(<TodayPickCard pick={questPick()} />);
      expect(screen.queryByTestId('card-cover-band')).not.toBeInTheDocument();
    });

    it("renders the task's cover_url when present", () => {
      const pick = questPick({
        task: { ...questPick().task!, cover_url: '/covers/some-cover.jpg' },
      });
      renderWithClient(<TodayPickCard pick={pick} />);
      const img = screen.getByTestId('card-cover-band').querySelector('img');
      expect(img).toHaveAttribute('src', '/covers/some-cover.jpg');
    });

    it("prefers the arc's cover_url over the task's for an arc-type pick", () => {
      const pick = questPick({
        item_type: 'arc',
        arc_id: 'arc-1',
        arc: { id: 'arc-1', name: 'An arc', status: 'open', task_count: 2, cover_url: '/covers/arc-cover.jpg' },
        task_id: null,
        task: null,
      });
      renderWithClient(<TodayPickCard pick={pick} />);
      const img = screen.getByTestId('card-cover-band').querySelector('img');
      expect(img).toHaveAttribute('src', '/covers/arc-cover.jpg');
    });
  });
});
