import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBastChat, workerNotice, OFFLINE_TEXT, undoOpen } from '../use-bast-chat';

const U = '3ecfb7be-1111-4222-8333-444455556666';
type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined;
let handler: Handler;
const calls: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = handler(url, init) ?? { status: 500 };
      return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body ?? {} } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const online = { online: true, paused: false, auth_state: 'token' };
const status = { enabled: true, worker: online, conversation_id: null };

describe('useBastChat', () => {
  it('is unavailable on 404 and stops polling', async () => {
    handler = () => ({ status: 404, body: { error: 'Not found' } });
    const { result } = renderHook(() => useBastChat({ open: false }));
    await waitFor(() => expect(result.current.availability).toBe('unavailable'));
    expect(calls.map((c) => c.url)).toEqual(['/api/bast-chat/status']);
  });
  it('is unavailable on 403', async () => {
    handler = () => ({ status: 403 });
    const { result } = renderHook(() => useBastChat({ open: false }));
    await waitFor(() => expect(result.current.availability).toBe('unavailable'));
  });
  it('is unavailable when not enabled', async () => {
    handler = () => ({ status: 200, body: { ...status, enabled: false } });
    const { result } = renderHook(() => useBastChat({ open: false }));
    await waitFor(() => expect(result.current.availability).toBe('unavailable'));
  });
  it('shows his message at once, starts a conversation, and sends only kind and id', async () => {
    let posted = false;
    handler = (url, init) => {
      if (url.endsWith('/status')) return { status: 200, body: status };
      if (url.endsWith('/conversations') && init?.method === 'POST') return { status: 201, body: { id: 'c1' } };
      if (url.endsWith('/messages')) {
        posted = true;
        return { status: 201, body: { seq: 1 } };
      }
      if (url.includes('/feed')) {
        return {
          status: 200,
          body: {
            conversation: { id: 'c1', status: posted ? 'running' : 'idle' },
            events: posted ? [{ seq: 1, role: 'mike', kind: 'text', payload: { text: 'push this to Thursday' }, client_ref: calls.find((c) => c.url.endsWith('/messages'))?.body && (calls.find((c) => c.url.endsWith('/messages'))!.body as { client_ref: string }).client_ref }] : [],
            live_text: null,
            live_action: 'Looking at the task',
            worker: online,
            actions: [],
          },
        };
      }
      return undefined;
    };
    const { result } = renderHook(() => useBastChat({ open: true }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    let ok = false;
    await act(async () => {
      ok = await result.current.send('push this to Thursday', { key: `task:${U}`, title: 'Secret title', kind: 'task', id: U, tile: 'today' });
    });
    expect(ok).toBe(true);
    const msg = calls.find((c) => c.url.endsWith('/messages'))!;
    expect(msg.url).toBe('/api/bast-chat/conversations/c1/messages');
    expect(msg.body).toMatchObject({ text: 'push this to Thursday', context: { screen: 'home', tile: 'today', kind: 'task', id: U } });
    expect(JSON.stringify(msg.body)).not.toContain('Secret');
    await waitFor(() => expect(result.current.timeline.filter((i) => i.type === 'message').length).toBe(1));
    expect(result.current.working).toBe(true);
  });
  it('shows the server sentence when a cap is reached and keeps nothing pending', async () => {
    handler = (url, init) => {
      if (url.endsWith('/status')) return { status: 200, body: { ...status, conversation_id: 'c1' } };
      if (url.includes('/feed')) return { status: 200, body: { conversation: { id: 'c1', status: 'idle' }, events: [], live_text: null, live_action: null, worker: online, actions: [] } };
      if (url.endsWith('/messages') && init?.method === 'POST') return { status: 429, body: { error: "Today's chat budget is spent. It resets at midnight." } };
      return undefined;
    };
    const { result } = renderHook(() => useBastChat({ open: true }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    await act(async () => {
      await result.current.send('hello', null);
    });
    expect(result.current.error).toBe("Today's chat budget is spent. It resets at midnight.");
    expect(result.current.timeline).toEqual([]);
  });
  it('marks an expired message and offers a resend', async () => {
    handler = (url) => {
      if (url.endsWith('/status')) return { status: 200, body: { ...status, conversation_id: 'c1' } };
      if (url.includes('/feed')) {
        return {
          status: 200,
          body: {
            conversation: { id: 'c1', status: 'idle' },
            events: [{ seq: 1, role: 'mike', kind: 'text', payload: { text: 'old question' } }],
            waiting: [{ seq: 1, delivered: false, expired: true }],
            live_text: null,
            live_action: null,
            worker: { online: false, paused: false, auth_state: 'token' },
            actions: [],
          },
        };
      }
      return undefined;
    };
    const { result } = renderHook(() => useBastChat({ open: true }));
    await waitFor(() => expect(result.current.timeline.length).toBe(1));
    const item = result.current.timeline[0];
    expect(item.type === 'message' && item.message.state).toBe('expired');
    expect(item.type === 'message' && item.message.canResend).toBe(true);
    expect(result.current.notice).toBe(OFFLINE_TEXT);
    expect(result.current.working).toBe(false);
  });
  it('posts undo to the action route', async () => {
    handler = (url) => {
      if (url.endsWith('/status')) return { status: 200, body: { ...status, conversation_id: 'c1' } };
      if (url.includes('/feed')) return { status: 200, body: { conversation: { id: 'c1', status: 'idle' }, events: [], live_text: null, live_action: null, worker: online, actions: [] } };
      if (url.endsWith('/undo')) return { status: 409, body: { error: 'Changed since. Open the task.' } };
      return undefined;
    };
    const { result } = renderHook(() => useBastChat({ open: true }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    await act(async () => {
      await result.current.actOn('a1', 'undo');
    });
    expect(calls.some((c) => c.url === '/api/bast-chat/actions/a1/undo' && c.method === 'POST')).toBe(true);
    expect(result.current.actionError('a1')).toBe('Changed since. Open the task.');
  });
});

describe('helpers', () => {
  it('workerNotice order', () => {
    expect(workerNotice({ online: true, paused: false, auth_state: 'token' })).toBeNull();
    expect(workerNotice({ online: false, paused: false })).toBe(OFFLINE_TEXT);
    expect(workerNotice({ online: true, paused: true })).toMatch(/paused/);
    expect(workerNotice({ online: true, paused: false, auth_state: 'failed' })).toMatch(/sign-in/);
  });
  it('undoOpen', () => {
    const a = { id: '1', tool: 't', summary: 's', status: 'applied' as const, undo_until: '2026-11-11T00:00:00Z', event_seq: 1 };
    expect(undoOpen(a, Date.parse('2026-11-10T00:00:00Z'))).toBe(true);
    expect(undoOpen(a, Date.parse('2026-11-12T00:00:00Z'))).toBe(false);
    expect(undoOpen({ ...a, status: 'undone' }, 0)).toBe(false);
  });
});
