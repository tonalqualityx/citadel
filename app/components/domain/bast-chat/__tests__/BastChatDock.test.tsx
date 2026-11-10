import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as React from 'react';
import { BastChatDock, BAST_DOCK_OPEN_KEY } from '../BastChatDock';

const U = '3ecfb7be-1111-4222-8333-444455556666';
const online = { online: true, paused: false, auth_state: 'token' };
let responder: (url: string, init?: RequestInit) => { status: number; body?: unknown };
const calls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = responder(url, init);
      return { status: r.status, ok: r.status < 300, json: async () => r.body ?? {} } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function ownerResponder(extra?: (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined) {
  return (url: string, init?: RequestInit) => {
    const e = extra?.(url, init);
    if (e) return e;
    if (url.endsWith('/status')) return { status: 200, body: { enabled: true, worker: online, conversation_id: 'c1' } };
    if (url.includes('/feed')) return { status: 200, body: { conversation: { id: 'c1', status: 'idle' }, events: [], live_text: null, live_action: null, worker: online, actions: [] } };
    return { status: 404 };
  };
}

const card = { key: `task:${U}`, title: 'Call Gene about the preview', type: 'task', tile: 'today' };

describe('BastChatDock', () => {
  it('renders nothing at all when the chat answers 404', async () => {
    responder = () => ({ status: 404 });
    const { container } = render(<div data-home><BastChatDock card={card} /></div>);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {});
    expect(container.querySelector('[data-home]')!.innerHTML).toBe('');
  });
  it('renders nothing on 403', async () => {
    responder = () => ({ status: 403 });
    const { container } = render(<div data-home><BastChatDock card={card} /></div>);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {});
    expect(container.querySelector('[data-home]')!.innerHTML).toBe('');
  });
  it('renders nothing when the chat throws', async () => {
    responder = () => ({ status: 200, body: { enabled: true, worker: null, conversation_id: null, usage: 1 } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Boom(): React.ReactElement {
      throw new Error('x');
    }
    vi.resetModules();
    vi.doMock('../BastChatPanel', () => ({ BastChatPanel: Boom }));
    const mod = await import('../BastChatDock');
    const { container } = render(<div data-home><mod.BastChatDock card={card} /></div>);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {});
    expect(container.querySelector('[data-home]')!.innerHTML).toBe('');
    vi.doUnmock('../BastChatPanel');
    spy.mockRestore();
  });
  it('is closed by default, opens, remembers, and Escape returns focus to the button', async () => {
    responder = ownerResponder();
    render(<div data-home><BastChatDock card={card} /></div>);
    const button = await screen.findByTestId('bast-chat-button');
    expect(screen.getByTestId('bast-chat-dock').hasAttribute('hidden')).toBe(true);
    fireEvent.click(button);
    const region = screen.getByRole('region', { name: 'Chat with Bast' });
    expect(window.localStorage.getItem(BAST_DOCK_OPEN_KEY)).toBe('open');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('bast-chat-input')));
    fireEvent.keyDown(screen.getByTestId('bast-chat-input'), { key: 'Escape' });
    expect(window.localStorage.getItem(BAST_DOCK_OPEN_KEY)).toBe('closed');
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(region.hasAttribute('hidden')).toBe(true);
  });
  it('starts open when it was left open', async () => {
    window.localStorage.setItem(BAST_DOCK_OPEN_KEY, 'open');
    responder = ownerResponder();
    render(<div data-home><BastChatDock card={card} /></div>);
    expect(await screen.findByRole('region', { name: 'Chat with Bast' })).toBeTruthy();
  });
  it('shows the About line, lets him drop it, and sends only kind and id', async () => {
    window.localStorage.setItem(BAST_DOCK_OPEN_KEY, 'open');
    responder = ownerResponder((url, init) => {
      if (url.endsWith('/messages') && init?.method === 'POST') return { status: 201, body: { seq: 1 } };
      return undefined;
    });
    render(<div data-home><BastChatDock card={card} /></div>);
    expect((await screen.findByTestId('about-line')).textContent).toContain('About: Call Gene about the preview');
    const input = screen.getByTestId('bast-chat-input');
    fireEvent.change(input, { target: { value: 'push this to Thursday' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/messages'))).toBe(true));
    const body = calls.find((c) => c.url.endsWith('/messages'))!.body as { context: unknown };
    expect(body.context).toEqual({ screen: 'home', tile: 'today', kind: 'task', id: U });
    expect(JSON.stringify(body)).not.toContain('Call Gene');
    expect(await screen.findByText('push this to Thursday')).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Drop this card from the question' }));
    expect(screen.queryByTestId('about-line')).toBeNull();
  });
  it('Shift+Enter does not send', async () => {
    window.localStorage.setItem(BAST_DOCK_OPEN_KEY, 'open');
    responder = ownerResponder();
    render(<div data-home><BastChatDock card={null} /></div>);
    const input = await screen.findByTestId('bast-chat-input');
    fireEvent.change(input, { target: { value: 'line one' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(calls.some((c) => c.url.endsWith('/messages'))).toBe(false);
  });
  it('shows the plain offline line and a working line, never a spinner', async () => {
    window.localStorage.setItem(BAST_DOCK_OPEN_KEY, 'open');
    responder = ownerResponder((url) => {
      if (url.includes('/feed')) {
        return { status: 200, body: { conversation: { id: 'c1', status: 'queued' }, events: [], live_text: null, live_action: null, worker: { online: false, paused: false, auth_state: 'token' }, actions: [] } };
      }
      return undefined;
    });
    render(<div data-home><BastChatDock card={null} /></div>);
    expect((await screen.findByTestId('worker-notice')).textContent).toBe("Bast's machine isn't answering right now. Your message will wait for 2 hours.");
  });
  it('shows Bast is working on it while a turn runs', async () => {
    window.localStorage.setItem(BAST_DOCK_OPEN_KEY, 'open');
    responder = ownerResponder((url) => {
      if (url.includes('/feed')) {
        return { status: 200, body: { conversation: { id: 'c1', status: 'running' }, events: [], live_text: null, live_action: null, worker: online, actions: [] } };
      }
      return undefined;
    });
    render(<div data-home><BastChatDock card={null} /></div>);
    expect((await screen.findByTestId('working-line')).textContent).toContain('Bast is working on it');
    expect(document.querySelector('[role="progressbar"], svg.animate-spin')).toBeNull();
  });
});
