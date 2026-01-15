import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

// Track mock state
let mockAuthState: {
  user: { id: string; role: string; email: string; name: string } | null;
  isLoading: boolean;
  isPmOrAdmin: boolean;
} = {
  user: { id: 'test-user', role: 'pm', email: 'pm@test.com', name: 'Test PM' },
  isLoading: false,
  isPmOrAdmin: true,
};

const mockRouterReplace = vi.fn();

// Mock the hooks
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}));

vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => mockAuthState,
}));

vi.mock('@/components/domain/billing/billing-dashboard', () => ({
  BillingDashboard: () => <div data-testid="billing-dashboard">Billing Dashboard</div>,
}));

// Import after mocks are set up
import BillingPage from '../page';

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default auth state
    mockAuthState = {
      user: { id: 'test-user', role: 'pm', email: 'pm@test.com', name: 'Test PM' },
      isLoading: false,
      isPmOrAdmin: true,
    };
  });

  describe('hydration safety', () => {
    it('renders loading state with correct structure for hydration consistency', () => {
      // Simulate initial render where auth is still loading
      mockAuthState = {
        user: null,
        isLoading: true,
        isPmOrAdmin: false,
      };

      const { container } = render(<BillingPage />);

      // Verify the loading state structure matches what we expect for hydration
      // The outer div should have p-6 class (matching BillingDashboard's loading state)
      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv).toHaveClass('p-6');

      // The inner div should have the centering classes
      const innerDiv = outerDiv.firstChild as HTMLElement;
      expect(innerDiv).toHaveClass('flex', 'items-center', 'justify-center', 'min-h-[400px]');

      // Should contain a spinner
      const spinner = screen.getByRole('status', { name: /loading/i });
      expect(spinner).toBeInTheDocument();
    });

    it('loading state wrapper structure matches BillingDashboard for hydration', () => {
      // This test ensures the loading state structure is consistent between
      // BillingPage and BillingDashboard to prevent hydration mismatches
      mockAuthState = {
        user: null,
        isLoading: true,
        isPmOrAdmin: false,
      };

      const { container } = render(<BillingPage />);

      // Critical: The p-6 wrapper must be present (matches BillingDashboard's loading state)
      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv.className).toContain('p-6');

      // The centering container must be the direct child
      const innerDiv = outerDiv.firstChild as HTMLElement;
      expect(innerDiv.className).toContain('flex');
      expect(innerDiv.className).toContain('items-center');
      expect(innerDiv.className).toContain('justify-center');
    });
  });

  describe('authorization', () => {
    it('renders BillingDashboard for PM users after mounting', async () => {
      mockAuthState = {
        user: { id: 'test-user', role: 'pm', email: 'pm@test.com', name: 'Test PM' },
        isLoading: false,
        isPmOrAdmin: true,
      };

      render(<BillingPage />);

      // After mounting, should show the billing dashboard
      await waitFor(() => {
        expect(screen.getByTestId('billing-dashboard')).toBeInTheDocument();
      });
    });

    it('renders BillingDashboard for admin users after mounting', async () => {
      mockAuthState = {
        user: { id: 'test-admin', role: 'admin', email: 'admin@test.com', name: 'Test Admin' },
        isLoading: false,
        isPmOrAdmin: true,
      };

      render(<BillingPage />);

      await waitFor(() => {
        expect(screen.getByTestId('billing-dashboard')).toBeInTheDocument();
      });
    });

    it('redirects tech users to home page', async () => {
      mockAuthState = {
        user: { id: 'test-tech', role: 'tech', email: 'tech@test.com', name: 'Test Tech' },
        isLoading: false,
        isPmOrAdmin: false,
      };

      render(<BillingPage />);

      await waitFor(() => {
        expect(mockRouterReplace).toHaveBeenCalledWith('/');
      });
    });

    it('does not render BillingDashboard for non-PM users', async () => {
      mockAuthState = {
        user: { id: 'test-tech', role: 'tech', email: 'tech@test.com', name: 'Test Tech' },
        isLoading: false,
        isPmOrAdmin: false,
      };

      render(<BillingPage />);

      // Wait for mount effect to run
      await waitFor(() => {
        expect(mockRouterReplace).toHaveBeenCalled();
      });

      // Should not render the dashboard
      expect(screen.queryByTestId('billing-dashboard')).not.toBeInTheDocument();
    });
  });

  describe('loading states', () => {
    it('shows loading spinner while auth is loading', () => {
      mockAuthState = {
        user: null,
        isLoading: true,
        isPmOrAdmin: false,
      };

      render(<BillingPage />);

      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
      expect(screen.queryByTestId('billing-dashboard')).not.toBeInTheDocument();
    });

    it('transitions from loading to dashboard when auth completes', async () => {
      mockAuthState = {
        user: { id: 'test-user', role: 'pm', email: 'pm@test.com', name: 'Test PM' },
        isLoading: false,
        isPmOrAdmin: true,
      };

      render(<BillingPage />);

      // Should eventually show the dashboard
      await waitFor(() => {
        expect(screen.getByTestId('billing-dashboard')).toBeInTheDocument();
      });

      // Spinner should no longer be visible
      expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument();
    });
  });
});
