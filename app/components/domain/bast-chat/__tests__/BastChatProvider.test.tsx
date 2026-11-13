import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let pathname = '/dashboard';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

let panelBoom = false;
vi.mock('../BastChatPanel', async (orig) => {
  const m = await orig<typeof import('../BastChatPanel')>();
  return {
    ...m,
    BastChatPanel: (p: React.ComponentProps<typeof m.BastChatPanel>) => {
      if (panelBoom) throw new Error('x');
      return <m.BastChatPanel {...p} />;
    },
  };
});

import { BastChatProvider, BastChatSplitColumn, BAST_DOCK_OPEN_KEY, usePageBastChat, useBastChatShell } from '../BastChatProvider';
import type { OpenCardInput } from '../card-context';

const U = '3ecfb7be-1111-4222-8333-444455556666';
const online = { online: true, paused: false, auth_state: 'token' };
let responder: (url: string, init?: RequestInit) => { status: number; body?: unknown };
const calls: Array<{ url: string; method: string; body: unknown }> = [];

/** matchMedia whose answers the test controls: split (wide landscape) and coarse (a finger). */
const mq = { split: false, coarse: false };
function installMatchMedia() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('orientation') ? mq.split : q.includes('coarse') ? mq.coarse : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  calls.length = 0;
  pathname = '/dashboard';
  panelBoom = false;
  mq.split = false;
  mq.coarse = false;
  installMatchMedia();
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
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = responder(url, init);
      return { status: r.status, ok: r.status < 300, json: async () => r.body ?? {} } as Response;
    }),
  );
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.removeAttribute('style');
});

type Extra = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined;
function ownerResponder(extra?: Extra) {
  return (url: string, init?: RequestInit) => {
    const e = extra?.(url, init);
    if (e) return e;
    if (url.endsWith('/status')) return { status: 200, body: { enabled: true, worker: online, conversation_id: 'c1' } };
    if (url.includes('/feed')) return { status: 200, body: { conversation: { id: 'c1', status: 'idle' }, events: [], live_text: null, live_action: null, worker: online, actions: [] } };
    return { status: 404 };
  };
}

const card: OpenCardInput = { key: `task:${U}`, title: 'Call Gene about the preview', type: 'task', tile: 'today' };

function Page({ card: c }: { card: OpenCardInput | null }) {
  usePageBastChat(c);
  const shell = useBastChatShell();
  return (
    <div data-testid="page" data-mode={shell.mode}>
      page
      <BastChatSplitColumn />
    </div>
  );
}
function app(c: OpenCardInput | null = card) {
  return (
    <BastChatProvider>
      <Page card={c} />
    </BastChatProvider>
  );
}
const openIt = async () => {
  const button = await screen.findByTestId('bast-chat-button');
  fireEvent.click(button);
  return button;
};

