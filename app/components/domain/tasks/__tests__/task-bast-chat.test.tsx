import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TaskBastChat } from '../task-bast-chat';

const T = '7aa4a01a-1111-4222-8333-944445555666';
const reply = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 300, status, json: async () => body }) as Response));
afterEach(() => vi.unstubAllGlobals());

describe('TaskBastChat', () => {
  it('says a conversation exists and links back into it', async () => {
    reply(200, { conversations: [{ id: 'c1', status: 'closed', last_message_at: '2026-11-12T15:00:00Z' }] });
    render(<TaskBastChat taskId={T} title="Build the invoice checker" status="not_started" />);
    const link = await screen.findByRole('link', { name: 'Reopen the conversation' });
    expect(link.getAttribute('href')).toBe(`/dashboard?talk=${T}&title=Build%20the%20invoice%20checker`);
    expect(screen.getByText(/have talked about this/)).toBeTruthy();
  });
  it('offers Talk about this on a Triage card with no conversation yet', async () => {
    reply(200, { conversations: [] });
    render(<TaskBastChat taskId={T} title="Idea" status="triage" />);
    expect(await screen.findByRole('link', { name: 'Talk about this' })).toBeTruthy();
  });
  it('shows nothing for a card with no conversation outside Triage, and nothing for anyone the chat refuses', async () => {
    reply(200, { conversations: [] });
    const a = render(<TaskBastChat taskId={T} title="x" status="in_progress" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(a.container.textContent).toBe('');
    a.unmount();
    reply(403, { error: 'The chat is not available' });
    const b = render(<TaskBastChat taskId={T} title="x" status="triage" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(b.container.textContent).toBe('');
  });
});
