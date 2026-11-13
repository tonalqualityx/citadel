import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import LoginPage from '../page';

describe('staff login page', () => {
  it('links clients to the portal sign in', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LoginPage />
      </QueryClientProvider>
    );
    const link = screen.getByRole('link', { name: 'Sign in to your portal' });
    expect(link.getAttribute('href')).toBe('/portal/login');
    expect(screen.getByText('Client?')).toBeTruthy();
  });
});

describe('staff login page: keep me signed in', () => {
  it('has the tick-box, unticked by default', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LoginPage />
      </QueryClientProvider>
    );
    const box = screen.getByTestId('keep-signed-in') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText('Keep me signed in on this device')).toBeTruthy();
  });
});
