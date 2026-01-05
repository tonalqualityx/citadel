import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

// Mock the hooks and components
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/hooks/use-sites', () => ({
  useSites: () => ({
    data: { sites: [], total: 0, totalPages: 1 },
    isLoading: false,
    error: null,
  }),
  useUpdateSite: () => ({
    mutate: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({
    t: (key: string) => {
      const terms: Record<string, string> = {
        site: 'Site',
        sites: 'Sites',
      };
      return terms[key] || key;
    },
  }),
}));

vi.mock('@/lib/hooks/use-clients', () => ({
  useClients: () => ({
    data: { clients: [] },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/use-sites', async (importOriginal) => {
  return {
    useSites: () => ({
      data: { sites: [], total: 0, totalPages: 1 },
      isLoading: false,
      error: null,
    }),
    useUpdateSite: () => ({
      mutate: vi.fn(),
    }),
    useCreateSite: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});

// Import after mocks are set up
import SitesPage from '../page';

describe('SitesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the New Site button', () => {
    render(<SitesPage />);

    const newButton = screen.getByRole('button', { name: /new site/i });
    expect(newButton).toBeInTheDocument();
  });

  it('New Site button opens the create modal when clicked', async () => {
    render(<SitesPage />);

    const newButton = screen.getByRole('button', { name: /new site/i });

    // Click the button
    fireEvent.click(newButton);

    // Modal should appear with the title
    expect(screen.getByText(/create new site/i)).toBeInTheDocument();
  });

  it('modal closes when cancel is clicked', async () => {
    render(<SitesPage />);

    // Open the modal
    const newButton = screen.getByRole('button', { name: /new site/i });
    fireEvent.click(newButton);

    // Verify modal is open
    expect(screen.getByText(/create new site/i)).toBeInTheDocument();

    // Find and click cancel button
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    // Modal title should no longer be visible
    expect(screen.queryByText(/create new site/i)).not.toBeInTheDocument();
  });
});