describe('Bast chat shell: availability', () => {
  it('draws nothing at all when the chat answers 404', async () => {
    responder = () => ({ status: 404 });
    render(app());
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByTestId('bast-chat-button')).toBeNull();
    expect(screen.getByTestId('page').getAttribute('data-mode')).toBe('closed');
  });
  it('draws nothing on 403', async () => {
    responder = () => ({ status: 403 });
    render(app());
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByTestId('bast-chat-button')).toBeNull();
  });
  it('makes no request at all until a page offers the chat', async () => {
    responder = ownerResponder();
    render(<BastChatProvider><div>no chat here</div></BastChatProvider>);
    await act(async () => {});
    expect(calls.length).toBe(0);
  });
  it('keeps the page when the chat throws', async () => {
    responder = ownerResponder();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    panelBoom = true;
    render(app());
    await openIt();
    await act(async () => {});
    expect(screen.queryByTestId('bast-chat-sheet')).toBeNull();
    expect(screen.getByTestId('page')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('Bast chat shell: the three modes', () => {
  it('closed: only the Ask Bast button, no sheet, no column, page not locked', async () => {
    responder = ownerResponder();
    render(app());
    await screen.findByTestId('bast-chat-button');
    expect(screen.queryByTestId('bast-chat-sheet')).toBeNull();
    expect(screen.queryByTestId('bast-chat-split')).toBeNull();
    expect(document.body.style.position).toBe('');
    expect(screen.getByTestId('page').getAttribute('data-mode')).toBe('closed');
  });
  it('full screen (phone, portrait tablet): a dialog portaled to the body with Back, title and New chat; the page behind is locked', async () => {
    responder = ownerResponder();
    render(app());
    await openIt();
    const sheet = await screen.findByTestId('bast-chat-sheet');
    expect(sheet.parentElement).toBe(document.body);
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.style.position).toBe('fixed');
    expect(sheet.style.zIndex).toBe('50');
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByTestId('bast-chat-title').textContent).toBe('Bast');
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy();
    expect(screen.getByTestId('bast-chat-composer')).toBeTruthy();
    expect(document.body.style.position).toBe('fixed');
    expect(screen.queryByTestId('bast-chat-split')).toBeNull();
    expect(screen.getByTestId('page').getAttribute('data-mode')).toBe('full');
  });
  it('full screen: locks the page where it was and puts it back when it closes', async () => {
    responder = ownerResponder();
    Object.defineProperty(window, 'scrollY', { value: 340, configurable: true });
    render(app());
    await openIt();
    await screen.findByTestId('bast-chat-sheet');
    expect(document.body.style.top).toBe('-340px');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByTestId('bast-chat-sheet')).toBeNull());
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 340 }));
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
  it('split (landscape 1024px and up, desktop): a column beside the page, no sheet, the body is not locked', async () => {
    mq.split = true;
    responder = ownerResponder();
    render(app());
    await openIt();
    const col = await screen.findByTestId('bast-chat-split');
    expect(col.tagName).toBe('ASIDE');
    expect(screen.queryByTestId('bast-chat-sheet')).toBeNull();
    expect(document.body.style.position).toBe('');
    expect(screen.getByTestId('page').getAttribute('data-mode')).toBe('split');
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await waitFor(() => expect(screen.queryByTestId('bast-chat-split')).toBeNull());
    expect(screen.getByTestId('page').getAttribute('data-mode')).toBe('closed');
  });
  it('split: starts open when it was left open; a phone never reopens by itself', async () => {
    window.localStorage.setItem(BAST_DOCK_OPEN_KEY, 'open');
    responder = ownerResponder();
    mq.split = true;
    const a = render(app());
    expect(await screen.findByTestId('bast-chat-split')).toBeTruthy();
    a.unmount();
    mq.split = false;
    render(app());
    await screen.findByTestId('bast-chat-button');
    expect(screen.queryByTestId('bast-chat-sheet')).toBeNull();
  });
});

describe('Bast chat shell: history', () => {
  it('opening pushes one entry; the browser Back closes the chat', async () => {
    responder = ownerResponder();
    const push = vi.spyOn(window.history, 'pushState');
    render(app());
    await openIt();
    await screen.findByTestId('bast-chat-sheet');
    expect(push).toHaveBeenCalledTimes(1);
    expect((window.history.state as { bastChat?: boolean }).bastChat).toBe(true);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    await waitFor(() => expect(screen.queryByTestId('bast-chat-sheet')).toBeNull());
    push.mockRestore();
  });
  it('closing with the button takes its own entry off again (one history.back, no stray entry) and does not reopen', async () => {
    responder = ownerResponder();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    render(app());
    await openIt();
    await screen.findByTestId('bast-chat-sheet');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByTestId('bast-chat-sheet')).toBeNull());
    expect(back).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(screen.queryByTestId('bast-chat-sheet')).toBeNull();
    // and opening again pushes a fresh entry
    const push = vi.spyOn(window.history, 'pushState');
    fireEvent.click(screen.getByTestId('bast-chat-button'));
    await screen.findByTestId('bast-chat-sheet');
    expect(push).toHaveBeenCalledTimes(1);
    back.mockRestore();
    push.mockRestore();
  });
  it('Escape closes the full-screen chat and gives the button focus back', async () => {
    responder = ownerResponder();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(app());
    const button = await openIt();
    await screen.findByTestId('bast-chat-sheet');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('bast-chat-input')));
    fireEvent.keyDown(screen.getByTestId('bast-chat-input'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('bast-chat-sheet')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
    back.mockRestore();
  });
  it('Escape closes it even when the focus is on the page, but not while another dialog is open', async () => {
    mq.coarse = true; // nothing is focused after opening on a phone
    responder = ownerResponder();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(app());
    await openIt();
    await screen.findByTestId('bast-chat-sheet');
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.appendChild(other);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('bast-chat-sheet')).toBeTruthy();
    other.remove();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('bast-chat-sheet')).toBeNull());
    back.mockRestore();
  });
  it('touch: the box takes its 16px from the global coarse-pointer rule (no inline size to fight it)', async () => {
    mq.coarse = true;
    responder = ownerResponder();
    render(app(null));
    await openIt();
    const box = await screen.findByTestId('bast-chat-input');
    expect(box.tagName).toBe('TEXTAREA');
    // The inline size is the desktop one; on a coarse pointer globals.css wins with !important (checked in a real touch browser).
    expect(box.style.fontSize).toBe('0.9rem');
    const css = readFileSync(resolve(__dirname, '../../../../app/globals.css'), 'utf8');
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{[^}]*textarea[^}]*font-size:\s*16px\s*!important/);
  });
  it('the split never touches history', async () => {
    mq.split = true;
    responder = ownerResponder();
    const push = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back');
    render(app());
    await openIt();
    await screen.findByTestId('bast-chat-split');
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await waitFor(() => expect(screen.queryByTestId('bast-chat-split')).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    push.mockRestore();
    back.mockRestore();
  });
});

