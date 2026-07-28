import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntakeDealCard } from '../IntakeDealCard';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

const mockToastSuccess = vi.fn();
vi.mock('@/lib/hooks/use-toast', () => ({
  showToast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
    apiError: vi.fn(),
    created: vi.fn(),
  },
}));

function ask(overrides: Partial<EmailAsk> = {}): EmailAsk {
  return {
    id: 'ask-1', message_id: 'm1', thread_id: null, account: 'a@b.com', from_name: null,
    from_email: 'x@y.com', subject: 'Subject one', gist: null, queue: null, severity: null,
    is_urgent: false, state: 'open', training_note: null, intent: 'general',
    proposed_event_at: null, proposed_event_title: null, proposed_event_minutes: null,
    calendar_requested: false, calendar_event_id: null, task_id: null,
    deep_link: 'https://mail.google.com', received_at: '2026-07-27T09:00:00.000Z',
    created_at: '2026-07-27T09:00:00.000Z', updated_at: '2026-07-27T09:00:00.000Z',
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('IntakeDealCard — Dismiss honesty pass (Clarity Phase 8 shakedown)', () => {
  it('toasts that the email is cleared from Intake (no undo) and advances the card', async () => {
    mockPatch.mockResolvedValue({ ...ask(), state: 'dismissed' });
    const onRouted = vi.fn();
    renderWithClient(<IntakeDealCard ask={ask()} onRouted={onRouted} />);

    fireEvent.click(screen.getByTestId('intake-deal-dismiss'));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Dismissed — cleared from Intake'));
    expect(onRouted).toHaveBeenCalledTimes(1);
  });
});
