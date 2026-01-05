import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

// Mock the hooks and components
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/hooks/use-clients', () => ({
  useClients: () => ({
    data: {
      clients: [],
      total: 0,
      totalPages: 1,
    },
    isLoading: false,
    error: null,
  }),
  useCreateClient: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateClient: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({
    t: (key: string) => {
      const terms: Record<string, string> = {
        client: 'Client',
        clients: 'Clients',
      };
      return terms[key] || key;
    },
  }),
}));

// Import after mocks are set up
import ClientsPage from '../page';

describe('ClientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the New Client button', () => {
    render(<ClientsPage />);

    const newButton = screen.getByRole('button', { name: /new client/i });
    expect(newButton).toBeInTheDocument();
  });

  it('New Client button opens the create modal when clicked', async () => {
    render(<ClientsPage />);

    const newButton = screen.getByRole('button', { name: /new client/i });

    // Click the button
    fireEvent.click(newButton);

    // Modal should appear with the title
    expect(screen.getByText(/create new client/i)).toBeInTheDocument();
  });

  it('modal closes when cancel is clicked', async () => {
    render(<ClientsPage />);

    // Open the modal
    const newButton = screen.getByRole('button', { name: /new client/i });
    fireEvent.click(newButton);

    // Verify modal is open
    expect(screen.getByText(/create new client/i)).toBeInTheDocument();

    // Find and click cancel button
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    // Modal title should no longer be visible
    expect(screen.queryByText(/create new client/i)).not.toBeInTheDocument();
  });
});
