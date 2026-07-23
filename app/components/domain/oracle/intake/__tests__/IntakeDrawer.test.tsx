import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntakeDrawer } from '../IntakeDrawer';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

// Clarity Phase 4b — Create + open now peeks the new quest via TaskPeekContext instead of
// navigating (`router.push`) — mock the context hook to assert the peek call directly.
const mockOpenTaskPeek = vi.fn();
vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: mockOpenTaskPeek }),
}));

const mockPatch = vi.fn();
const mockPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    patch: (...args: unknown[]) => mockPatch(...args),
    post: (...args: unknown[]) => mockPost(...args),
    get: vi.fn(),
  },
}));

function ask(overrides: Partial<EmailAsk> = {}): EmailAsk {
  return {
    id: 'ask-1',
    message_id: 'msg-1',
    thread_id: null,
    account: 'mike@becomeindelible.com',
    from_name: 'Jane Client',
    from_email: 'jane@herba.com',
    subject: 'Question about invoice',
    gist: 'Client asking about last invoice',
    queue: 'answer',
    severity: null,
    is_urgent: false,
    state: 'open',
    training_note: null,
    // Clarity Phase 6 defaults: null intent -> general lane, no parsed meeting time.
    intent: null,
    proposed_event_at: null,
    proposed_event_title: null,
    proposed_event_minutes: null,
    calendar_requested: false,
    calendar_event_id: null,
    task_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: '2026-07-21T20:00:00.000Z',
    created_at: '2026-07-21T20:00:00.000Z',
    updated_at: '2026-07-21T20:00:00.000Z',
    ...overrides,
  };
}

// Clarity Phase 6 — every `intake` prop below needs a `lanes` summary now; this default
// (single default-fixture ask, which is general-lane) is what most existing tests want.
const GENERAL_ONLY_LANES = { general: 1, meeting: 0, sales: 0 };

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockOpenTaskPeek.mockClear();
  mockPatch.mockClear();
  mockPost.mockClear();
});

