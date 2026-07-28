import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CronHealthLine } from '../CronHealthLine';
import type { OracleMachineDTO } from '@/lib/types/oracle';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: vi.fn(),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function machineWithErroringCron(overrides: Record<string, unknown> = {}): OracleMachineDTO {
  return {
    id: 'm1',
    name: 'nexus',
    hostname: 'nexus.local',
    last_heartbeat_at: new Date().toISOString(),
    sessions: [
      {
        id: 's1',
        external_id: 'ext-1',
        source: 'openclaw_cron',
        title: 'email-check',
        cwd: null,
        model: null,
        remote_url: null,
        status: 'waiting',
        needs_attention: true,
        attention_reason: 'boom: exit code 1',
        started_at: null,
        last_event_at: null,
        ended_at: null,
        tokens_total: 0,
        agents: [],
        ...overrides,
      },
    ],
  } as unknown as OracleMachineDTO;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ states: [] });
});

describe('CronHealthLine (Clarity Phase 3 Reckoning, spec Q14)', () => {
  it('renders "all crons healthy" when nothing is erroring', () => {
    renderWithClient(<CronHealthLine machines={[]} />);
    expect(screen.getByText(/all crons healthy/)).toBeInTheDocument();
  });

  // Clarity Phase 8 (shakedown round 2) — regression test for Mike's live dark-mode report:
  // this line used to be a bare, unclassed <span>, inheriting whatever ambient color its
  // mount point happened to have (which resolved to browser-default black under
  // app/(app)/layout.tsx's Mantine stylesheet import, invisible on the dark theme's
  // near-black surface). It must always carry an explicit muted-foreground token so it
  // reads correctly regardless of where it's mounted.
  it('the healthy line carries an explicit muted-foreground token, not inherited ambient color', () => {
    renderWithClient(<CronHealthLine machines={[]} />);
    expect(screen.getByText(/all crons healthy/)).toHaveClass('text-text-sub');
  });

  it('renders a chip per erroring cron', async () => {
    renderWithClient(<CronHealthLine machines={[machineWithErroringCron()]} />);
    expect(await screen.findByTestId('cron-chip-trigger')).toHaveTextContent('email-check');
  });

  it('clicking the chip opens a popover with the attention reason', async () => {
    renderWithClient(<CronHealthLine machines={[machineWithErroringCron()]} />);
    fireEvent.click(await screen.findByTestId('cron-chip-trigger'));

    expect(await screen.findByTestId('cron-chip-reason')).toHaveTextContent('boom: exit code 1');
  });

  it('Snooze POSTs a snooze action for this cron', async () => {
    mockPost.mockResolvedValue({ cron_key: 'nexus::email-check', snoozed_until: null, dismissed_reason: null });
    renderWithClient(<CronHealthLine machines={[machineWithErroringCron()]} />);
    fireEvent.click(await screen.findByTestId('cron-chip-trigger'));
    fireEvent.click(screen.getByText('Snooze'));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/oracle/cron-chips', {
        cron_key: 'nexus::email-check',
        action: 'snooze',
      })
    );
  });

  it('Dismiss POSTs the current attention reason', async () => {
    mockPost.mockResolvedValue({ cron_key: 'nexus::email-check', snoozed_until: null, dismissed_reason: 'boom: exit code 1' });
    renderWithClient(<CronHealthLine machines={[machineWithErroringCron()]} />);
    fireEvent.click(await screen.findByTestId('cron-chip-trigger'));
    fireEvent.click(screen.getByText('Dismiss'));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/oracle/cron-chips', {
        cron_key: 'nexus::email-check',
        action: 'dismiss',
        reason: 'boom: exit code 1',
      })
    );
  });

  it('a snoozed cron does not render a chip', async () => {
    mockGet.mockResolvedValue({
      states: [{ cron_key: 'nexus::email-check', snoozed_until: '2099-01-01T00:00:00.000Z', dismissed_reason: null }],
    });
    renderWithClient(<CronHealthLine machines={[machineWithErroringCron()]} />);

    await waitFor(() => expect(screen.queryByTestId('cron-chip')).not.toBeInTheDocument());
    expect(screen.getByText(/all crons healthy/)).toBeInTheDocument();
  });
});
