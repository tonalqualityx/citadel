import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import type { Blocker } from '@/lib/oracle/projects/blockers';

const mockUpdateTaskMutateAsync = vi.fn().mockResolvedValue({});
const mockCreateCommentMutateAsync = vi.fn().mockResolvedValue({});
const mockApiClientGet = vi.fn();

vi.mock('@/lib/hooks/use-tasks', () => ({
  useUpdateTask: () => ({ mutateAsync: mockUpdateTaskMutateAsync, isPending: false }),
}));

vi.mock('@/lib/hooks/use-comments', () => ({
  useCreateComment: () => ({ mutateAsync: mockCreateCommentMutateAsync, isPending: false }),
}));

const mockCreateDismissalMutateAsync = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiClientGet(...args),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-blocker-dismissals', () => ({
  useCreateBlockerDismissal: () => ({ mutateAsync: mockCreateDismissalMutateAsync, isPending: false }),
}));

// Spec polish (2026-09-04) — "Queue chase from my Gmail". Mocked directly (rather than
// through apiClient) since these are the two real hooks BlockerRow calls.
const mockCreateApprovalRequestMutateAsync = vi.fn();
const mockUpdateApprovalRequestMutateAsync = vi.fn();

vi.mock('@/lib/hooks/use-approval-requests', () => ({
  useCreateApprovalRequest: () => ({ mutateAsync: mockCreateApprovalRequestMutateAsync }),
  useUpdateApprovalRequest: () => ({ mutateAsync: mockUpdateApprovalRequestMutateAsync }),
}));

import { BlockerRow } from '../BlockerRow';

function decisionBlocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    kind: 'decision',
    id: 'decision:task-1',
    title: 'Homepage copy',
    detail: 'Bast needs a yes/no on the homepage headline.',
    owner: { id: 'mike-1', name: 'Mike', is_mike: true },
    source: { type: 'task', id: 'task-1', url: '/tasks/task-1' },
    since: '2026-08-01T00:00:00Z',
    actions: ['reply', 'open_task'],
    arc: null,
    chase_due_at: null,
    chase_draft: null,
    chase_target: null,
    dismiss: null,
    ...overrides,
  };
}

function reviewBlocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    kind: 'review',
    id: 'review:task-2',
    title: 'Ship the fix',
    detail: 'Marked done. Needs your review.',
    owner: { id: 'mike-1', name: 'Mike', is_mike: true },
    source: { type: 'task', id: 'task-2', url: '/tasks/task-2' },
    since: '2026-08-01T00:00:00Z',
    actions: ['approve', 'request_changes', 'open_task', 'dismiss'],
    arc: null,
    chase_due_at: null,
    chase_draft: null,
    chase_target: null,
    dismiss: { kind: 'task', source_id: 'task-2', source_marker: '2026-08-01T00:00:00Z' },
    ...overrides,
  };
}

function overdueClientApprovalBlocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    kind: 'client_approval',
    id: 'client_approval:ar-1',
    title: 'Client approval',
    detail: 'Sent, no reply after 3 business days. Chase it.',
    owner: { id: 'mike-1', name: 'Mike', is_mike: true },
    source: { type: 'approval_request', id: 'ar-1', url: '/tasks/task-1' },
    since: '2026-08-01T00:00:00Z',
    actions: ['send_approval', 'mark_approved'],
    arc: null,
    chase_due_at: '2026-08-06T00:00:00Z',
    chase_draft: { subject: 'Following up: Homepage copy', body: 'Hi,\n\nChecking in on Homepage copy.\n\nMike' },
    chase_target: { task_id: 'task-1', contact_id: 'contact-1', email: 'jane@client.com' },
    dismiss: null,
    ...overrides,
  };
}

function renderRow(blocker: Blocker, onPick = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BlockerRow blocker={blocker} projectId="proj-1" onPick={onPick} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiClientGet.mockResolvedValue({ id: 'task-1', tags: ['needs-mike', 'stack:eleventy'] });
  mockUpdateTaskMutateAsync.mockResolvedValue({});
  mockCreateCommentMutateAsync.mockResolvedValue({});
  mockCreateApprovalRequestMutateAsync.mockResolvedValue({ id: 'ar-chase-1' });
  mockUpdateApprovalRequestMutateAsync.mockResolvedValue({});
});

