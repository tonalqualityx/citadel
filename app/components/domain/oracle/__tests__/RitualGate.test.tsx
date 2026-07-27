import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RitualGate } from '../RitualGate';

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

function mockEndpoints({
  ranAt = null,
  bailedAt = null,
  picks = [] as unknown[],
}: {
  ranAt?: string | null;
  bailedAt?: string | null;
  picks?: unknown[];
}) {
  mockGet.mockImplementation((path: string) => {
    if (path === '/ritual-runs') {
      return Promise.resolve({ date: '2026-07-27', kind: 'morning', ran_at: ranAt, bailed_at: bailedAt });
    }
    if (path === '/today') {
      return Promise.resolve({
        date: '2026-07-27',
        timezone: 'America/New_York',
        picks,
        meta: { total: picks.length, uncompleted: picks.length, cap: 5 },
      });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RitualGate', () => {
  it('covers the children when neither ran_at nor bailed_at is set', async () => {
    mockEndpoints({});
    renderWithClient(
      <RitualGate hasCrisis={false}>
        <div data-testid="gated-content">Today section</div>
      </RitualGate>
    );

    await waitFor(() => expect(screen.getByTestId('ritual-gate-cover')).toBeVisible());
    expect(screen.queryByTestId('gated-content')).not.toBeInTheDocument();
  });

  it('renders children through once ran_at is set', async () => {
    mockEndpoints({ ranAt: '2026-07-27T09:00:00.000Z' });
    renderWithClient(
      <RitualGate hasCrisis={false}>
        <div data-testid="gated-content">Today section</div>
      </RitualGate>
    );

    await waitFor(() => expect(screen.getByTestId('gated-content')).toBeVisible());
    expect(screen.queryByTestId('ritual-gate-cover')).not.toBeInTheDocument();
  });

  it('renders children through once bailed_at is set', async () => {
    mockEndpoints({ bailedAt: '2026-07-27T09:00:00.000Z' });
    renderWithClient(
      <RitualGate hasCrisis={false}>
        <div data-testid="gated-content">Today section</div>
      </RitualGate>
    );

    await waitFor(() => expect(screen.getByTestId('gated-content')).toBeVisible());
  });

  it('shows the normal copy when there are picks', async () => {
    mockEndpoints({ picks: [{ id: 'p1' }] });
    renderWithClient(
      <RitualGate hasCrisis={false}>
        <div>content</div>
      </RitualGate>
    );

    await waitFor(() =>
      expect(screen.getByTestId('ritual-gate-copy')).toHaveTextContent(/hasn't run yet/i)
    );
  });

  it('shows the softened no-op copy with zero picks and no crisis', async () => {
    mockEndpoints({ picks: [] });
    renderWithClient(
      <RitualGate hasCrisis={false}>
        <div>content</div>
      </RitualGate>
    );

    await waitFor(() =>
      expect(screen.getByTestId('ritual-gate-copy')).toHaveTextContent(/quiet morning/i)
    );
  });

  it('shows the normal (not softened) copy when there is a crisis, even with zero picks', async () => {
    mockEndpoints({ picks: [] });
    renderWithClient(
      <RitualGate hasCrisis={true}>
        <div>content</div>
      </RitualGate>
    );

    await waitFor(() =>
      expect(screen.getByTestId('ritual-gate-copy')).toHaveTextContent(/hasn't run yet/i)
    );
  });

  it('never offers a "ritual is done" button — only Bail for today', async () => {
    mockEndpoints({});
    renderWithClient(
      <RitualGate hasCrisis={false}>
        <div>content</div>
      </RitualGate>
    );

    await waitFor(() => expect(screen.getByTestId('ritual-gate-cover')).toBeVisible());
    expect(screen.getByTestId('ritual-gate-bail')).toBeVisible();
    expect(screen.queryByText(/ritual is done/i)).not.toBeInTheDocument();
  });

  it('bail button posts the bailed action', async () => {
    mockEndpoints({});
    mockPost.mockResolvedValue({ date: '2026-07-27', kind: 'morning', ran_at: null, bailed_at: '2026-07-27T09:00:00.000Z' });
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    renderWithClient(
      <RitualGate hasCrisis={false}>
        <div>content</div>
      </RitualGate>
    );

    await waitFor(() => expect(screen.getByTestId('ritual-gate-bail')).toBeVisible());
    await user.click(screen.getByTestId('ritual-gate-bail'));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/ritual-runs', expect.objectContaining({ action: 'bailed' }))
    );
  });
});