describe('Bast chat shell: a card page and its conversation', () => {
  const triage: OpenCardInput = { key: `task:${U}`, title: 'Idea about invoices', type: 'task', task_id: U, tile: 'triage', own_conversation: true };
  const cardResponder = ownerResponder((url, init) => {
    if (url.endsWith('/conversations') && init?.method === 'POST') return { status: 201, body: { id: 'card-conv' } };
    return undefined;
  });
  it('split open: opening a Triage card switches the right side to that card, leaving it returns to the general chat', async () => {
    mq.split = true;
    responder = cardResponder;
    const r = render(app(null));
    await openIt();
    await screen.findByTestId('bast-chat-split');
    expect(screen.getByTestId('bast-chat-title').textContent).toBe('Bast');
    r.rerender(app(triage));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conversations') && JSON.stringify(c.body) === JSON.stringify({ task_id: U }))).toBe(true));
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Dox · Idea about invoices'));
    expect(screen.getByTestId('card-chat-line').textContent).toContain('Talking about: Idea about invoices');
    const statusBefore = calls.filter((c) => c.url.endsWith('/status')).length;
    r.rerender(app(null));
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Bast'));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/status')).length).toBeGreaterThan(statusBefore));
    expect(screen.queryByTestId('card-chat-line')).toBeNull();
  });
  it('in a card conversation the header button is Start fresh and starts a new conversation on the same card', async () => {
    mq.split = true;
    responder = cardResponder;
    render(app(triage));
    await openIt();
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Dox · Idea about invoices'));
    const btn = screen.getByRole('button', { name: 'Start fresh' });
    expect(btn.getAttribute('title')).toMatch(/about this card/);
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
    calls.length = 0;
    fireEvent.click(btn);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conversations'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/conversations'))!;
    expect(post.body).toEqual({ task_id: U, fresh: true });
    // still about the same card
    expect(screen.getByTestId('bast-chat-title').textContent).toBe('Dox · Idea about invoices');
  });
  it('the general chat keeps New chat, posting an empty body', async () => {
    mq.split = true;
    responder = cardResponder;
    render(app(null));
    await openIt();
    await screen.findByTestId('bast-chat-split');
    calls.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conversations'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/conversations'))!.body).toEqual({});
  });
  it('the Triage page does not switch a closed chat, nor a full-screen one', async () => {
    responder = cardResponder;
    render(app(triage));
    await screen.findByTestId('bast-chat-button');
    await act(async () => {});
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('Talk about this on a group after a card: the chat leaves that card and is about the group', async () => {
    responder = cardResponder;
    const group = { key: 'project-x', title: 'Queue Project: 3 ideas', tile: 'triage' };
    function Talker() {
      const shell = useBastChatShell();
      return (
        <>
          <button onClick={() => shell.talkAbout({ ...triage, own_conversation: true })}>card</button>
          <button onClick={() => shell.talkAbout(group)}>group</button>
        </>
      );
    }
    render(
      <BastChatProvider>
        <Page card={null} />
        <Talker />
      </BastChatProvider>,
    );
    await screen.findByTestId('bast-chat-button');
    fireEvent.click(screen.getByText('card'));
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Dox · Idea about invoices'));
    fireEvent.click(screen.getByText('group'));
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Bast'));
  });
  it('Talk about this opens the chat in place on that card (no navigation)', async () => {
    responder = cardResponder;
    function Talker() {
      const shell = useBastChatShell();
      return <button onClick={() => shell.talkAbout(triage, { bindToPage: true })}>talk</button>;
    }
    render(
      <BastChatProvider>
        <Page card={triage} />
        <Talker />
      </BastChatProvider>,
    );
    await screen.findByTestId('bast-chat-button');
    fireEvent.click(screen.getByText('talk'));
    await screen.findByTestId('bast-chat-sheet');
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Dox · Idea about invoices'));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conversations'))).toBe(true);
  });

  it('a card conversation is with Dox: name, card title beside it, composer, empty hint and dialog label; the general chat stays Bast', async () => {
    responder = cardResponder;
    function Talker() {
      const shell = useBastChatShell();
      return (
        <>
          <button onClick={() => shell.talkAbout(triage, { bindToPage: true })}>talk</button>
          <button onClick={() => shell.openChat()}>general</button>
        </>
      );
    }
    render(
      <BastChatProvider>
        <Page card={triage} />
        <Talker />
      </BastChatProvider>,
    );
    await screen.findByTestId('bast-chat-button');
    fireEvent.click(screen.getByText('talk'));
    await screen.findByTestId('bast-chat-sheet');
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Dox · Idea about invoices'));
    expect(screen.getByTestId('bast-chat-subtitle').textContent).toContain('Idea about invoices');
    expect((screen.getByTestId('bast-chat-input') as HTMLTextAreaElement).placeholder).toBe('Message Dox');
    expect(screen.getByTestId('bast-chat-sheet').getAttribute('aria-label')).toBe('Chat with Dox');
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('Conversation with Dox');
    fireEvent.click(screen.getByText('Back to the general chat'));
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Bast'));
    expect((screen.getByTestId('bast-chat-input') as HTMLTextAreaElement).placeholder).toBe('Message Bast');
    expect(screen.getByTestId('bast-chat-sheet').getAttribute('aria-label')).toBe('Chat with Bast');
  });
});

