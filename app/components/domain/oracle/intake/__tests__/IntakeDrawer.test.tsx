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
// Clarity Phase 6b — `lanes` gained a required `admin` count.
const GENERAL_ONLY_LANES = { admin: 0, general: 1, meeting: 0, sales: 0 };

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
        intake={{ count: 0, newest_at: null, lanes: { admin: 0, general: 0, meeting: 0, sales: 0 }, items: [] }}
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
            lanes: { admin: 0, general: 1, meeting: 1, sales: 1 },
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
            lanes: { admin: 0, general: 1, meeting: 1, sales: 1 },
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
            lanes: { admin: 0, general: 0, meeting: 1, sales: 0 },
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
            lanes: { admin: 0, general: 0, meeting: 1, sales: 0 },
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
            lanes: { admin: 0, general: 0, meeting: 1, sales: 0 },
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
            lanes: { admin: 0, general: 0, meeting: 1, sales: 0 },
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
            lanes: { admin: 0, general: 0, meeting: 1, sales: 0 },
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
            lanes: { admin: 0, general: 0, meeting: 0, sales: 1 },
            items: [threeLaneAsks()[2]],
          }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

      expect(screen.getByRole('button', { name: /^create lead quest$/i })).toBeVisible();
      expect(screen.getByRole('button', { name: /create lead quest \+ open/i })).toBeVisible();
    });

    describe('Clarity Phase 6b — admin lane', () => {
      function fourLaneAsks(): EmailAsk[] {
        return [...threeLaneAsks(), ask({ id: 'ask-admin', subject: 'Q3 estimated taxes due', intent: 'admin' })];
      }

      it('trigger chip includes the admin count, rendered FIRST', () => {
        renderWithClient(
          <IntakeDrawer
            intake={{
              count: 4,
              newest_at: '2026-07-21T20:00:00.000Z',
              lanes: { admin: 1, general: 1, meeting: 1, sales: 1 },
              items: fourLaneAsks(),
            }}
            timezone="America/New_York"
          />
        );

        expect(screen.getByTestId('intake-drawer-trigger')).toHaveTextContent('🧾 1 · 📬 1 · 🤝 1 · 💰 1');
      });

      it('drawer groups Admin FIRST, ahead of Meeting/Sales/General', () => {
        renderWithClient(
          <IntakeDrawer
            intake={{
              count: 4,
              newest_at: '2026-07-21T20:00:00.000Z',
              lanes: { admin: 1, general: 1, meeting: 1, sales: 1 },
              items: fourLaneAsks(),
            }}
            timezone="America/New_York"
          />
        );

        fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

        const cardsContainer = screen.getByTestId('intake-cards');
        const laneHeadings = cardsContainer.querySelectorAll('h3');
        expect(Array.from(laneHeadings).map((h) => h.textContent)).toEqual(['Admin', 'Meeting', 'Sales', 'General']);
        expect(screen.getByTestId('intake-lane-admin')).toBeVisible();
      });

      it('admin cards use the standard actions — plain Create/Create + open, no lead-flavored copy, no meeting block', () => {
        renderWithClient(
          <IntakeDrawer
            intake={{
              count: 1,
              newest_at: '2026-07-21T20:00:00.000Z',
              lanes: { admin: 1, general: 0, meeting: 0, sales: 0 },
              items: [ask({ id: 'ask-admin', subject: 'Q3 estimated taxes due', intent: 'admin' })],
            }}
            timezone="America/New_York"
          />
        );

        fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

        const adminCard = screen.getByTestId('intake-lane-admin').querySelector('[data-testid="intake-card"]')!;
        expect(adminCard).toBeTruthy();
        expect(screen.getByRole('button', { name: /^create$/i })).toBeVisible();
        expect(screen.getByRole('button', { name: /^create \+ open$/i })).toBeVisible();
        expect(screen.queryByRole('button', { name: /lead quest/i })).not.toBeInTheDocument();
        expect(screen.queryByTestId('meeting-event-block')).not.toBeInTheDocument();
      });
    });
  });
});

