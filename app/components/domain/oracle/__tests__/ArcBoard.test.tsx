import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArcBoard } from '../ArcBoard';
import { TimerProvider } from '@/lib/contexts/timer-context';

const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    post: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({ t: (k: string) => k }),
}));

vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: vi.fn() }),
}));

function arcFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'arc-1',
    name: 'Demo arc',
    description: null,
    status: 'open',
    client_id: null,
    client: null,
    project_id: null,
    project: null,
    origin_session_external_id: null,
    closed_at: null,
    snoozed_until: null,
    next_touch: null,
    accord_id: null,
    accord: null,
    cover_url: null,
    estimate_override_minutes: null,
    estimated_minutes_total: 0,
    sessions: [],
    task_count: 0,
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
    tasks: [],
    email_asks: [],
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimerProvider>{ui}</TimerProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ArcBoard — close/reopen (Clarity Phase 7 completion nudge trigger)', () => {
  it('shows "Close arc" for an open arc', async () => {
    mockGet.mockResolvedValue(arcFixture());
    renderWithClient(<ArcBoard arcId="arc-1" />);

    expect(await screen.findByTestId('arc-board-close-toggle')).toHaveTextContent('Close arc');
  });

  it('shows "Reopen arc" for a closed arc', async () => {
    mockGet.mockResolvedValue(arcFixture({ closed_at: '2026-07-27T09:00:00.000Z' }));
    renderWithClient(<ArcBoard arcId="arc-1" />);

    expect(await screen.findByTestId('arc-board-close-toggle')).toHaveTextContent('Reopen arc');
  });

  it('clicking Close arc PATCHes closed_at', async () => {
    mockGet.mockResolvedValue(arcFixture());
    mockPatch.mockResolvedValue(arcFixture({ closed_at: '2026-07-27T10:00:00.000Z' }));
    renderWithClient(<ArcBoard arcId="arc-1" />);

    const button = await screen.findByTestId('arc-board-close-toggle');
    button.click();

    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('/arcs/arc-1', expect.objectContaining({ closed_at: expect.any(String) }))
    );
  });
});

describe('ArcBoard — accord panel (Clarity Phase 3 Reckoning)', () => {
  it('renders nothing when the arc has no accord link', async () => {
    mockGet.mockResolvedValue(arcFixture());
    renderWithClient(<ArcBoard arcId="arc-1" />);

    await screen.findByTestId('arc-board-close-toggle');
    expect(screen.queryByTestId('arc-accord-panel')).not.toBeInTheDocument();
  });

  it('shows lead name/business/status and sibling arcs when linked to an accord', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/context')) {
        return Promise.resolve({
          arc: { id: 'arc-1' },
          client: null,
          project: null,
          accord: {
            id: 'accord-1',
            name: 'Acme deal',
            status: 'proposal',
            lead_name: 'Jane Prospect',
            lead_business_name: 'Acme Co',
            lead_email: 'jane@acme.test',
            lead_phone: null,
            other_arcs: [{ id: 'arc-2', name: 'Kickoff arc', closed_at: null }],
          },
          tasks: { open: [], recent: [] },
          emails: [],
          sessions: [],
          next_touch: null,
          activity: {
            last_task_activity_at: null,
            last_email_received_at: null,
            last_session_activity_at: null,
            arc_updated_at: '2026-07-27T09:00:00.000Z',
          },
        });
      }
      return Promise.resolve(
        arcFixture({
          accord_id: 'accord-1',
          accord: {
            id: 'accord-1',
            name: 'Acme deal',
            status: 'proposal',
            lead_name: 'Jane Prospect',
            lead_business_name: 'Acme Co',
            lead_email: 'jane@acme.test',
            lead_phone: null,
          },
        })
      );
    });
    renderWithClient(<ArcBoard arcId="arc-1" />);

    expect(await screen.findByTestId('arc-accord-panel')).toHaveTextContent('Jane Prospect');
    expect(screen.getByTestId('arc-accord-panel')).toHaveTextContent('Acme Co');
    expect(await screen.findByTestId('arc-sibling-link')).toHaveTextContent('Kickoff arc');
  });
});

describe('ArcBoard — attached emails panel (Clarity Phase 3 Reckoning)', () => {
  it('renders nothing when no emails are attached', async () => {
    mockGet.mockResolvedValue(arcFixture());
    renderWithClient(<ArcBoard arcId="arc-1" />);

    await screen.findByTestId('arc-board-close-toggle');
    expect(screen.queryByTestId('arc-emails-panel')).not.toBeInTheDocument();
  });

  it('renders subject/from/gist with a deep link for each attached email', async () => {
    mockGet.mockResolvedValue(
      arcFixture({
        email_asks: [
          {
            id: 'ask-1',
            subject: 'Re: proposal timing',
            from_email: 'jane@acme.test',
            from_name: 'Jane Prospect',
            gist: 'Wants to move the kickoff up a week',
            deep_link: 'https://mail.google.com/mail/u/0/#inbox/abc123',
            received_at: '2026-07-27T09:00:00.000Z',
          },
        ],
      })
    );
    renderWithClient(<ArcBoard arcId="arc-1" />);

    const item = await screen.findByTestId('arc-email-ask-item');
    expect(item).toHaveTextContent('Re: proposal timing');
    expect(item).toHaveTextContent('Jane Prospect');
    expect(item).toHaveTextContent('Wants to move the kickoff up a week');
    expect(item).toHaveAttribute('href', 'https://mail.google.com/mail/u/0/#inbox/abc123');
  });
});

describe('ArcBoard — next-touch panel (Clarity Phase 3 Reckoning)', () => {
  it('shows "Set next touch" when unset', async () => {
    mockGet.mockResolvedValue(arcFixture());
    renderWithClient(<ArcBoard arcId="arc-1" />);

    expect(await screen.findByTestId('arc-next-touch-badge')).toHaveTextContent('Set next touch');
  });

  it('shows the date and an overdue flag for a past next_touch', async () => {
    mockGet.mockResolvedValue(arcFixture({ next_touch: '2020-01-01T00:00:00.000Z' }));
    renderWithClient(<ArcBoard arcId="arc-1" />);

    const badge = await screen.findByTestId('arc-next-touch-badge');
    expect(badge).toHaveTextContent('2020-01-01');
    expect(badge).toHaveAttribute('data-overdue', 'true');
  });

  it('opening the editor and saving PATCHes next_touch', async () => {
    mockGet.mockResolvedValue(arcFixture());
    mockPatch.mockResolvedValue(arcFixture({ next_touch: '2026-08-01T00:00:00.000Z' }));
    renderWithClient(<ArcBoard arcId="arc-1" />);

    const badge = await screen.findByTestId('arc-next-touch-badge');
    badge.click();

    const input = await screen.findByTestId('arc-next-touch-input');
    fireEvent.change(input, { target: { value: '2026-08-01' } });

    const form = await screen.findByTestId('arc-next-touch-form');
    fireEvent.submit(form);

    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('/arcs/arc-1', expect.objectContaining({ next_touch: expect.any(String) }))
    );
  });
});
