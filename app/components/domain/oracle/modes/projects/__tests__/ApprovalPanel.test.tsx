import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseApprovalRequestsForTask = vi.fn();
const mockCreateMutateAsync = vi.fn();
const mockUpdateMutateAsync = vi.fn();
const mockUseClientContacts = vi.fn();
const mockUseTask = vi.fn();

vi.mock('@/lib/hooks/use-approval-requests', () => ({
  useApprovalRequestsForTask: (...args: unknown[]) => mockUseApprovalRequestsForTask(...args),
  useCreateApprovalRequest: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateApprovalRequest: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-client-contacts', () => ({
  useClientContacts: (...args: unknown[]) => mockUseClientContacts(...args),
}));
vi.mock('@/lib/hooks/use-tasks', () => ({
  useTask: (...args: unknown[]) => mockUseTask(...args),
}));

import { ApprovalPanel } from '../ApprovalPanel';

const TASK_ID = 'task-1';
const CLIENT_ID = 'client-1';

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ar-1',
    task_id: TASK_ID,
    status: 'draft',
    subject: 'Ready for your approval: Homepage copy',
    body: 'Hi,\n\nHomepage copy is ready.\n\nMike',
    to_email: null,
    contact_id: null,
    reply_excerpt: null,
    replied_at: null,
    send_error: null,
    ...overrides,
  };
}

function render_() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApprovalPanel taskId={TASK_ID} clientId={CLIENT_ID} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [] }, isLoading: false });
  mockUseClientContacts.mockReturnValue({
    data: { contacts: [{ id: 'contact-1', name: 'Andy', email: 'andy@acme.com', client_id: CLIENT_ID }] },
  });
  mockUseTask.mockReturnValue({ data: { staging_preview_url: null } });
  mockCreateMutateAsync.mockResolvedValue(draftRow());
  mockUpdateMutateAsync.mockResolvedValue(draftRow({ status: 'queued' }));
});