// 2026-08-03 — collapse. The drawer used to render one card per MESSAGE; on the day this
// was written that meant 46 cards for 23 real things, over half of them one ow-staff
// announcement plus its reply chorus. These assert the UI actually collapses, since the
// fixtures above all carry thread_id: null and so exercise only the singleton path.
describe('IntakeDrawer collapse', () => {
  function owThread(n: number): EmailAsk[] {
    return [
      ask({
        id: 'ow-0',
        thread_id: 'ow',
        subject: '[ow-staff] NEW HANDBOOK, WHO DIS?',
        gist: null,
        received_at: '2026-08-02T13:00:00.000Z',
      }),
      ...Array.from({ length: n - 1 }, (_, i) =>
        ask({
          id: `ow-${i + 1}`,
          thread_id: 'ow',
          from_name: `Replier ${i + 1}`,
          subject: 'Re: [ow-staff] NEW HANDBOOK, WHO DIS?',
          gist: null,
          // real instants, 30 min apart, so a 24-message thread doesn't overflow the hour
          received_at: new Date(Date.parse('2026-08-02T13:00:00.000Z') + (i + 1) * 30 * 60_000).toISOString(),
        })
      ),
    ];
  }

  it('renders one card for a 24-message thread, showing the announcement not the chatter', () => {
    const items = owThread(24);
    renderWithClient(
      <IntakeDrawer
        intake={{ count: 24, newest_at: items[23].received_at, lanes: { admin: 0, general: 24, meeting: 0, sales: 0 }, items }}
        timezone="America/New_York"
      />
    );
    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

    expect(screen.getAllByTestId('intake-card')).toHaveLength(1);
    expect(screen.getByText('[ow-staff] NEW HANDBOOK, WHO DIS?')).toBeVisible();
    expect(screen.getByTestId('intake-collapse-toggle')).toHaveTextContent(
      '24 messages · 23 replies since · newest 8:30 PM'
    );
  });

  it('keeps the chorus one click away rather than on screen', () => {
    const items = owThread(3);
    renderWithClient(
      <IntakeDrawer
        intake={{ count: 3, newest_at: items[2].received_at, lanes: { admin: 0, general: 3, meeting: 0, sales: 0 }, items }}
        timezone="America/New_York"
      />
    );
    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

    expect(screen.queryByTestId('intake-collapse-members')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('intake-collapse-toggle'));
    const members = screen.getByTestId('intake-collapse-members');
    expect(members).toBeVisible();
    // the anchor is NOT repeated in the member list — only the replies
    expect(members.querySelectorAll('li')).toHaveLength(2);
  });

  it('archiving a collapsed row files EVERY message under it, not just the anchor', async () => {
    mockPatch.mockResolvedValue({});
    const items = owThread(3);
    renderWithClient(
      <IntakeDrawer
        intake={{ count: 3, newest_at: items[2].received_at, lanes: { admin: 0, general: 3, meeting: 0, sales: 0 }, items }}
        timezone="America/New_York"
      />
    );
    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(3));
    const archived = mockPatch.mock.calls.map((c) => (c[0] as string).split('/').pop());
    expect(archived.sort()).toEqual(['ow-0', 'ow-1', 'ow-2']);
    for (const call of mockPatch.mock.calls) {
      expect(call[1]).toEqual({ state: 'archive_requested' });
    }
  });

  it('labels the bulk action with the count so the blast radius is visible', () => {
    const items = owThread(4);
    renderWithClient(
      <IntakeDrawer
        intake={{ count: 4, newest_at: items[3].received_at, lanes: { admin: 0, general: 4, meeting: 0, sales: 0 }, items }}
        timezone="America/New_York"
      />
    );
    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveTextContent('Archive all 4');
  });

  it('leaves a single unthreaded message exactly as it was — no collapse chrome', () => {
    renderWithClient(
      <IntakeDrawer
        intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', lanes: GENERAL_ONLY_LANES, items: [ask()] }}
        timezone="America/New_York"
      />
    );
    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

    expect(screen.getAllByTestId('intake-card')).toHaveLength(1);
    expect(screen.queryByTestId('intake-collapse')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveTextContent('Archive');
  });
});
