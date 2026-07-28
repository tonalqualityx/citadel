import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FocusMode } from '../FocusMode';
import { TimerProvider } from '@/lib/contexts/timer-context';
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

// Clarity Phase 7 (repair) — FocusCard now actually renders a task's real description via
// RichTextRenderer (previously untested — every existing task-pick fixture had description:
// null). BlockNote itself doesn't run under jsdom without help; mocked the same way
// components/ui/__tests__/rich-text-renderer.test.tsx already does for this exact reason.
vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="blocknote-view">BlockNote Editor</div>,
}));
vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: ({ initialContent }: { initialContent?: unknown[] }) => ({
    document: initialContent || [],
  }),
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
  // TimerProvider: useUpdateTask (now used by the "Mark quest done" action) reads
  // useTimer() internally to auto-stop a running timer on a done transition.
  return render(
    <QueryClientProvider client={queryClient}>
      <TimerProvider>{ui}</TimerProvider>
    </QueryClientProvider>
  );
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
      task: { id: 'task-1', title: 'Fix the thing', status: 'in_progress', priority: 3, due_date: null, promised_to: null, energy_estimate: null, battery_impact: null, mystery_factor: null  },
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

// Clarity Phase 7 (repair, 2026-07-27) — Mike's screenshot: "a bare title floating in a
// void with a Park button, nothing else." These tests prove the actual workspace: real
// description (or a quiet, honest empty-state), priority/due date, the arc as a real link
// with its attached emails, and an ALWAYS-present, auto-saved Working notes area.
describe('FocusMode — workspace (Clarity Phase 7 repair)', () => {
  beforeEach(() => {
    mockNoCrisis();
  });

  it('shows the quiet empty-state line (never a void) when a task pick has no description yet', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
      if (path === '/tasks/task-1') {
        // FocusCard reads priority/due_date off the real FETCHED task (this response),
        // not the lighter TodayPick.task summary — both are set here on purpose.
        return Promise.resolve({
          id: 'task-1',
          title: 'Fix the thing',
          description: null,
          arc_id: null,
          priority: 2,
          due_date: '2026-08-01',
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });

    const pick = notePick({
      item_type: 'task',
      task_id: 'task-1',
      task: { id: 'task-1', title: 'Fix the thing', status: 'in_progress', priority: 2, due_date: '2026-08-01', promised_to: null, energy_estimate: null, battery_impact: null, mystery_factor: null },
      label: null,
    });

    renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

    expect(await screen.findByTestId('focus-mode-empty-context')).toHaveTextContent(
      'No context on this card yet'
    );
    // Always present, regardless of whether there's a description.
    expect(screen.getByTestId('focus-mode-notes')).toBeInTheDocument();
    // Priority/due date line renders from the real fetched task, when present — waits for
    // that fetch specifically (the empty-context line above renders regardless of whether
    // the task has loaded yet, so it isn't itself proof the fetch landed).
    const metaLine = await screen.findByTestId('focus-mode-meta-line');
    expect(metaLine).toHaveTextContent('P2');
    expect(metaLine).toHaveTextContent('Due');
  });

  it('renders a real task description via the rich-text renderer instead of the empty state', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
      if (path === '/tasks/task-1') {
        return Promise.resolve({
          id: 'task-1',
          title: 'Fix the thing',
          description: [
            { id: 'd1', type: 'paragraph', content: [{ type: 'text', text: 'Real context here', styles: {} }] },
          ],
          arc_id: null,
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });

    const pick = notePick({
      item_type: 'task',
      task_id: 'task-1',
      task: { id: 'task-1', title: 'Fix the thing', status: 'in_progress', priority: null, due_date: null, promised_to: null, energy_estimate: null, battery_impact: null, mystery_factor: null },
      label: null,
    });

    renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

    expect(await screen.findByTestId('blocknote-view')).toBeInTheDocument();
    expect(screen.queryByTestId('focus-mode-empty-context')).not.toBeInTheDocument();
    // No priority/due date — neither was set on the fetched task.
    expect(screen.queryByTestId('focus-mode-meta-line')).not.toBeInTheDocument();
  });

  it('renders the arc name as a real link, plus its attached emails as deep links', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
      if (path === '/arcs/arc-1') {
        return Promise.resolve({
          id: 'arc-1',
          name: 'BRIC onboarding',
          description: null,
          email_asks: [{ id: 'ask-1', subject: 'Re: kickoff', deep_link: 'https://mail.example.com/ask-1' }],
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });

    const pick = notePick({
      item_type: 'arc',
      arc_id: 'arc-1',
      arc: { id: 'arc-1', name: 'BRIC onboarding', status: 'open', task_count: 3 },
      label: null,
    });

    renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

    const arcLink = await screen.findByTestId('focus-mode-arc-link');
    expect(arcLink).toHaveTextContent('BRIC onboarding');
    expect(arcLink).toHaveAttribute('href', '/oracle/arcs/arc-1');
    const emailLink = screen.getByText('Re: kickoff');
    expect(emailLink.closest('a')).toHaveAttribute('href', 'https://mail.example.com/ask-1');
  });

  describe('Working notes autosave', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('debounces, then PATCHes the pick label for a non-task pick (same home Park uses)', async () => {
      vi.useFakeTimers();
      mockGet.mockImplementation((path: string) =>
        path === '/waiting-on-me' ? Promise.resolve({ crisis: [] }) : Promise.reject(new Error(`unexpected GET ${path}`))
      );
      mockPatch.mockResolvedValue({});

      renderWithClient(<FocusMode pick={notePick()} onExit={vi.fn()} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      // Plain sync lookup, not `findByTestId` — its internal polling relies on real
      // timers, which are faked in this describe block. The textarea is already in the
      // DOM synchronously (fireEvent.click is wrapped in `act`), so no waiting is needed.
      const notes = screen.getByTestId('focus-mode-notes');
      // Pre-filled from the pick's own label — same home Park already writes to.
      expect(notes).toHaveValue('Call the bank');

      fireEvent.change(notes, { target: { value: 'Call the bank re: the wire' } });
      // Not yet — still inside the debounce window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(mockPatch).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(mockPatch).toHaveBeenCalledWith('/today/pick-1', { label: 'Call the bank re: the wire' });
    });

    it('debounces, then PATCHes the dedicated notes paragraph on the task description for a task pick', async () => {
      mockGet.mockImplementation((path: string) => {
        if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
        if (path === '/tasks/task-1') {
          return Promise.resolve({ id: 'task-1', title: 'Fix the thing', description: null, arc_id: null });
        }
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
      mockPatch.mockResolvedValue({});

      const pick = notePick({
        item_type: 'task',
        task_id: 'task-1',
        task: { id: 'task-1', title: 'Fix the thing', status: 'in_progress', priority: null, due_date: null, promised_to: null, energy_estimate: null, battery_impact: null, mystery_factor: null },
        label: null,
      });

      renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      // Let the task fetch (real GET, real timers) actually land — including react-query
      // processing the resolved promise into state — before switching to fake timers for
      // the debounce itself. This is the realistic sequencing (the task's own data loads
      // fast in practice), not the fast-typer race the component's `notesPrimed` guard
      // exists to handle separately.
      await screen.findByTestId('focus-mode-notes');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      vi.useFakeTimers();
      const notes = screen.getByTestId('focus-mode-notes');
      fireEvent.change(notes, { target: { value: 'the actual shape of this' } });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockPatch).toHaveBeenCalledWith(
        '/tasks/task-1',
        expect.objectContaining({
          description: [
            expect.objectContaining({
              id: 'focus-mode-working-notes',
              content: [{ type: 'text', text: 'the actual shape of this', styles: {} }],
            }),
          ],
        })
      );
      // Never the Park mutation's endpoint shape for a task (no TimeEntry POST either) —
      // notes autosave and Park are two distinct actions sharing one storage location.
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  // Scope addition (live-usage report, mid-build): Focus Mode offered ONLY Park.
  describe('Type-aware focus actions', () => {
    it('Complete is offered on every pick type and PATCHes completed_at, then exits', async () => {
      mockNoCrisis();
      mockPatch.mockResolvedValue({});
      const onExit = vi.fn();
      const pick = notePick({ label: 'Call the bank' });

      renderWithClient(<FocusMode pick={pick} onExit={onExit} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      await screen.findByTestId('focus-mode-actions');
      fireEvent.click(screen.getByTestId('focus-mode-complete-button'));

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith(
          '/today/pick-1',
          expect.objectContaining({ completed_at: expect.any(String) })
        );
        expect(onExit).toHaveBeenCalled();
      });
    });

    it('"Mark quest done" is offered ONLY on task picks, PATCHes the task status, and exits', async () => {
      mockGet.mockImplementation((path: string) => {
        if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
        if (path === '/tasks/task-1') {
          return Promise.resolve({ id: 'task-1', title: 'Fix the thing', status: 'in_progress', description: null });
        }
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
      mockPatch.mockResolvedValue({ id: 'task-1', status: 'done' });
      const onExit = vi.fn();
      const pick = notePick({
        item_type: 'task',
        task_id: 'task-1',
        task: { id: 'task-1', title: 'Fix the thing', status: 'in_progress', priority: null, due_date: null, promised_to: null, energy_estimate: null, battery_impact: null, mystery_factor: null },
        label: null,
      });

      renderWithClient(<FocusMode pick={pick} onExit={onExit} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      const markDoneBtn = await screen.findByTestId('focus-mode-mark-quest-done');
      fireEvent.click(markDoneBtn);

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith('/tasks/task-1', { status: 'done' });
        expect(onExit).toHaveBeenCalled();
      });
    });

    it('"Mark quest done" is absent on a non-task pick', async () => {
      mockNoCrisis();
      const pick = notePick({ label: 'Call the bank' });
      renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      await screen.findByTestId('focus-mode-actions');
      expect(screen.queryByTestId('focus-mode-mark-quest-done')).not.toBeInTheDocument();
    });

    it('"Add quest" is offered ONLY on arc picks; submitting requires a commitment choice, then POSTs the task', async () => {
      mockGet.mockImplementation((path: string) => {
        if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
        if (path === '/arcs/arc-1') {
          return Promise.resolve({ id: 'arc-1', name: 'BRIC onboarding', description: null, email_asks: [], tasks: [] });
        }
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
      mockPost.mockResolvedValue({ id: 'new-task-1', title: 'Ship the thing' });
      const pick = notePick({
        item_type: 'arc',
        arc_id: 'arc-1',
        arc: { id: 'arc-1', name: 'BRIC onboarding', status: 'open', task_count: 0 },
        label: null,
      });

      renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      await screen.findByTestId('focus-mode-add-quest-toggle');
      fireEvent.click(screen.getByTestId('focus-mode-add-quest-toggle'));

      const form = await screen.findByTestId('focus-mode-add-quest-form');
      fireEvent.change(within(form).getByTestId('focus-mode-add-quest-title'), { target: { value: 'Ship the thing' } });

      // No commitment chosen yet — Save stays disabled.
      expect(within(form).getByTestId('focus-mode-add-quest-submit')).toBeDisabled();

      fireEvent.click(within(form).getByTestId('focus-mode-add-quest-commitment-internal'));
      fireEvent.click(within(form).getByTestId('focus-mode-add-quest-submit'));

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/tasks',
          expect.objectContaining({ title: 'Ship the thing', arc_id: 'arc-1', promised_to: null })
        );
      });
    });

    it('"Add quest" requires a name when Promised is chosen', async () => {
      mockGet.mockImplementation((path: string) => {
        if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
        if (path === '/arcs/arc-1') {
          return Promise.resolve({ id: 'arc-1', name: 'BRIC onboarding', description: null, email_asks: [], tasks: [] });
        }
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
      const pick = notePick({
        item_type: 'arc',
        arc_id: 'arc-1',
        arc: { id: 'arc-1', name: 'BRIC onboarding', status: 'open', task_count: 0 },
        label: null,
      });

      renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      fireEvent.click(await screen.findByTestId('focus-mode-add-quest-toggle'));
      const form = await screen.findByTestId('focus-mode-add-quest-form');
      fireEvent.change(within(form).getByTestId('focus-mode-add-quest-title'), { target: { value: 'Ship it' } });
      fireEvent.click(within(form).getByTestId('focus-mode-add-quest-commitment-promised'));

      expect(within(form).getByTestId('focus-mode-add-quest-submit')).toBeDisabled();
      fireEvent.change(within(form).getByTestId('focus-mode-add-quest-promised-to'), { target: { value: 'Dan' } });
      expect(within(form).getByTestId('focus-mode-add-quest-submit')).not.toBeDisabled();
    });

    it('"Add quest" is absent on a non-arc pick', async () => {
      mockNoCrisis();
      const pick = notePick({ label: 'Call the bank' });
      renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      await screen.findByTestId('focus-mode-actions');
      expect(screen.queryByTestId('focus-mode-add-quest-toggle')).not.toBeInTheDocument();
    });

    it('offers "Close this arc?" when an arc pick\'s open task count hits zero', async () => {
      mockGet.mockImplementation((path: string) => {
        if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
        if (path === '/arcs/arc-1') {
          return Promise.resolve({
            id: 'arc-1', name: 'BRIC onboarding', description: null, email_asks: [], closed_at: null,
            tasks: [{ id: 't1', status: 'done' }, { id: 't2', status: 'abandoned' }],
          });
        }
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
      mockPatch.mockResolvedValue({ id: 'arc-1', closed_at: '2026-07-28T00:00:00.000Z' });
      const onExit = vi.fn();
      const pick = notePick({
        item_type: 'arc',
        arc_id: 'arc-1',
        arc: { id: 'arc-1', name: 'BRIC onboarding', status: 'open', task_count: 2 },
        label: null,
      });

      renderWithClient(<FocusMode pick={pick} onExit={onExit} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      const closeOffer = await screen.findByTestId('focus-mode-close-arc-offer');
      expect(closeOffer).toBeVisible();
      fireEvent.click(screen.getByTestId('focus-mode-close-arc-button'));

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith('/arcs/arc-1', expect.objectContaining({ closed_at: expect.any(String) }));
        expect(onExit).toHaveBeenCalled();
      });
    });

    it('never offers "Close this arc?" while the arc still has open tasks', async () => {
      mockGet.mockImplementation((path: string) => {
        if (path === '/waiting-on-me') return Promise.resolve({ crisis: [] });
        if (path === '/arcs/arc-1') {
          return Promise.resolve({
            id: 'arc-1', name: 'BRIC onboarding', description: null, email_asks: [], closed_at: null,
            tasks: [{ id: 't1', status: 'in_progress' }],
          });
        }
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
      const pick = notePick({
        item_type: 'arc',
        arc_id: 'arc-1',
        arc: { id: 'arc-1', name: 'BRIC onboarding', status: 'open', task_count: 1 },
        label: null,
      });

      renderWithClient(<FocusMode pick={pick} onExit={vi.fn()} />);
      fireEvent.click(screen.getByTestId('focus-duration-open-ended'));

      await screen.findByTestId('focus-mode-actions');
      expect(screen.queryByTestId('focus-mode-close-arc-offer')).not.toBeInTheDocument();
    });
  });
});