// Clarity Phase 4b — Mike's ruling: Intake relocated out of the main column into a compact
// header chip that opens a slide-over drawer (reusing the same Drawer primitives the quest
// peek uses). The drawer lazy-mounts on first open — not in the DOM until the trigger's
// first click, to avoid two permanently-mounted `forceMount` Dialog.Content layers (this
// one + the quest peek drawer, both on /oracle) fighting over which one Escape targets
// (see IntakeDrawer.tsx's own comment). Once mounted, "open vs closed" is asserted via
// Radix's own `data-state` attribute rather than DOM presence (it stays mounted afterward
// to animate closed via CSS), same approach as the e2e coverage.
describe('IntakeDrawer', () => {
  it('renders a compact trigger chip with the summary line, drawer not yet mounted', () => {
    renderWithClient(
      <IntakeDrawer
        intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', lanes: GENERAL_ONLY_LANES, items: [ask()] }}
        timezone="America/New_York"
      />
    );

    const trigger = screen.getByTestId('intake-drawer-trigger');
    expect(trigger).toBeVisible();
    // Clarity Phase 6 — the trigger chip is now a three-lane count line; a single
    // general-lane item (meeting/sales both zero, hidden per the exception-display rule)
    // renders as just "📬 1".
    expect(trigger).toHaveTextContent('📬 1');
    expect(screen.queryByTestId('intake-drawer')).not.toBeInTheDocument();
  });

  it('renders a quiet zero-count chip when intake is empty, still visible (not exception-only)', () => {
    renderWithClient(
      <IntakeDrawer
        intake={{ count: 0, newest_at: null, lanes: { general: 0, meeting: 0, sales: 0 }, items: [] }}
        timezone="America/New_York"
      />
    );
    expect(screen.getByTestId('intake-drawer-trigger')).toHaveTextContent('📬 Intake · 0');
  });

  it('clicking the trigger opens the drawer, showing the cards', () => {
    renderWithClient(
      <IntakeDrawer
        intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', lanes: GENERAL_ONLY_LANES, items: [ask()] }}
        timezone="America/New_York"
      />
    );

    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

    expect(screen.getByTestId('intake-drawer')).toHaveAttribute('data-state', 'open');
    expect(screen.getByText('Question about invoice')).toBeVisible();
    expect(screen.getByRole('link', { name: /open email/i })).toHaveAttribute('href', ask().deep_link);
    expect(screen.getByRole('button', { name: /^create$/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /create \+ open/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeVisible();
  });

  it('Create + open peeks the new quest instead of navigating away', async () => {
    mockPost.mockResolvedValue({ id: 'task-new-1', title: 'Question about invoice' });

    renderWithClient(
      <IntakeDrawer
        intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', lanes: GENERAL_ONLY_LANES, items: [ask()] }}
        timezone="America/New_York"
      />
    );

    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /create \+ open/i }));

    await waitFor(() => expect(mockOpenTaskPeek).toHaveBeenCalledWith('task-new-1'));
  });

  describe('Clarity Phase 4b — Archive', () => {
    it('Archive PATCHes state=archive_requested', async () => {
      mockPatch.mockResolvedValue(ask({ state: 'archive_requested' }));

      renderWithClient(
        <IntakeDrawer
        intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', lanes: GENERAL_ONLY_LANES, items: [ask()] }}
        timezone="America/New_York"
      />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));

      await waitFor(() =>
        expect(mockPatch).toHaveBeenCalledWith('/email-asks/ask-1', { state: 'archive_requested' })
      );
    });
  });

  describe('Clarity Phase 4b — training note', () => {
    it('shows the "Note for Bast" toggle when no note is set yet', () => {
      renderWithClient(
        <IntakeDrawer
        intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', lanes: GENERAL_ONLY_LANES, items: [ask()] }}
        timezone="America/New_York"
      />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      expect(screen.getByRole('button', { name: /note for bast/i })).toBeVisible();
      expect(screen.queryByTestId('intake-training-note')).not.toBeInTheDocument();
    });

    it('typing a note and saving PATCHes training_note', async () => {
      mockPatch.mockResolvedValue(ask({ training_note: 'actually just noise' }));

      renderWithClient(
        <IntakeDrawer
        intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', lanes: GENERAL_ONLY_LANES, items: [ask()] }}
        timezone="America/New_York"
      />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      fireEvent.click(screen.getByRole('button', { name: /note for bast/i }));

      const input = screen.getByTestId('intake-training-note-input');
      fireEvent.change(input, { target: { value: 'actually just noise' } });
      fireEvent.click(screen.getByRole('button', { name: /save note/i }));

      await waitFor(() =>
        expect(mockPatch).toHaveBeenCalledWith('/email-asks/ask-1', { training_note: 'actually just noise' })
      );
    });

    it('shows an existing note on the card once set', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 1,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: GENERAL_ONLY_LANES,
            items: [ask({ training_note: 'this one was fine' })],
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      expect(screen.getByTestId('intake-training-note')).toHaveTextContent('this one was fine');
      expect(screen.getByRole('button', { name: /edit note/i })).toBeVisible();
    });
  });

  describe('Clarity Phase 6 — lane grouping', () => {
    function threeLaneAsks(): EmailAsk[] {
      return [
        ask({ id: 'ask-general', subject: 'General question', intent: null }),
        ask({
          id: 'ask-meeting',
          subject: 'Can we meet Thursday?',
          intent: 'meeting',
          proposed_event_at: '2026-07-24T19:30:00.000Z',
          proposed_event_minutes: 45,
        }),
        ask({ id: 'ask-sales', subject: 'Interested in your services', intent: 'sales' }),
      ];
    }

    it('trigger chip shows one quiet count per non-empty lane', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 3,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: { general: 1, meeting: 1, sales: 1 },
            items: threeLaneAsks(),
          }}
          timezone="America/New_York"
        />
      );

      expect(screen.getByTestId('intake-drawer-trigger')).toHaveTextContent('📬 1 · 🤝 1 · 💰 1');
    });

    it('drawer groups by lane in Meeting, Sales, General order, skipping empty lanes', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 3,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: { general: 1, meeting: 1, sales: 1 },
            items: threeLaneAsks(),
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

      const cardsContainer = screen.getByTestId('intake-cards');
      const laneHeadings = cardsContainer.querySelectorAll('h3');
      expect(Array.from(laneHeadings).map((h) => h.textContent)).toEqual(['Meeting', 'Sales', 'General']);

      expect(screen.getByTestId('intake-lane-meeting')).toBeVisible();
      expect(screen.getByTestId('intake-lane-sales')).toBeVisible();
      expect(screen.getByTestId('intake-lane-general')).toBeVisible();
    });

    it('Meeting card with a high-confidence parsed date shows the prominent time + Add to calendar button', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 1,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: { general: 0, meeting: 1, sales: 0 },
            items: [threeLaneAsks()[1]],
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

      expect(screen.getByTestId('meeting-proposed-time')).toHaveTextContent('📅 Fri 7/24 · 3:30 PM · 45m');
      expect(screen.getByTestId('add-to-calendar-button')).toBeVisible();
    });

    it('Meeting card with NO parsed date shows no Add to calendar button at all', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 1,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: { general: 0, meeting: 1, sales: 0 },
            items: [ask({ id: 'ask-meeting-unparsed', intent: 'meeting', proposed_event_at: null })],
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

      expect(screen.queryByTestId('meeting-proposed-time')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-to-calendar-button')).not.toBeInTheDocument();
    });

    it('clicking Add to calendar PATCHes calendar_requested=true, button flips to "queued for calendar"', async () => {
      mockPatch.mockResolvedValue(ask({ id: 'ask-meeting', calendar_requested: true }));

      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 1,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: { general: 0, meeting: 1, sales: 0 },
            items: [threeLaneAsks()[1]],
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      fireEvent.click(screen.getByTestId('add-to-calendar-button'));

      await waitFor(() =>
        expect(mockPatch).toHaveBeenCalledWith('/email-asks/ask-meeting', { calendar_requested: true })
      );
    });

    it('a queued (calendar_requested) meeting ask shows the queued label instead of the button', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 1,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: { general: 0, meeting: 1, sales: 0 },
            items: [
              ask({
                id: 'ask-meeting-queued',
                intent: 'meeting',
                proposed_event_at: '2026-07-24T19:30:00.000Z',
                calendar_requested: true,
              }),
            ],
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

      expect(screen.getByTestId('calendar-queued-label')).toHaveTextContent('queued for calendar ⏳');
      expect(screen.queryByTestId('add-to-calendar-button')).not.toBeInTheDocument();
    });

    it('a completed (calendar_event_id set) meeting ask shows "added"', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 1,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: { general: 0, meeting: 1, sales: 0 },
            items: [
              ask({
                id: 'ask-meeting-added',
                intent: 'meeting',
                proposed_event_at: '2026-07-24T19:30:00.000Z',
                calendar_requested: true,
                calendar_event_id: 'gcal-event-1',
              }),
            ],
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

      expect(screen.getByTestId('calendar-added-label')).toHaveTextContent('added ✓');
    });

    it('Sales cards use lead-flavored copy on Create / Create + open', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{
            count: 1,
            newest_at: '2026-07-21T20:00:00.000Z',
            lanes: { general: 0, meeting: 0, sales: 1 },
            items: [threeLaneAsks()[2]],
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

      expect(screen.getByRole('button', { name: /^create lead quest$/i })).toBeVisible();
      expect(screen.getByRole('button', { name: /create lead quest \+ open/i })).toBeVisible();
    });
  });
});
