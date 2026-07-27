import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NeedsReshi } from '../NeedsReshi';
import type { WaitingOnMeResponse, WaitingOnMeCard } from '@/lib/hooks/use-waiting-on-me';

const mockGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => mockGet(...args), post: vi.fn(), patch: vi.fn() },
}));

const mockUseIsMobile = vi.fn();
vi.mock('@/lib/hooks/use-is-mobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function taskCard(overrides: Partial<WaitingOnMeCard> = {}): WaitingOnMeCard {
  return {
    type: 'task',
    id: 'card-1',
    title: 'Design homepage mockups',
    status: 'done',
    priority: null,
    severity: 'client_blocking',
    task_id: 'task-1',
    session_external_id: null,
    arc: null,
    client: null,
    due_date: null,
    waiting_since: null,
    ...overrides,
  };
}

function data(): WaitingOnMeResponse {
  return {
    waiting: [{ ...taskCard({ id: 'w1', title: 'Decide on the mailer copy' }), queue_type: 'decision' }],
    review: [taskCard({ id: 'r1', status: 'done', title: 'Design homepage mockups' })],
    crisis: [],
    intake: { items: [], lanes: { admin: 0, general: 0, meeting: 0, sales: 0 } },
    meta: { counts: { total: 2, decide: 1, answer: 0, review: 1, do: 0, intake: 0, crisis: 0 } },
  } as unknown as WaitingOnMeResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({});
});

describe('NeedsReshi — desktop/mobile queue header (dead-click fix, Clarity Phase 3 Reckoning audit)', () => {
  it('desktop: queue headers render as plain non-interactive text, not a button', () => {
    mockUseIsMobile.mockReturnValue(false);
    renderWithClient(<NeedsReshi data={data()} liveSessions={[]} nowMs={Date.now()} />);

    expect(screen.getByText('Waiting on you').closest('button')).toBeNull();
    expect(screen.getByText('Review').closest('button')).toBeNull();
  });

  it('desktop: both queues render expanded regardless of click (no collapse affordance)', () => {
    mockUseIsMobile.mockReturnValue(false);
    renderWithClient(<NeedsReshi data={data()} liveSessions={[]} nowMs={Date.now()} />);

    expect(screen.getByText('Design homepage mockups')).toBeInTheDocument();
  });

  it('mobile: queue headers ARE real buttons that toggle collapse', () => {
    mockUseIsMobile.mockReturnValue(true);
    renderWithClient(<NeedsReshi data={data()} liveSessions={[]} nowMs={Date.now()} />);

    const waitingHeader = screen.getByText('Waiting on you').closest('button');
    expect(waitingHeader).not.toBeNull();
    expect(waitingHeader).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(waitingHeader!);
    expect(waitingHeader).toHaveAttribute('aria-expanded', 'true');
  });
});
