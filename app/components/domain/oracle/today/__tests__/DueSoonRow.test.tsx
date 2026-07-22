import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DueSoonRow } from '../DueSoonRow';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('DueSoonRow', () => {
  it('renders nothing while loading or when there are no due-soon tasks', async () => {
    mockGet.mockResolvedValue({ date: '2026-07-21', timezone: 'America/New_York', tasks: [], meta: { total: 0 } });
    const { container } = renderWithClient(<DueSoonRow />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per due-soon task with an add-to-Today button', async () => {
    mockGet.mockResolvedValue({
      date: '2026-07-21',
      timezone: 'America/New_York',
      tasks: [{ id: 'task-1', title: 'Renew SSL cert', status: 'not_started', priority: 2, due_date: '2026-07-22T10:00:00.000Z' }],
      meta: { total: 1 },
    });

    renderWithClient(<DueSoonRow />);

    await screen.findByTestId('due-soon-row');
    expect(screen.getByText('Renew SSL cert')).toBeVisible();
    expect(screen.getByRole('button', { name: /add.*to today/i })).toBeVisible();
  });

  it('surfaces a 409 cap message with the warning tint on add-to-Today failure', async () => {
    mockGet.mockResolvedValue({
      date: '2026-07-21',
      timezone: 'America/New_York',
      tasks: [{ id: 'task-1', title: 'Renew SSL cert', status: 'not_started', priority: 2, due_date: '2026-07-22T10:00:00.000Z' }],
      meta: { total: 1 },
    });
    mockPost.mockRejectedValue(
      new Error('Today already holds 5 uncompleted picks — finish or drop one before adding another.')
    );

    renderWithClient(<DueSoonRow />);
    await screen.findByTestId('due-soon-row');

    fireEvent.click(screen.getByRole('button', { name: /add.*to today/i }));

    const capMessage = await screen.findByTestId('due-soon-cap-message');
    expect(capMessage).toHaveTextContent(/already holds 5 uncompleted picks/);
  });

  it('calls POST /today with the task on add-to-Today', async () => {
    mockGet.mockResolvedValue({
      date: '2026-07-21',
      timezone: 'America/New_York',
      tasks: [{ id: 'task-1', title: 'Renew SSL cert', status: 'not_started', priority: 2, due_date: '2026-07-22T10:00:00.000Z' }],
      meta: { total: 1 },
    });
    mockPost.mockResolvedValue({ id: 'pick-1' });

    renderWithClient(<DueSoonRow />);
    await screen.findByTestId('due-soon-row');

    fireEvent.click(screen.getByRole('button', { name: /add.*to today/i }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/today', { item_type: 'task', task_id: 'task-1' })
    );
  });
});
