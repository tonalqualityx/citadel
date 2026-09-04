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
});
