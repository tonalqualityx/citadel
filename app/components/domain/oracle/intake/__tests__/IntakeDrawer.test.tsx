import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntakeDrawer } from '../IntakeDrawer';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

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
    subject: 'Question about invoice',
    gist: 'Client asking about last invoice',
    queue: 'answer',
    severity: null,
    is_urgent: false,
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

beforeEach(() => {
  mockPush.mockClear();
});

describe('IntakeDrawer', () => {
  it('is collapsed by default — cards not rendered until expanded', () => {
    renderWithClient(
      <IntakeDrawer intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask()] }} timezone="America/New_York" />
    );

    expect(screen.getByTestId('intake-drawer')).toBeVisible();
    expect(screen.queryByTestId('intake-cards')).not.toBeInTheDocument();
    expect(screen.getByText(/📬 Intake · 1/)).toBeVisible();
  });

  it('expands to show cards on click', () => {
    renderWithClient(
      <IntakeDrawer intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask()] }} timezone="America/New_York" />
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByTestId('intake-cards')).toBeVisible();
    expect(screen.getByText('Question about invoice')).toBeVisible();
    expect(screen.getByRole('link', { name: /open email/i })).toHaveAttribute('href', ask().deep_link);
    expect(screen.getByRole('button', { name: /^create$/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /create \+ open/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeVisible();
  });

  it('renders a quiet zero-count line when intake is empty, still visible (not exception-only)', () => {
    renderWithClient(<IntakeDrawer intake={{ count: 0, newest_at: null, items: [] }} timezone="America/New_York" />);
    expect(screen.getByTestId('intake-drawer')).toBeVisible();
    expect(screen.getByText('📬 Intake · 0')).toBeVisible();
  });
});