describe('Bast chat shell: the box', () => {
  it('shows the About line, lets him drop it, and sends only kind and id', async () => {
    responder = ownerResponder((url, init) => {
      if (url.endsWith('/messages') && init?.method === 'POST') return { status: 201, body: { seq: 1 } };
      return undefined;
    });
    render(app());
    await openIt();
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
  it('mouse: Enter sends and Shift+Enter does not; one line to start with and a send hint', async () => {
    responder = ownerResponder();
    render(app(null));
    await openIt();
    const input = (await screen.findByTestId('bast-chat-input')) as HTMLTextAreaElement;
    expect(input.rows).toBe(1);
    expect(input.getAttribute('enterkeyhint')).toBe('send');
    fireEvent.change(input, { target: { value: 'line one' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(calls.some((c) => c.url.endsWith('/messages'))).toBe(false);
  });
  it('touch: Enter is a new line (the key is not intercepted), only the Send button sends', async () => {
    mq.coarse = true;
    responder = ownerResponder((url, init) => (url.endsWith('/messages') && init?.method === 'POST' ? { status: 201, body: { seq: 1 } } : undefined));
    render(app(null));
    await openIt();
    const input = (await screen.findByTestId('bast-chat-input')) as HTMLTextAreaElement;
    // a finger does not get the keyboard raised the moment the chat opens
    expect(document.activeElement).not.toBe(input);
    expect(input.getAttribute('enterkeyhint')).toBe('enter');
    fireEvent.change(input, { target: { value: 'line one' } });
    const enter = fireEvent.keyDown(input, { key: 'Enter' });
    expect(enter).toBe(true); // not default-prevented: the browser inserts the new line
    expect(calls.some((c) => c.url.endsWith('/messages'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/messages'))).toBe(true));
  });
  it('shows the plain offline line and a working line, never a spinner', async () => {
    responder = ownerResponder((url) => {
      if (url.includes('/feed')) {
        return { status: 200, body: { conversation: { id: 'c1', status: 'running' }, events: [], live_text: null, live_action: null, worker: { online: false, paused: false, auth_state: 'token' }, actions: [] } };
      }
      return undefined;
    });
    render(app(null));
    await openIt();
    expect((await screen.findByTestId('worker-notice')).textContent).toBe("Bast's machine isn't answering right now. Your message will wait for 2 hours.");
    expect(document.querySelector('[role="progressbar"], svg.animate-spin')).toBeNull();
  });
});

describe('Bast chat shell: full-screen layout follows the visual viewport', () => {
  function stubViewport(v: { height: number; offsetTop: number }) {
    const listeners = new Map<string, Set<() => void>>();
    const vv = {
      ...v,
      addEventListener: (t: string, f: () => void) => void (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f),
      removeEventListener: (t: string, f: () => void) => void listeners.get(t)?.delete(f),
    };
    vi.stubGlobal('visualViewport', vv);
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (n: number) => clearTimeout(n));
    return { vv, fire: (t: string) => listeners.get(t)?.forEach((f) => f()) };
  }
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  });

  it('the sheet is the visible area: with the keyboard up its bottom edge, and the composer pinned to it, is the visual viewport bottom', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    const { vv, fire } = stubViewport({ height: 844, offsetTop: 0 });
    responder = ownerResponder();
    render(app());
    await openIt();
    const sheet = await screen.findByTestId('bast-chat-sheet');
    await waitFor(() => expect(sheet.style.height).toBe('844px'));
    expect(sheet.getAttribute('data-keyboard')).toBe('closed');
    // the keyboard comes up: 300px of the window is covered and iOS scrolled the layout viewport by 40px
    vv.height = 544;
    vv.offsetTop = 40;
    fire('resize');
    await waitFor(() => expect(sheet.style.height).toBe('544px'));
    expect(sheet.style.transform).toBe('translateY(40px)');
    expect(sheet.getAttribute('data-keyboard')).toBe('open');
    const top = 40;
    const bottom = top + parseFloat(sheet.style.height);
    expect(bottom).toBe(vv.offsetTop + vv.height); // never below the visible area
    expect(sheet.style.paddingBottom).toBe('0px');
    // composer is the last child of a flex column that cannot overflow the sheet
    expect(sheet.style.display).toBe('flex');
    expect(sheet.style.overflow).toBe('hidden');
    expect(sheet.contains(screen.getByTestId('bast-chat-composer'))).toBe(true);
    // keyboard goes away: back to the full height, safe-area padding returns
    vv.height = 844;
    vv.offsetTop = 0;
    fire('resize');
    await waitFor(() => expect(sheet.style.height).toBe('844px'));
    expect(sheet.style.transform).toBe('none');
    expect(sheet.getAttribute('data-keyboard')).toBe('closed'); // the safe-area padding is tied to this (jsdom cannot read env())
  });
  it('falls back to 100dvh without a visual viewport', async () => {
    responder = ownerResponder();
    render(app());
    await openIt();
    const sheet = await screen.findByTestId('bast-chat-sheet');
    expect(sheet.style.height).toBe('100dvh');
  });
});

describe('Bast chat shell: a slow read of the general chat never lands in a card conversation', () => {
  it('drops a feed answer that arrives after the switch', async () => {
    const triage: OpenCardInput = { key: `task:${U}`, title: 'Idea about invoices', type: 'task', task_id: U, tile: 'triage', own_conversation: true };
    let releaseGeneral: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseGeneral = r));
    responder = ownerResponder();
    const base = (globalThis.fetch as unknown as typeof fetch);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/conversations/c1/feed')) {
          await gate;
          return { status: 200, ok: true, json: async () => ({ conversation: { id: 'c1', status: 'idle' }, events: [{ seq: 1, role: 'assistant', kind: 'text', payload: { text: 'GENERAL TURN' } }], actions: [], worker: online }) } as Response;
        }
        if (url.endsWith('/conversations') && init?.method === 'POST') return { status: 201, ok: true, json: async () => ({ id: 'card-conv' }) } as Response;
        if (url.includes('/conversations/card-conv/feed')) return { status: 200, ok: true, json: async () => ({ conversation: { id: 'card-conv', status: 'idle' }, events: [], actions: [], worker: online }) } as Response;
        return base(url, init);
      }),
    );
    function Talker() {
      const shell = useBastChatShell();
      return <button onClick={() => { shell.openChat(); shell.talkAbout(triage); }}>go</button>;
    }
    render(<BastChatProvider><Page card={null} /><Talker /></BastChatProvider>);
    await screen.findByTestId('bast-chat-button');
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByTestId('bast-chat-title').textContent).toBe('Dox · Idea about invoices'));
    releaseGeneral();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByText('GENERAL TURN')).toBeNull();
  });
});