describe('BlockerRow — reply', () => {
  it('posts a comment mentioning Bast and clears the parking tag for a decision blocker', async () => {
    renderRow(decisionBlocker());

    fireEvent.click(screen.getByRole('button', { name: /reply and clear/i }));
    const textarea = screen.getByPlaceholderText(/write a reply/i);
    fireEvent.change(textarea, { target: { value: 'Yes, go ahead.' } });
    fireEvent.click(screen.getByRole('button', { name: /reply and clear/i }));

    await waitFor(() => expect(mockCreateCommentMutateAsync).toHaveBeenCalledWith({
      content: 'Yes, go ahead.',
      mentioned_user_ids: [BAST_USER_ID],
      is_internal: true,
    }));
    await waitFor(() =>
      expect(mockUpdateTaskMutateAsync).toHaveBeenCalledWith({
        id: 'task-1',
        data: { tags: ['stack:eleventy'] },
      })
    );
  });

  it('does not mention Bast for a mention-kind blocker and does not clear any tag', async () => {
    renderRow(
      decisionBlocker({
        kind: 'mention',
        id: 'mention:task-1',
        actions: ['reply', 'open_task', 'dismiss'],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
    fireEvent.change(screen.getByPlaceholderText(/write a reply/i), { target: { value: 'Noted.' } });
    fireEvent.click(screen.getByRole('button', { name: /send reply/i }));

    await waitFor(() =>
      expect(mockCreateCommentMutateAsync).toHaveBeenCalledWith({
        content: 'Noted.',
        mentioned_user_ids: [],
        is_internal: true,
      })
    );
    expect(mockUpdateTaskMutateAsync).not.toHaveBeenCalled();
  });

  // HIGH-1 guard — every comment the Projects tab posts must be internal-only, or a
  // reply/request-changes note leaks into the client portal on any task with an active
  // portal token (lib/services/portal.ts filters is_internal:false). This is a stricter,
  // dedicated check on top of the toHaveBeenCalledWith assertions above (which already
  // fail on a missing flag) so a future refactor can't silently drop the flag and pass
  // an exact-match assertion that happened to stop checking it.
  it('is_internal is true on the posted comment', async () => {
    renderRow(decisionBlocker());
    fireEvent.click(screen.getByRole('button', { name: /reply and clear/i }));
    fireEvent.change(screen.getByPlaceholderText(/write a reply/i), { target: { value: 'Yes.' } });
    fireEvent.click(screen.getByRole('button', { name: /reply and clear/i }));

    await waitFor(() => expect(mockCreateCommentMutateAsync).toHaveBeenCalled());
    expect(mockCreateCommentMutateAsync.mock.calls[0][0].is_internal).toBe(true);
  });
});

describe('BlockerRow — approve / request changes', () => {
  it('approve PATCHes the task approved:true', async () => {
    renderRow(reviewBlocker());
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() =>
      expect(mockUpdateTaskMutateAsync).toHaveBeenCalledWith({ id: 'task-2', data: { approved: true } })
    );
  });

  it('request changes posts a comment and PATCHes approved:false', async () => {
    renderRow(reviewBlocker());
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/what needs to change/i), { target: { value: 'Fix the CTA color.' } });
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));

    await waitFor(() =>
      expect(mockCreateCommentMutateAsync).toHaveBeenCalledWith({
        content: 'Fix the CTA color.',
        is_internal: true,
      })
    );
    await waitFor(() =>
      expect(mockUpdateTaskMutateAsync).toHaveBeenCalledWith({ id: 'task-2', data: { approved: false } })
    );
  });

  // HIGH-1 guard, request-changes path — same rationale as the reply-path check above.
  it('is_internal is true on the request-changes comment', async () => {
    renderRow(reviewBlocker());
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/what needs to change/i), { target: { value: 'Fix it.' } });
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));

    await waitFor(() => expect(mockCreateCommentMutateAsync).toHaveBeenCalled());
    expect(mockCreateCommentMutateAsync.mock.calls[0][0].is_internal).toBe(true);
  });
});

describe('BlockerRow — Dismiss (Phase 5)', () => {
  it('is a real, enabled button when the blocker carries a dismiss target, and calls the dismissal mutation with it', async () => {
    renderRow(reviewBlocker());
    const dismissBtn = screen.getByRole('button', { name: /^dismiss$/i });
    expect(dismissBtn).not.toBeDisabled();
    fireEvent.click(dismissBtn);
    await waitFor(() =>
      expect(mockCreateDismissalMutateAsync).toHaveBeenCalledWith({
        kind: 'task',
        source_id: 'task-2',
        source_marker: '2026-08-01T00:00:00Z',
      })
    );
  });

  it('renders no Dismiss control at all when the blocker has no dismiss target (e.g. decision/clarification)', () => {
    renderRow(decisionBlocker());
    expect(screen.queryByRole('button', { name: /^dismiss$/i })).not.toBeInTheDocument();
  });
});

