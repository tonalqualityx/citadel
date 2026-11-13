import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TaskBastChat } from '../task-bast-chat';
import { BastChatProvider } from '@/components/domain/bast-chat/BastChatProvider';

vi.mock('next/navigation', () => ({ usePathname: () => '/tasks/x' }));

const T = '7aa4a01a-1111-4222-8333-944445555666';
const reply = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 300, status, json: async () => body }) as Response));
afterEach(() => vi.unstubAllGlobals());

describe('TaskBastChat', () => {
  it('says a conversation exists and offers to reopen it in place (a button, not a link to the dashboard)', async () => {
    reply(200, { conversations: [{ id: 'c1', status: 'closed', last_message_at: '2026-11-12T15:00:00Z' }] });
    render(<TaskBastChat taskId={T} title="Build the invoice checker" status="not_started" />);
    const btn = await screen.findByRole('button', { name: 'Reopen the conversation' });
    expect(btn).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/have talked about this/)).toBeTruthy();
  });
  it('offers Talk about this on a Triage card with no conversation yet', async () => {
    reply(200, { conversations: [] });
    render(<TaskBastChat taskId={T} title="Idea" status="triage" />);
    expect(await screen.findByRole('button', { name: 'Talk to Dox' })).toBeTruthy();
  });
  it('Talk about this opens the chat in place on that card', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/conversations?task_id')) return { ok: true, status: 200, json: async () => ({ conversations: [] }) } as Response;
        if (url.endsWith('/status')) return { ok: true, status: 200, json: async () => ({ enabled: true, worker: { online: true, paused: false, auth_state: 'token' }, conversation_id: 'c1' }) } as Response;
        if (url.endsWith('/conversations') && init?.method === 'POST') return { ok: true, status: 201, json: async () => ({ id: 'card-conv' }) } as Response;
        return { ok: true, status: 200, json: async () => ({ conversation: { id: 'c1', status: 'idle' }, events: [], actions: [] }) } as Response;
      }),
    );
    render(
      <BastChatProvider>
        <TaskBastChat taskId={T} title="Idea" status="triage" />
      </BastChatProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Dox' }));
    expect(await screen.findByTestId('bast-chat-sheet')).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c === 'POST /api/bast-chat/conversations')).toBe(true));
    expect(screen.getByTestId('bast-chat-title').textContent).toBe('Dox · Idea');
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
