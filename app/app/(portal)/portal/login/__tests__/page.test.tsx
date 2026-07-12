import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

// searchParams is mutable per-test so we can simulate ?error=invalid without re-mocking per test.
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

import PortalLoginPage from '../page';

describe('PortalLoginPage', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the initial email form', () => {
    render(<PortalLoginPage />);

    expect(screen.getByText(/sign in to the client portal/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send me a sign-in link/i })).toBeInTheDocument();
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
  });

  it('shows the non-revealing confirmation state after a successful submit', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ requested: true }),
    });

    render(<PortalLoginPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'client@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send me a sign-in link/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/if your email is registered with us, a sign-in link is on its way/i)
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
  });

  it('shows the rate-limit message on a 429 and keeps the form visible', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many requests. Please try again later.' }),
    });

    render(<PortalLoginPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'client@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send me a sign-in link/i }));

    await waitFor(() => {
      expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
  });

  it('shows the expired-link banner when ?error=invalid is present', () => {
    mockSearchParams = new URLSearchParams('error=invalid');

    render(<PortalLoginPage />);

    expect(
      screen.getByText(/that sign-in link has expired or already been replaced/i)
    ).toBeInTheDocument();
  });
});