describe('BlockerRow — Nudge (Phase 5)', () => {
  it('is a real, enabled button on a someone_else blocker (a resolvable Citadel-user owner), and opens the nudge panel', () => {
    renderRow(
      decisionBlocker({
        kind: 'someone_else',
        id: 'someone_else:1',
        owner: { id: 'user-9', name: 'Andy', is_mike: false },
        actions: ['nudge', 'pick'],
      })
    );
    const nudgeBtn = screen.getByRole('button', { name: /^nudge$/i });
    expect(nudgeBtn).not.toBeDisabled();
    fireEvent.click(nudgeBtn);
    expect(screen.getByRole('button', { name: /draft a nudge/i })).toBeInTheDocument();
  });

  it('stays deferred with a tooltip on a stale/meeting_risk blocker (owner is always Mike — no single resolvable recipient)', () => {
    renderRow(
      decisionBlocker({
        kind: 'stale',
        id: 'stale:proj-1',
        source: { type: 'project', id: 'proj-1', url: '/projects/proj-1' },
        actions: ['nudge', 'dismiss'],
        dismiss: { kind: 'stale', source_id: 'proj-1', source_marker: null },
      })
    );
    const nudgeBtn = screen.getByRole('button', { name: /nudge/i });
    expect(nudgeBtn).toBeDisabled();
    expect(nudgeBtn).toHaveAttribute('title', 'coming in the next pass');
  });
});

describe('BlockerRow — pick', () => {
  it('calls onPick with the blocker when Pick is clicked', () => {
    const onPick = vi.fn();
    const blocker = decisionBlocker({ kind: 'someone_else', id: 'someone_else:1', actions: ['nudge', 'pick'] });
    renderRow(blocker, onPick);
    fireEvent.click(screen.getByRole('button', { name: /^pick$/i }));
    expect(onPick).toHaveBeenCalledWith(blocker);
  });
});

// Spec polish (2026-09-04) — the computed chase_draft renders on client_approval
// blockers past the chase clock; "Queue chase from my Gmail" reuses the approval-request
// queue path (create with kind:'chase', then PATCH to queued).
describe('BlockerRow — chase draft', () => {
  it('renders no chase panel when chase_draft is null (not yet overdue)', () => {
    renderRow(overdueClientApprovalBlocker({ chase_draft: null, chase_target: null }));
    expect(screen.queryByTestId('chase-draft-panel')).not.toBeInTheDocument();
  });

  it('renders the chase panel, seeded from chase_draft, once overdue', () => {
    renderRow(overdueClientApprovalBlocker());
    expect(screen.getByTestId('chase-draft-panel')).toBeInTheDocument();
    expect(screen.getByTestId('chase-draft-subject')).toHaveValue('Following up: Homepage copy');
    expect(screen.getByTestId('chase-draft-body')).toHaveValue('Hi,\n\nChecking in on Homepage copy.\n\nMike');
  });

  it('the draft is editable', () => {
    renderRow(overdueClientApprovalBlocker());
    const subjectInput = screen.getByTestId('chase-draft-subject');
    fireEvent.change(subjectInput, { target: { value: 'A rewritten subject' } });
    expect(subjectInput).toHaveValue('A rewritten subject');
  });

  it('"Queue chase from my Gmail" creates a kind:chase row off chase_target, then queues it', async () => {
    renderRow(overdueClientApprovalBlocker());
    fireEvent.click(screen.getByRole('button', { name: /queue chase from my gmail/i }));

    await waitFor(() => expect(mockCreateApprovalRequestMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockCreateApprovalRequestMutateAsync).toHaveBeenCalledWith({
      task_id: 'task-1',
      contact_id: 'contact-1',
      to_email: 'jane@client.com',
      subject: 'Following up: Homepage copy',
      body: 'Hi,\n\nChecking in on Homepage copy.\n\nMike',
      kind: 'chase',
    });
    await waitFor(() =>
      expect(mockUpdateApprovalRequestMutateAsync).toHaveBeenCalledWith({
        id: 'ar-chase-1',
        data: { status: 'queued' },
      })
    );
  });

  it('the queue button is disabled once the subject or body is emptied', () => {
    renderRow(overdueClientApprovalBlocker());
    fireEvent.change(screen.getByTestId('chase-draft-subject'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: /queue chase from my gmail/i })).toBeDisabled();
  });
});
