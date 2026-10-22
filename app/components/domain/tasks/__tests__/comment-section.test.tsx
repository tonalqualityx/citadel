import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

const createMutateAsync = vi.fn(async (_input: Record<string, unknown>) => ({}));
const updateMutateAsync = vi.fn(async (_input: Record<string, unknown>) => ({}));
let role = 'pm';
let comments: unknown[] = [];

let chatData: { client_present: boolean; email_hold_seconds: number } | null = null;
vi.mock('../chat-staff-panel', () => ({ ChatStaffPanel: () => null, useTaskChat: () => ({ data: chatData }) }));
vi.mock('@/lib/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1', role } }) }));
vi.mock('@/lib/hooks/use-comments', () => ({
  useComments: () => ({ data: { comments, count: comments.length }, isLoading: false }),
  useCreateComment: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateComment: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useDeleteComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/hooks/use-mention-suggestions', () => ({ useMentionSuggestions: () => ({ data: { users: [], contacts: [] } }) }));

import { CommentSection, commentFieldsFor } from '../comment-section';

const staff = (over: Record<string, unknown> = {}) => ({
  id: 'c1', task_id: 't', user_id: 'u1', user: { id: 'u1', name: 'Mike', email: 'm@x.com', avatar_url: null },
  content: 'A staff comment', mentioned_user_ids: [], is_internal: false, client_visible: false, author_contact_id: null, author_contact: null,
  created_at: '2026-10-21T10:00:00Z', updated_at: '2026-10-21T10:00:00Z', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  role = 'pm';
  comments = [];
  chatData = null;
});

describe('commentFieldsFor', () => {
  it('on a client task, internal note is is_internal and a reply is client_visible', () => {
    expect(commentFieldsFor('internal', true)).toEqual({ is_internal: true });
    expect(commentFieldsFor('client', true)).toEqual({ client_visible: true });
  });
  it('on any other task nothing changes', () => {
    expect(commentFieldsFor('internal', false)).toEqual({});
    expect(commentFieldsFor('client', false)).toEqual({});
  });
});

describe('Reply to client email hint', () => {
  const pick = () => fireEvent.click(screen.getByLabelText('Reply to client'));
  it('says no email goes out while the client is in the portal', () => {
    chatData = { client_present: true, email_hold_seconds: 120 };
    render(<CommentSection taskId="t" clientVisibleTask />);
    pick();
    expect(screen.getByTestId('client-email-hint')).toHaveTextContent('Client is in the portal now; no email will be sent.');
  });
  it('says the reply is also emailed in about two minutes when the client is away', () => {
    chatData = { client_present: false, email_hold_seconds: 120 };
    render(<CommentSection taskId="t" clientVisibleTask />);
    pick();
    expect(screen.getByTestId('client-email-hint')).toHaveTextContent('Client is away; this will also be emailed in about 2 minutes.');
  });
  it('shows nothing about email on an internal note or a task with no chat', () => {
    chatData = { client_present: false, email_hold_seconds: 120 };
    const { unmount } = render(<CommentSection taskId="t" clientVisibleTask />);
    expect(screen.queryByTestId('client-email-hint')).toBeNull();
    unmount();
    chatData = null;
    render(<CommentSection taskId="t" clientVisibleTask />);
    pick();
    expect(screen.queryByTestId('client-email-hint')).toBeNull();
  });
});

describe('CommentSection composer', () => {
  it('offers Reply to client and Internal note on a client task, Internal note selected', () => {
    render(<CommentSection taskId="t" clientVisibleTask />);
    expect(screen.getByLabelText('Internal note')).toBeChecked();
    expect(screen.getByLabelText('Reply to client')).not.toBeChecked();
  });

  it('shows no audience choice on a task that is not in the portal', () => {
    render(<CommentSection taskId="t" />);
    expect(screen.queryByLabelText('Reply to client')).toBeNull();
  });

  it('shows no audience choice to a tech user, who cannot share', () => {
    role = 'tech';
    render(<CommentSection taskId="t" clientVisibleTask />);
    expect(screen.queryByLabelText('Reply to client')).toBeNull();
  });

  it('posting with the default sends an internal note', async () => {
    render(<CommentSection taskId="t" clientVisibleTask />);
    fireEvent.change(screen.getByPlaceholderText(/Add a comment/), { target: { value: 'for us only' } });
    fireEvent.submit(screen.getByPlaceholderText(/Add a comment/).closest('form')!);
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
    expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ content: 'for us only', is_internal: true }));
    expect(createMutateAsync.mock.calls[0][0]).not.toHaveProperty('client_visible');
  });

  it('choosing Reply to client sends client_visible, then goes back to Internal note', async () => {
    render(<CommentSection taskId="t" clientVisibleTask />);
    fireEvent.click(screen.getByLabelText('Reply to client'));
    expect(screen.getByText(/sees this as Indelible/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Add a comment/), { target: { value: 'We updated the hours.' } });
    fireEvent.submit(screen.getByPlaceholderText(/Add a comment/).closest('form')!);
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
    expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ client_visible: true }));
    expect(createMutateAsync.mock.calls[0][0]).not.toHaveProperty('is_internal');
    await waitFor(() => expect(screen.getByLabelText('Internal note')).toBeChecked());
  });
});

