import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewGroupCard } from '../ReviewGroupCard';
import type { ReviewGroup } from '../needs-reshi-logic';

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

function group(overrides: Partial<ReviewGroup> = {}): ReviewGroup {
  return {
    key: 'arc-arc-1',
    label: 'Herba site',
    count: 3,
    oldestWaitAt: null,
    topItemTitle: 'Fix the header',
    items: [],
    arcId: 'arc-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ date: '2026-07-27', timezone: 'America/New_York', picks: [], meta: { total: 0, uncompleted: 0, cap: 5 } });
});

describe('ReviewGroupCard — Add to Today (Clarity Phase 3 Reckoning, spec Q5)', () => {
  it('hides the button when the group has no single shared arc', async () => {
    renderWithClient(<ReviewGroupCard group={group({ arcId: null })} nowMs={Date.now()} />);
    await waitFor(() => expect(screen.queryByTestId('review-group-add-to-today')).not.toBeInTheDocument());
  });

  it('shows the button and creates an arc-type Today pick on click', async () => {
    mockPost.mockResolvedValue({ id: 'pick-1' });
    renderWithClient(<ReviewGroupCard group={group()} nowMs={Date.now()} />);

    const button = await screen.findByTestId('review-group-add-to-today');
    fireEvent.click(button);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/today', { item_type: 'arc', arc_id: 'arc-1' })
    );
  });

  it('hides the button once that arc is already an uncompleted pick for today', async () => {
    mockGet.mockResolvedValue({
      date: '2026-07-27',
      timezone: 'America/New_York',
      picks: [{ id: 'p1', item_type: 'arc', arc_id: 'arc-1', completed_at: null }],
      meta: { total: 1, uncompleted: 1, cap: 5 },
    });
    renderWithClient(<ReviewGroupCard group={group()} nowMs={Date.now()} />);

    await waitFor(() => expect(screen.queryByTestId('review-group-add-to-today')).not.toBeInTheDocument());
  });

  it('clicking the button does not toggle the group open/closed', async () => {
    mockPost.mockResolvedValue({ id: 'pick-1' });
    renderWithClient(<ReviewGroupCard group={group()} nowMs={Date.now()} />);

    const button = await screen.findByTestId('review-group-add-to-today');
    fireEvent.click(button);

    expect(screen.queryByTestId('review-group-items')).not.toBeInTheDocument();
  });
});
