import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CrisisStrip } from '../CrisisStrip';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

vi.mock('@/lib/api/client', () => ({
  apiClient: { patch: vi.fn(), post: vi.fn(), get: vi.fn() },
}));

function ask(overrides: Partial<EmailAsk> = {}): EmailAsk {
  return {
    id: 'ask-1',
    message_id: 'msg-1',
    thread_id: null,
    account: 'mike@becomeindelible.com',
    from_name: 'Jane Client',
    from_email: 'jane@herba.com',
    subject: 'Site is down',
    gist: 'Client reports site is down',
    queue: 'do',
    severity: 'client_blocking',
    is_urgent: true,
    state: 'open',
    task_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: '2026-07-21T20:00:00.000Z',
    created_at: '2026-07-21T20:00:00.000Z',
    updated_at: '2026-07-21T20:00:00.000Z',
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('CrisisStrip', () => {
  it('renders nothing when crisis is empty — exception-based, zero pixels when calm', () => {
    const { container } = renderWithClient(<CrisisStrip crisis={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders from, subject, gist, and a severity chip for a crisis ask', () => {
    renderWithClient(<CrisisStrip crisis={[ask()]} />);

    expect(screen.getByTestId('crisis-strip')).toBeVisible();
    expect(screen.getByText(/From: Jane Client <jane@herba.com>/)).toBeVisible();
    expect(screen.getByText('Site is down')).toBeVisible();
    expect(screen.getByText('Client reports site is down')).toBeVisible();
    expect(screen.getByText('client-blocking')).toBeVisible();
  });

  it('renders an Open email link to the deep_link, opening in a new tab', () => {
    renderWithClient(<CrisisStrip crisis={[ask()]} />);

    const openLink = screen.getByRole('link', { name: /open email/i });
    expect(openLink).toHaveAttribute('href', ask().deep_link);
    expect(openLink).toHaveAttribute('target', '_blank');
  });

  it('renders a Handled button per crisis card', () => {
    renderWithClient(<CrisisStrip crisis={[ask()]} />);
    expect(screen.getByRole('button', { name: /handled/i })).toBeVisible();
  });

  it('renders one card per crisis ask, count in the header', () => {
    renderWithClient(<CrisisStrip crisis={[ask({ id: 'a1' }), ask({ id: 'a2', subject: 'Second' })]} />);
    expect(screen.getAllByTestId('crisis-card')).toHaveLength(2);
    expect(screen.getByText('Crisis · 2')).toBeVisible();
  });
});