describe('CommentSection badges and toggle', () => {
  it('badges a client message with the contact name and a shared reply with "Client sees this"', () => {
    comments = [
      staff({ id: 'c1', user: { id: 'bast', name: 'Bast', email: 'b@x.com', avatar_url: null }, content: 'From the client', author_contact_id: 'ct1', author_contact: { name: 'Dana' }, client_visible: true }),
      staff({ id: 'c2', content: 'Shared reply', client_visible: true }),
      staff({ id: 'c3', content: 'Plain note' }),
    ];
    render(<CommentSection taskId="t" clientVisibleTask />);
    expect(screen.getByTestId('client-badge')).toHaveTextContent('Client: Dana');
    expect(screen.getAllByTestId('client-sees-badge')).toHaveLength(1);
    // The client's words are shown under their name, not Bast's.
    expect(screen.queryByText('Bast')).toBeNull();
  });

  it('the toggle shows or hides a staff comment through client_visible', async () => {
    comments = [staff({ id: 'c3', content: 'Plain note' })];
    render(<CommentSection taskId="t" clientVisibleTask />);
    fireEvent.click(screen.getByLabelText('Show to the client'));
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({ id: 'c3', data: { client_visible: true } }));
  });

  it('there is no toggle on a task outside the portal, on an internal note, or on a client message', () => {
    comments = [staff({ id: 'c4', is_internal: true }), staff({ id: 'c5', author_contact_id: 'ct1', author_contact: { name: 'Dana' }, client_visible: true })];
    const { rerender } = render(<CommentSection taskId="t" clientVisibleTask />);
    expect(screen.queryByLabelText('Show to the client')).toBeNull();
    expect(screen.queryByLabelText('Hide from the client')).toBeNull();
    comments = [staff({ id: 'c6' })];
    rerender(<CommentSection taskId="t" />);
    expect(screen.queryByLabelText('Show to the client')).toBeNull();
  });

  it('a client-authored comment has no Edit button (staff can delete it, not rewrite it)', () => {
    comments = [staff({ id: 'c7', author_contact_id: 'ct1', author_contact: { name: 'Dana' }, client_visible: true, user_id: null, user: null })];
    render(<CommentSection taskId="t" clientVisibleTask />);
    expect(screen.queryByTitle('Edit')).toBeNull();
    expect(screen.getByTitle('Delete')).toBeInTheDocument();
  });

  it('a staff comment still has Edit', () => {
    comments = [staff({ id: 'c8' })];
    render(<CommentSection taskId="t" clientVisibleTask />);
    expect(screen.getByTitle('Edit')).toBeInTheDocument();
  });
});
