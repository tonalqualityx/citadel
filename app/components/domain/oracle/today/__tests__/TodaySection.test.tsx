import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TodaySection } from '../TodaySection';

const mockGet = vi.fn();
const mockPatch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    post: vi.fn(),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function taskPick(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    date: '2026-07-27',
    item_type: 'task',
    arc_id: null,
    arc: null,
    task_id: `${id}-task`,
    task: {
      id: `${id}-task`,
      title: `Task ${id}`,
      status: 'not_started',
      priority: 3,
      due_date: null,
      energy_estimate: null,
      battery_impact: 'average_drain',
      mystery_factor: 'none',
      ...overrides,
    },
    session_external_id: null,
    session: null,
    charter_id: null,
    charter: null,
    accord_id: null,
    accord: null,
    label: null,
    sort: 0,
    started_at: null,
    completed_at: null,
    calendar_event_id: null,
    primary_action: null,
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url === '/today') {
      return Promise.resolve({
        date: '2026-07-27',
        timezone: 'America/New_York',
        picks: [
          taskPick('low', { energy_estimate: 1 }),
          taskPick('high', { energy_estimate: 8 }),
        ],
        meta: { total: 2, uncompleted: 2, cap: 5 },
      });
    }
    if (url === '/today/calendar') {
      return Promise.resolve({
        date: '2026-07-27',
        timezone: 'America/New_York',
        meetings: [],
        allDay: [],
        week: [],
      });
    }
    if (url === '/users/me/preferences') {
      return Promise.resolve({
        preferences: {
          naming_convention: 'standard',
          theme: 'system',
          notification_bundle: true,
          today_view: 'list',
          energy_filter: 'all',
        },
      });
    }
    return Promise.resolve({});
  });
  mockPatch.mockResolvedValue({
    preferences: {
      naming_convention: 'standard',
      theme: 'system',
      notification_bundle: true,
      today_view: 'list',
      energy_filter: 'low_energy',
    },
  });
});

describe('TodaySection — energy filter chips (Clarity Phase 3 Reckoning, spec Q9/G10)', () => {
  it('renders All/Low-energy wins/Deep work chips, All active by default', async () => {
    renderWithClient(<TodaySection />);

    expect(await screen.findByTestId('energy-filter-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('energy-filter-low_energy')).toBeInTheDocument();
    expect(screen.getByTestId('energy-filter-deep_work')).toBeInTheDocument();
  });

  it('shows both picks under "All"', async () => {
    renderWithClient(<TodaySection />);
    const list = await screen.findByTestId('today-list');
    expect(list).toHaveTextContent('Task low');
    expect(list).toHaveTextContent('Task high');
  });

  it('clicking "Low-energy wins" filters the list and PATCHes the preference', async () => {
    renderWithClient(<TodaySection />);
    await screen.findByTestId('today-list');

    fireEvent.click(screen.getByTestId('energy-filter-low_energy'));

    await waitFor(() => expect(screen.getByTestId('today-list')).not.toHaveTextContent('Task high'));
    expect(screen.getByTestId('today-list')).toHaveTextContent('Task low');
    expect(mockPatch).toHaveBeenCalledWith('/users/me/preferences', { energy_filter: 'low_energy' });
  });

  it('the WIP count stays unfiltered even when a filter hides cards', async () => {
    renderWithClient(<TodaySection />);
    await screen.findByTestId('today-list');

    fireEvent.click(screen.getByTestId('energy-filter-low_energy'));

    await waitFor(() => expect(screen.getByTestId('today-list')).not.toHaveTextContent('Task high'));
    // Both picks are still uncompleted — the header count is never shrunk by the view filter.
    expect(screen.getByTestId('today-wip-count')).toHaveTextContent('2');
  });
});
