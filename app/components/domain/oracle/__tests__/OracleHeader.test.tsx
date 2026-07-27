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
    return Promise.resolve({});
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
