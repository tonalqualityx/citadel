import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockDraftNudgeMutateAsync = vi.fn();
const mockPostInternalComment = vi.fn();

vi.mock('@/lib/hooks/use-nudge-draft', () => ({
  useNudgeDraft: () => ({ mutateAsync: mockDraftNudgeMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-post-internal-comment', () => ({
  usePostInternalComment: () => ({ postInternalComment: mockPostInternalComment, isPending: false }),
}));

import { NudgePanel } from '../NudgePanel';

beforeEach(() => {
  vi.clearAllMocks();
  mockPostInternalComment.mockResolvedValue({});
});

describe('NudgePanel', () => {
  it('starts as a "Draft a nudge" trigger', () => {
    render(<NudgePanel blockerId="someone_else:task-1" projectId="proj-1" owner={{ kind: 'user', id: 'user-9' }} taskId="task-1" />);
    expect(screen.getByRole('button', { name: /draft a nudge/i })).toBeInTheDocument();
  });

  it('fetching a comment-channel draft shows the body and a "Post comment" button', async () => {
    mockDraftNudgeMutateAsync.mockResolvedValue({ channel: 'comment', to: 'Andy', body: 'Checking in on Homepage copy. Any update?' });
    render(<NudgePanel blockerId="someone_else:task-1" projectId="proj-1" owner={{ kind: 'user', id: 'user-9' }} taskId="task-1" />);
    fireEvent.click(screen.getByRole('button', { name: /draft a nudge/i }));
    await waitFor(() => expect(mockDraftNudgeMutateAsync).toHaveBeenCalledWith({
      blocker_id: 'someone_else:task-1',
      project_id: 'proj-1',
      owner: { user_id: 'user-9' },
    }));
    expect(await screen.findByTestId('nudge-panel')).toHaveTextContent('Checking in on Homepage copy. Any update?');
    expect(screen.getByRole('button', { name: /post comment/i })).toBeInTheDocument();
  });

  it('"Post comment" posts an internal comment with the owner @-mentioned, then closes', async () => {
    mockDraftNudgeMutateAsync.mockResolvedValue({ channel: 'comment', to: 'Andy', body: 'Checking in. Any update?' });
    const onClose = vi.fn();
    render(<NudgePanel blockerId="someone_else:task-1" projectId="proj-1" owner={{ kind: 'user', id: 'user-9' }} taskId="task-1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /draft a nudge/i }));
    await screen.findByTestId('nudge-panel');
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));
    await waitFor(() =>
      expect(mockPostInternalComment).toHaveBeenCalledWith({
        content: 'Checking in. Any update?',
        mentioned_user_ids: ['user-9'],
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('fetching an email-channel draft shows a mailto: "Open in Gmail" link, never a send button', async () => {
    mockDraftNudgeMutateAsync.mockResolvedValue({
      channel: 'email',
      to: 'client@acme.com',
      subject: 'Checking in: Homepage copy',
      body: 'Hi,\n\nChecking in. Any update?\n\nMike',
    });
    render(<NudgePanel blockerId="client_approval:ar-1" projectId="proj-1" owner={{ kind: 'contact', id: 'contact-1' }} taskId="task-1" />);
    fireEvent.click(screen.getByRole('button', { name: /draft a nudge/i }));
    const link = await screen.findByRole('link', { name: /open in gmail/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('mailto:client%40acme.com'));
    expect(link).toHaveAttribute('href', expect.stringContaining('Checking%20in%3A%20Homepage%20copy'));
    expect(screen.queryByRole('button', { name: /post comment/i })).not.toBeInTheDocument();
    expect(mockPostInternalComment).not.toHaveBeenCalled();
  });

  it('a label-only owner drafts an email with no recipient shown yet', async () => {
    mockDraftNudgeMutateAsync.mockResolvedValue({
      channel: 'email',
      to: '',
      subject: 'Checking in: Homepage copy',
      body: "Add Freelance designer's email address before sending.\n\nHi,\n\nChecking in. Any update?\n\nMike",
    });
    render(<NudgePanel blockerId="stale:proj-1" projectId="proj-1" owner={{ kind: 'label', label: 'Freelance designer' }} taskId={null} />);
    fireEvent.click(screen.getByRole('button', { name: /draft a nudge/i }));
    await waitFor(() =>
      expect(mockDraftNudgeMutateAsync).toHaveBeenCalledWith({
        blocker_id: 'stale:proj-1',
        project_id: 'proj-1',
        owner: { label: 'Freelance designer' },
      })
    );
    expect(screen.getByText(/add an address before sending/i)).toBeInTheDocument();
  });

  it('Cancel discards the draft and calls onClose', async () => {
    mockDraftNudgeMutateAsync.mockResolvedValue({ channel: 'comment', to: 'Andy', body: 'Checking in.' });
    const onClose = vi.fn();
    render(<NudgePanel blockerId="someone_else:task-1" projectId="proj-1" owner={{ kind: 'user', id: 'user-9' }} taskId="task-1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /draft a nudge/i }));
    await screen.findByTestId('nudge-panel');
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /draft a nudge/i })).toBeInTheDocument();
  });
});
