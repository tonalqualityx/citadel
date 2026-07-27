import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OracleHeader } from '../OracleHeader';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url.startsWith('/clients')) return Promise.resolve({ clients: [] });
    if (url.startsWith('/today/calendar')) {
      return Promise.resolve({
        date: '2026-07-27',
        timezone: 'America/New_York',
        meetings: [],
        allDay: [],
        week: [],
      });
    }
    if (url.startsWith('/oracle/triage-stats')) {
      return Promise.resolve({ date: '2026-07-27', archived_count: 0 });
    }
    return Promise.resolve({});
  });
});

describe('OracleHeader — Catch bar prefixes (Clarity Phase 3 Reckoning, spec Q19)', () => {
  it('"task: …" POSTs to /tasks with Mike as assignee, not_started, priority 3', async () => {
    mockPost.mockResolvedValue({ id: 'task-1', title: 'call the bookkeeper' });
    renderWithClient(<OracleHeader machines={[]} />);

    const input = screen.getByTestId('idea-quickadd-input');
    fireEvent.change(input, { target: { value: 'task: call the bookkeeper' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/tasks', {
        title: 'call the bookkeeper',
        assignee_id: '3ecfb7be-20bb-43cb-9b4d-31c44337dc81',
        status: 'not_started',
        priority: 3,
      })
    );
  });

  it('anything else still files to /ideas', async () => {
    mockPost.mockResolvedValue({ id: 'idea-1', text: 'a stray thought' });
    renderWithClient(<OracleHeader machines={[]} />);

    const input = screen.getByTestId('idea-quickadd-input');
    fireEvent.change(input, { target: { value: 'a stray thought' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/ideas', { text: 'a stray thought', source: 'oracle' })
    );
  });
});

describe('OracleHeader — New arc button (Clarity Phase 3 Reckoning, spec Q4)', () => {
  it('opens the New arc modal', async () => {
    renderWithClient(<OracleHeader machines={[]} />);

    fireEvent.click(screen.getByTestId('new-arc-trigger'));

    expect(await screen.findByTestId('new-arc-modal')).toBeInTheDocument();
  });

  it('submitting creates the arc and navigates into its workspace', async () => {
    mockPost.mockResolvedValue({ id: 'arc-9', name: 'New thing' });
    renderWithClient(<OracleHeader machines={[]} />);

    fireEvent.click(screen.getByTestId('new-arc-trigger'));
    const nameInput = await screen.findByTestId('new-arc-name-input');
    fireEvent.change(nameInput, { target: { value: 'New thing' } });
    fireEvent.click(screen.getByTestId('new-arc-submit'));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/arcs', { name: 'New thing', client_id: null })
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/oracle/arcs/arc-9'));
  });
});

describe('OracleHeader — triage visibility chip (Clarity Phase 3 Reckoning, spec Q11)', () => {
  it('renders nothing when nothing was auto-archived today', async () => {
    renderWithClient(<OracleHeader machines={[]} />);
    await waitFor(() =>
      expect(mockGet.mock.calls.some((call) => call[0] === '/oracle/triage-stats')).toBe(true)
    );
    expect(screen.queryByTestId('triage-archived-chip')).not.toBeInTheDocument();
  });

  it('shows the count and links to the Gmail auto-archived label when > 0', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.startsWith('/oracle/triage-stats')) {
        return Promise.resolve({ date: '2026-07-27', archived_count: 4 });
      }
      if (url.startsWith('/today/calendar')) {
        return Promise.resolve({ date: '2026-07-27', timezone: 'America/New_York', meetings: [], allDay: [], week: [] });
      }
      return Promise.resolve({});
    });
    renderWithClient(<OracleHeader machines={[]} />);

    const chip = await screen.findByTestId('triage-archived-chip');
    expect(chip).toHaveTextContent('4 auto-archived today');
    expect(chip).toHaveAttribute('href', 'https://mail.google.com/mail/u/0/#label/Bast%2FArchived-Auto');
  });
});
