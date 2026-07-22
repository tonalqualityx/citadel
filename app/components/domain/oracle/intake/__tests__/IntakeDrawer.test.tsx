import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntakeDrawer } from '../IntakeDrawer';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

// Clarity Phase 4b — Create + open now peeks the new quest via TaskPeekContext instead of
// navigating (`router.push`) — mock the context hook to assert the peek call directly.
const mockOpenTaskPeek = vi.fn();
vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: mockOpenTaskPeek }),
}));

const mockPatch = vi.fn();
const mockPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    patch: (...args: unknown[]) => mockPatch(...args),
    post: (...args: unknown[]) => mockPost(...args),
    get: vi.fn(),
  },
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
    training_note: null,
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
  mockOpenTaskPeek.mockClear();
  mockPatch.mockClear();
  mockPost.mockClear();
});

// Clarity Phase 4b — Mike's ruling: Intake relocated out of the main column into a compact
// header chip that opens a slide-over drawer (reusing the same Drawer primitives the quest
// peek uses). The drawer lazy-mounts on first open — not in the DOM until the trigger's
// first click, to avoid two permanently-mounted `forceMount` Dialog.Content layers (this
// one + the quest peek drawer, both on /oracle) fighting over which one Escape targets
// (see IntakeDrawer.tsx's own comment). Once mounted, "open vs closed" is asserted via
// Radix's own `data-state` attribute rather than DOM presence (it stays mounted afterward
// to animate closed via CSS), same approach as the e2e coverage.
describe('IntakeDrawer', () => {
  it('renders a compact trigger chip with the summary line, drawer not yet mounted', () => {
    renderWithClient(
      <IntakeDrawer intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask()] }} timezone="America/New_York" />
    );

    const trigger = screen.getByTestId('intake-drawer-trigger');
    expect(trigger).toBeVisible();
    expect(trigger).toHaveTextContent(/📬 Intake · 1/);
    expect(screen.queryByTestId('intake-drawer')).not.toBeInTheDocument();
  });

  it('renders a quiet zero-count chip when intake is empty, still visible (not exception-only)', () => {
    renderWithClient(<IntakeDrawer intake={{ count: 0, newest_at: null, items: [] }} timezone="America/New_York" />);
    expect(screen.getByTestId('intake-drawer-trigger')).toHaveTextContent('📬 Intake · 0');
  });

  it('clicking the trigger opens the drawer, showing the cards', () => {
    renderWithClient(
      <IntakeDrawer intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask()] }} timezone="America/New_York" />
    );

    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));

    expect(screen.getByTestId('intake-drawer')).toHaveAttribute('data-state', 'open');
    expect(screen.getByText('Question about invoice')).toBeVisible();
    expect(screen.getByRole('link', { name: /open email/i })).toHaveAttribute('href', ask().deep_link);
    expect(screen.getByRole('button', { name: /^create$/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /create \+ open/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeVisible();
  });

  it('Create + open peeks the new quest instead of navigating away', async () => {
    mockPost.mockResolvedValue({ id: 'task-new-1', title: 'Question about invoice' });

    renderWithClient(
      <IntakeDrawer intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask()] }} timezone="America/New_York" />
    );

    fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /create \+ open/i }));

    await waitFor(() => expect(mockOpenTaskPeek).toHaveBeenCalledWith('task-new-1'));
  });

  describe('Clarity Phase 4b — Archive', () => {
    it('Archive PATCHes state=archive_requested', async () => {
      mockPatch.mockResolvedValue(ask({ state: 'archive_requested' }));

      renderWithClient(
        <IntakeDrawer intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask()] }} timezone="America/New_York" />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));

      await waitFor(() =>
        expect(mockPatch).toHaveBeenCalledWith('/email-asks/ask-1', { state: 'archive_requested' })
      );
    });
  });

  describe('Clarity Phase 4b — training note', () => {
    it('shows the "Note for Bast" toggle when no note is set yet', () => {
      renderWithClient(
        <IntakeDrawer intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask()] }} timezone="America/New_York" />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      expect(screen.getByRole('button', { name: /note for bast/i })).toBeVisible();
      expect(screen.queryByTestId('intake-training-note')).not.toBeInTheDocument();
    });

    it('typing a note and saving PATCHes training_note', async () => {
      mockPatch.mockResolvedValue(ask({ training_note: 'actually just noise' }));

      renderWithClient(
        <IntakeDrawer intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask()] }} timezone="America/New_York" />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      fireEvent.click(screen.getByRole('button', { name: /note for bast/i }));

      const input = screen.getByTestId('intake-training-note-input');
      fireEvent.change(input, { target: { value: 'actually just noise' } });
      fireEvent.click(screen.getByRole('button', { name: /save note/i }));

      await waitFor(() =>
        expect(mockPatch).toHaveBeenCalledWith('/email-asks/ask-1', { training_note: 'actually just noise' })
      );
    });

    it('shows an existing note on the card once set', () => {
      renderWithClient(
        <IntakeDrawer
          intake={{ count: 1, newest_at: '2026-07-21T20:00:00.000Z', items: [ask({ training_note: 'this one was fine' })] }}
          timezone="America/New_York"
        />
      );

      fireEvent.click(screen.getByTestId('intake-drawer-trigger'));
      expect(screen.getByTestId('intake-training-note')).toHaveTextContent('this one was fine');
      expect(screen.getByRole('button', { name: /edit note/i })).toBeVisible();
    });
  });
});
