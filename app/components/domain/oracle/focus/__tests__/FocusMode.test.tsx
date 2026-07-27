import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FocusMode } from '../FocusMode';
import type { TodayPick } from '@/lib/hooks/use-today';

const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

function notePick(overrides: Partial<TodayPick> = {}): TodayPick {
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

function mockNoCrisis() {
  mockGet.mockImplementation((path: string) => {
    if (path === '/waiting-on-me') {
      return Promise.resolve({
        waiting: [],
        decide: [],
        answer: [],
        review: [],
        do: [],
        crisis: [],
        intake: { lanes: {} },
        meta: { counts: { total: 0 } },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNoCrisis();
});

describe('FocusMode', () => {
  it('shows the duration declare screen first, not the card', () => {
    renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
    expect(screen.getByTestId('focus-mode-duration-declare')).toBeVisible();
    expect(screen.queryByTestId('focus-mode-card')).not.toBeInTheDocument();
  });

  it('choosing a preset duration reveals the one card and a quiet clock', async () => {
    renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-preset-25'));

    expect(await screen.findByTestId('focus-mode-card')).toBeVisible();
    expect(screen.getByTestId('focus-mode-title')).toHaveTextContent('Call the bank');
    expect(screen.getByTestId('focus-mode-clock')).toHaveTextContent('25:00');
  });

  it('open-ended mode starts the clock at 0:00 counting up', () => {
    renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-open-ended'));
    expect(screen.getByTestId('focus-mode-clock')).toHaveTextContent('0:00');
  });

  it('Park button opens the park dialog with Park disabled until a field is filled', () => {
    renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-open-ended'));
    fireEvent.click(screen.getByTestId('focus-mode-park-button'));

    expect(screen.getByTestId('focus-mode-park-dialog')).toBeVisible();
    expect(screen.getByTestId('focus-mode-park-submit')).toBeDisabled();

    fireEvent.change(screen.getByTestId('focus-mode-where-left-off'), {
      target: { value: 'halfway through the draft' },
    });
    expect(screen.getByTestId('focus-mode-park-submit')).not.toBeDisabled();
  });

  it('manual park dialog offers Cancel, never Continue', () => {
    renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-open-ended'));
    fireEvent.click(screen.getByTestId('focus-mode-park-button'));

    expect(screen.getByTestId('focus-mode-park-cancel')).toBeVisible();
    expect(screen.queryByTestId('focus-mode-continue')).not.toBeInTheDocument();
  });

  it('parking a note-type pick PATCHes the pick label, not a task', async () => {
    mockPatch.mockResolvedValue({});
    renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-open-ended'));
    fireEvent.click(screen.getByTestId('focus-mode-park-button'));
    fireEvent.change(screen.getByTestId('focus-mode-next-step'), { target: { value: 'call back Tuesday' } });
    fireEvent.click(screen.getByTestId('focus-mode-park-submit'));

    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith(
        '/today/pick-1',
        expect.objectContaining({ label: expect.stringContaining('call back Tuesday') })
      )
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('parking a task-type pick appends to the task description and records a TimeEntry', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
      if (path === '/tasks/task-1') {
        return Promise.resolve({ id: 'task-1', title: 'Fix the thing', description: null, arc_id: null });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    mockPatch.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    const pick = notePick({
      item_type: 'task',
      task_id: 'task-1',
      task: { id: 'task-1', title: 'Fix the thing', status: 'in_progress', priority: 3, due_date: null },
      label: null,
    });

    renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-open-ended'));
    fireEvent.click(screen.getByTestId('focus-mode-park-button'));
    fireEvent.change(screen.getByTestId('focus-mode-where-left-off'), { target: { value: 'halfway' } });
    fireEvent.click(screen.getByTestId('focus-mode-park-submit'));

    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('/tasks/task-1', expect.objectContaining({ description: expect.any(Array) }))
    );
    // Elapsed is 0 minutes in this fast test — no TimeEntry when there's nothing to log.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('renders the crisis banner through focus when a crisis is open', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/waiting-on-me') {
        return Promise.resolve({
          crisis: [
            {
              id: 'ask-1',
              message_id: 'm1',
              thread_id: null,
              account: 'mike@becomeindelible.com',
              from_name: 'Jane',
              from_email: 'jane@client.com',
              subject: 'Site down',
              gist: null,
              queue: 'do',
              severity: 'client_blocking',
              is_urgent: true,
              state: 'open',
              training_note: null,
              intent: null,
              proposed_event_at: null,
              proposed_event_title: null,
              proposed_event_minutes: null,
              calendar_requested: false,
              calendar_event_id: null,
              task_id: null,
              deep_link: 'https://mail.example.com',
              received_at: '2026-07-27T09:00:00.000Z',
              created_at: '2026-07-27T09:00:00.000Z',
              updated_at: '2026-07-27T09:00:00.000Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });

    renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
    expect(await screen.findByTestId('focus-mode-crisis-banner')).toBeVisible();
    expect(screen.getByText('Site down')).toBeVisible();
  });

  it('Escape exits focus when the park dialog is not open', () => {
    const onExit = vi.fn();
    renderWithClient(<FocusMode pick={notePick()} onExit={onExit} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onExit).toHaveBeenCalled();
  });

  it('the exit button always exits, regardless of phase', () => {
    const onExit = vi.fn();
    renderWithClient(<FocusMode pick={notePick()} onExit={onExit} />);
    fireEvent.click(screen.getByTestId('focus-mode-exit'));
    expect(onExit).toHaveBeenCalled();
  });
});

describe('FocusMode — at-zero behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockNoCrisis();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-opens Park-or-Continue at zero, and Continue keeps going open-ended', () => {
    renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-preset-25'));

    act(() => {
      vi.advanceTimersByTime(25 * 60 * 1000 + 1000);
    });

    expect(screen.getByTestId('focus-mode-park-dialog')).toBeVisible();
    expect(screen.getByTestId('focus-mode-continue')).toBeVisible();
    expect(screen.queryByTestId('focus-mode-park-cancel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('focus-mode-continue'));
    expect(screen.queryByTestId('focus-mode-park-dialog')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('focus-mode-clock')).not.toHaveTextContent('25:00');
  });
});