describe('ApprovalPanel', () => {
  it('shows a "Draft approval request" button when no request exists yet', () => {
    render_();
    expect(screen.getByRole('button', { name: /draft approval request/i })).toBeInTheDocument();
  });

  it('creates a draft on click', async () => {
    render_();
    fireEvent.click(screen.getByRole('button', { name: /draft approval request/i }));
    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalledWith({ task_id: TASK_ID }));
  });

  it('shows the editable subject/body and a contact picker while draft', () => {
    mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [draftRow()] }, isLoading: false });
    render_();
    expect(screen.getByTestId('approval-panel-status')).toHaveTextContent('Draft');
    expect(screen.getByLabelText(/subject/i)).toHaveValue('Ready for your approval: Homepage copy');
  });

  it('"Queue to send from my Gmail" is disabled until a recipient is chosen', () => {
    mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [draftRow()] }, isLoading: false });
    render_();
    expect(screen.getByRole('button', { name: /queue to send from my gmail/i })).toBeDisabled();
  });

  it('queuing PATCHes status:queued with the edited fields', async () => {
    mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [draftRow()] }, isLoading: false });
    render_();
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Updated subject' } });
    fireEvent.change(screen.getByLabelText(/^send to$/i), { target: { value: 'contact-1' } });
    fireEvent.click(screen.getByRole('button', { name: /queue to send from my gmail/i }));
    await waitFor(() =>
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
        id: 'ar-1',
        data: expect.objectContaining({ subject: 'Updated subject', to_email: 'andy@acme.com', status: 'queued' }),
      })
    );
  });

  it('shows Cancel while queued', () => {
    mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [draftRow({ status: 'queued', to_email: 'andy@acme.com' })] }, isLoading: false });
    render_();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('cancel PATCHes status:cancelled', async () => {
    mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [draftRow({ status: 'queued', to_email: 'andy@acme.com' })] }, isLoading: false });
    render_();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() =>
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'ar-1', data: { status: 'cancelled' } })
    );
  });

  it('shows Mark approved / Request changes once sent, and the reply excerpt when present', () => {
    mockUseApprovalRequestsForTask.mockReturnValue({
      data: {
        requests: [
          draftRow({ status: 'replied', to_email: 'andy@acme.com', reply_excerpt: 'Looks great, approved!', replied_at: '2026-09-04T00:00:00Z' }),
        ],
      },
      isLoading: false,
    });
    render_();
    expect(screen.getByRole('button', { name: /mark approved/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument();
    expect(screen.getByTestId('approval-panel-reply-excerpt')).toHaveTextContent('Looks great, approved!');
  });

  it('Mark approved PATCHes status:approved', async () => {
    mockUseApprovalRequestsForTask.mockReturnValue({
      data: { requests: [draftRow({ status: 'sent', to_email: 'andy@acme.com' })] },
      isLoading: false,
    });
    render_();
    fireEvent.click(screen.getByRole('button', { name: /mark approved/i }));
    await waitFor(() =>
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'ar-1', data: { status: 'approved' } })
    );
  });

  it('Request changes opens a note field and PATCHes status:changes_requested with it', async () => {
    mockUseApprovalRequestsForTask.mockReturnValue({
      data: { requests: [draftRow({ status: 'sent', to_email: 'andy@acme.com' })] },
      isLoading: false,
    });
    render_();
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/what did the client ask to change/i), {
      target: { value: 'Bigger logo please.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^request changes$/i }));
    await waitFor(() =>
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
        id: 'ar-1',
        data: { status: 'changes_requested', reply_note: 'Bigger logo please.' },
      })
    );
  });

  it('surfaces send_error when present', () => {
    mockUseApprovalRequestsForTask.mockReturnValue({
      data: { requests: [draftRow({ status: 'draft', send_error: 'gog: recipient rejected' })] },
      isLoading: false,
    });
    render_();
    expect(screen.getByTestId('approval-panel-send-error')).toHaveTextContent('gog: recipient rejected');
  });

  it('shows the deliverable link when the task has a staging_preview_url', () => {
    mockUseTask.mockReturnValue({ data: { staging_preview_url: 'https://staging.example.com/preview' } });
    mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [draftRow()] }, isLoading: false });
    render_();
    expect(screen.getByTestId('approval-panel-deliverable-link')).toHaveAttribute(
      'href',
      'https://staging.example.com/preview'
    );
  });

  // MEDIUM-2: a terminal row (approved/changes_requested/cancelled) must never keep
  // "Draft approval request" from reappearing — it used to, because pickActiveRequest
  // only excluded 'cancelled', not 'approved'/'changes_requested'.
  describe('MEDIUM-2: terminal rows never block a fresh draft', () => {
    it.each(['approved', 'changes_requested', 'cancelled'] as const)(
      '"Draft approval request" reappears when the only row is %s',
      (status) => {
        mockUseApprovalRequestsForTask.mockReturnValue({
          data: { requests: [draftRow({ status, to_email: 'andy@acme.com' })] },
          isLoading: false,
        });
        render_();
        expect(screen.getByRole('button', { name: /draft approval request/i })).toBeInTheDocument();
        // No live/editable panel — the terminal row isn't "active."
        expect(screen.queryByLabelText(/^send to$/i)).not.toBeInTheDocument();
      }
    );

    it('a fresh draft after a cancelled row starts a new round, not the cancelled one', () => {
      mockUseApprovalRequestsForTask.mockReturnValue({
        data: {
          requests: [
            draftRow({ id: 'ar-old', status: 'cancelled', to_email: 'andy@acme.com' }),
            draftRow({ id: 'ar-new', status: 'draft' }),
          ],
        },
        isLoading: false,
      });
      render_();
      expect(screen.getByTestId('approval-panel-status')).toHaveTextContent('Draft');
      expect(screen.queryByRole('button', { name: /draft approval request/i })).not.toBeInTheDocument();
    });
  });

  // MEDIUM-3: a terminal row's history entry must show its OWN end state, never render
  // as if every step up to "Approved" had been reached.
  describe('MEDIUM-3: terminal rows show a distinct end state, never "fully approved"', () => {
    it('a cancelled-only history shows "Cancelled", not "Approved"', () => {
      mockUseApprovalRequestsForTask.mockReturnValue({
        data: { requests: [draftRow({ status: 'cancelled', to_email: 'andy@acme.com' })] },
        isLoading: false,
      });
      render_();
      const history = screen.getByTestId('approval-panel-history');
      expect(history).toHaveTextContent('Cancelled');
      expect(history).not.toHaveTextContent('Approved');
    });

    it('a changes-requested-only history shows "Changes requested", not "Approved"', () => {
      mockUseApprovalRequestsForTask.mockReturnValue({
        data: { requests: [draftRow({ status: 'changes_requested', to_email: 'andy@acme.com' })] },
        isLoading: false,
      });
      render_();
      const history = screen.getByTestId('approval-panel-history');
      expect(history).toHaveTextContent('Changes requested');
      expect(history).not.toHaveTextContent('Approved');
    });

    it('no history section renders when there are no terminal rows yet', () => {
      mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [draftRow()] }, isLoading: false });
      render_();
      expect(screen.queryByTestId('approval-panel-history')).not.toBeInTheDocument();
    });

    it('the active (in-flight) timeline never lights up "Approved" for a merely-sent row', () => {
      mockUseApprovalRequestsForTask.mockReturnValue({
        data: { requests: [draftRow({ status: 'sent', to_email: 'andy@acme.com' })] },
        isLoading: false,
      });
      render_();
      const timeline = screen.getByTestId('approval-panel-timeline');
      const approvedSpan = Array.from(timeline.querySelectorAll('span')).find((el) =>
        el.textContent?.startsWith('Approved')
      );
      expect(approvedSpan).toBeTruthy();
      expect(approvedSpan).not.toHaveStyle({ color: 'var(--text-main)' });
    });
  });

  // Phase 5 tail fixes (MEDIUM-A) — a 'sending' row the sender died on (claimed, then
  // never PUT .../sent) used to have no human exit at all: PATCH refused every
  // transition and the panel showed no buttons. Once send_attempt_at is older than 30
  // minutes, the panel offers the two Mike-gated manual overrides.
  describe('MEDIUM-A: stuck sending row gets a human exit after 30 minutes', () => {
    function sendingRow(minutesAgo: number, overrides: Record<string, unknown> = {}) {
      return draftRow({
        status: 'sending',
        to_email: 'andy@acme.com',
        send_attempt_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
        ...overrides,
      });
    }

    it('shows neither override button while under 30 minutes', () => {
      mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [sendingRow(10)] }, isLoading: false });
      render_();
      expect(screen.queryByRole('button', { name: /it went out, mark it sent/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /it did not go out, release to draft/i })).not.toBeInTheDocument();
    });

    it('shows both override buttons once past 30 minutes', () => {
      mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [sendingRow(45)] }, isLoading: false });
      render_();
      expect(screen.getByRole('button', { name: /it went out, mark it sent/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /it did not go out, release to draft/i })).toBeInTheDocument();
    });

    it('"It went out, mark it sent" PATCHes status:sent with confirmed_by_mike:true', async () => {
      mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [sendingRow(45)] }, isLoading: false });
      render_();
      fireEvent.click(screen.getByRole('button', { name: /it went out, mark it sent/i }));
      await waitFor(() =>
        expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
          id: 'ar-1',
          data: { status: 'sent', confirmed_by_mike: true },
        })
      );
    });

    it('"It did not go out, release to draft" PATCHes status:draft with release_stuck:true', async () => {
      mockUseApprovalRequestsForTask.mockReturnValue({ data: { requests: [sendingRow(45)] }, isLoading: false });
      render_();
      fireEvent.click(screen.getByRole('button', { name: /it did not go out, release to draft/i }));
      await waitFor(() =>
        expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
          id: 'ar-1',
          data: { status: 'draft', release_stuck: true },
        })
      );
    });

    it('shows no override buttons for a sending row with no send_attempt_at yet', () => {
      mockUseApprovalRequestsForTask.mockReturnValue({
        data: { requests: [draftRow({ status: 'sending', to_email: 'andy@acme.com', send_attempt_at: null })] },
        isLoading: false,
      });
      render_();
      expect(screen.queryByRole('button', { name: /it went out, mark it sent/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /it did not go out, release to draft/i })).not.toBeInTheDocument();
    });
  });
});
