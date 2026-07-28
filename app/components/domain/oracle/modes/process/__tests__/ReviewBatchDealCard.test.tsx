import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewBatchDealCard } from '../ReviewBatchDealCard';
import type { ReviewGroup } from '@/components/domain/oracle/needs-reshi/needs-reshi-logic';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: vi.fn(),
  },
}));

const mockOpenTaskPeek = vi.fn();
vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: mockOpenTaskPeek }),
}));

const mockToastSuccess = vi.fn();
vi.mock('@/lib/hooks/use-toast', () => ({
  showToast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
    apiError: vi.fn(),
  },
}));

function group(overrides: Partial<ReviewGroup> = {}): ReviewGroup {
  return {
    key: 'client-1',
    label: 'Bootleggers',
    count: 2,
    oldestWaitAt: '2026-07-27T09:00:00.000Z',
    topItemTitle: 'Fix the header',
    items: [
      {
        id: 'task-1',
        sourceLabel: 'quest',
        contextLabel: 'Bootleggers',
        bodyText: 'Fix the header',
        severity: null,
        primaryAction: { kind: 'open_review', taskId: 't1' },
        waitingSince: '2026-07-27T09:00:00.000Z',
        arcId: 'arc-1',
      },
      {
        id: 'session-1',
        sourceLabel: 'session',
        contextLabel: 'Bootleggers',
        bodyText: 'Approve the deploy',
        severity: null,
        primaryAction: { kind: 'respond', remoteUrl: 'https://claude.ai/code/session_x' },
        waitingSince: '2026-07-27T10:00:00.000Z',
        arcId: 'arc-1',
      },
    ],
    arcId: 'arc-1',
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ date: '2026-07-27', timezone: 'America/New_York', picks: [], meta: { total: 0, uncompleted: 0, cap: 5 } });
});

describe('ReviewBatchDealCard — honesty pass (Clarity Phase 8 shakedown)', () => {
  it('labels the ghost button "Skip", never "Open" — it never opened anything', () => {
    renderWithClient(<ReviewBatchDealCard group={group()} nowMs={Date.now()} onRouted={vi.fn()} />);
    expect(screen.getByTestId('review-deal-open')).toHaveTextContent('Skip');
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  it('Skip advances past the card and toasts what happened, without opening details', () => {
    const onRouted = vi.fn();
    renderWithClient(<ReviewBatchDealCard group={group()} nowMs={Date.now()} onRouted={onRouted} />);
    fireEvent.click(screen.getByTestId('review-deal-open'));
    expect(onRouted).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('Skipped — still in the queue');
    expect(screen.queryByTestId('review-deal-details')).not.toBeInTheDocument();
  });

  it('"View details" expands the batch inline (no advance) with each item\'s title and waiting age', () => {
    const onRouted = vi.fn();
    renderWithClient(<ReviewBatchDealCard group={group()} nowMs={new Date('2026-07-27T11:00:00.000Z').getTime()} onRouted={onRouted} />);

    fireEvent.click(screen.getByTestId('review-deal-view-details'));

    expect(onRouted).not.toHaveBeenCalled();
    const items = screen.getAllByTestId('review-deal-detail-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Fix the header');
    expect(items[0]).toHaveTextContent('waiting 2h ago');
    expect(items[1]).toHaveTextContent('Approve the deploy');
    expect(items[1]).toHaveTextContent('waiting 1h ago');
  });

  it('a task-backed detail item opens the task peek; a session-backed item can Respond', () => {
    renderWithClient(<ReviewBatchDealCard group={group()} nowMs={Date.now()} onRouted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('review-deal-view-details'));

    fireEvent.click(screen.getByTestId('review-deal-detail-open-task'));
    expect(mockOpenTaskPeek).toHaveBeenCalledWith('t1');

    expect(screen.getByText('Respond').closest('a')).toHaveAttribute('href', 'https://claude.ai/code/session_x');
  });

  it('"View details" toggles closed again without ever routing the card', () => {
    const onRouted = vi.fn();
    renderWithClient(<ReviewBatchDealCard group={group()} nowMs={Date.now()} onRouted={onRouted} />);
    const toggle = screen.getByTestId('review-deal-view-details');
    fireEvent.click(toggle);
    expect(screen.getByTestId('review-deal-details')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('review-deal-details')).not.toBeInTheDocument();
    expect(onRouted).not.toHaveBeenCalled();
  });

  it('Pick arc → Today toasts the arc by name and advances the card', async () => {
    mockPost.mockResolvedValue({ id: 'pick-1' });
    const onRouted = vi.fn();
    renderWithClient(<ReviewBatchDealCard group={group()} nowMs={Date.now()} onRouted={onRouted} />);

    fireEvent.click(screen.getByTestId('review-deal-pick-arc'));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Added Bootleggers to Today'));
    expect(onRouted).toHaveBeenCalledTimes(1);
  });
});
