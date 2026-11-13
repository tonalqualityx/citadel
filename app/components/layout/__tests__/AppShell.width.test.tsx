import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/layout/Header', () => ({ Header: () => <header>header</header> }));
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/CommandPalette', () => ({ CommandPalette: () => null }));
let homeView = 'home';
vi.mock('@/lib/hooks/use-preferences', () => ({ usePreferences: () => ({ data: { preferences: { home_view: homeView } } }) }));

import { AppShell } from '../AppShell';
import { usePageBastChat, useBastChatShell } from '@/components/domain/bast-chat/BastChatProvider';
import { BAST_CHAT_WIDTH_KEY } from '@/components/domain/bast-chat/chat-width';

const online = { online: true, paused: false, auth_state: 'token' };
let store: Map<string, string>;
function Page() {
  usePageBastChat(null);
  const shell = useBastChatShell();
  return <button onClick={shell.openChat}>open</button>;
}
const setVw = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
};
beforeEach(() => {
  store = new Map();
  homeView = 'home';
  setVw(1440);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('orientation'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.endsWith('/status')
        ? { enabled: true, worker: online, conversation_id: 'c1' }
        : { conversation: { id: 'c1', status: 'idle' }, events: [], live_text: null, live_action: null, worker: online, actions: [] };
      return { status: 200, ok: true, json: async () => body } as Response;
    }),
  );
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSplit() {
  const r = render(<AppShell><Page /></AppShell>);
  fireEvent.click(await screen.findByTestId('bast-chat-button'));
  await screen.findByTestId('bast-chat-split');
  return r;
}
const columns = () => screen.getByTestId('shell-body').getAttribute('data-columns');

describe('split chat width', () => {
  it('starts at the normal clamp', async () => {
    await openSplit();
    expect(columns()).toBe('minmax(0, 1fr) clamp(360px, 34vw, 480px)');
  });
  it('the header button toggles wide (864px at 1440) and back, and remembers it', async () => {
    const { unmount } = await openSplit();
    const btn = screen.getByRole('button', { name: 'Make the chat wider' });
    fireEvent.click(btn);
    expect(columns()).toBe('minmax(0, 1fr) 864px');
    expect(store.get(BAST_CHAT_WIDTH_KEY)).toBe('wide');
    expect(screen.getByRole('button', { name: 'Make the chat narrower' }).getAttribute('aria-pressed')).toBe('true');
    unmount();
    cleanup();
    await openSplit();
    expect(columns()).toBe('minmax(0, 1fr) 864px');
    fireEvent.click(screen.getByRole('button', { name: 'Make the chat narrower' }));
    expect(columns()).toBe('minmax(0, 1fr) clamp(360px, 34vw, 480px)');
    expect(store.get(BAST_CHAT_WIDTH_KEY)).toBe('normal');
  });
  it('keeps the page column at 360px when the sidebar is showing', async () => {
    homeView = 'overlook';
    await openSplit();
    fireEvent.click(screen.getByRole('button', { name: 'Make the chat wider' }));
    expect(columns()).toBe('minmax(0, 1fr) 840px');
  });
  it('is disabled with a reason when the window cannot fit both', async () => {
    homeView = 'overlook';
    setVw(1100);
    await openSplit();
    const btn = screen.getByTestId('bast-chat-width-toggle') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/too narrow/);
    fireEvent.click(btn);
    expect(columns()).toBe('minmax(0, 1fr) clamp(360px, 34vw, 480px)');
  });
  it('arrow keys on the divider resize within bounds, Home/End jump, double-click resets', async () => {
    await openSplit();
    const div = screen.getByRole('separator', { name: 'Resize chat' });
    expect(div.getAttribute('aria-valuemin')).toBe('360');
    expect(div.getAttribute('aria-valuemax')).toBe('960');
    fireEvent.keyDown(div, { key: 'ArrowLeft' });
    const start = Number(screen.getByRole('separator').getAttribute('aria-valuenow'));
    expect(start).toBe(Math.round(0.34 * 1440 > 480 ? 480 : 0.34 * 1440) + 24);
    fireEvent.keyDown(div, { key: 'ArrowRight', shiftKey: true });
    expect(Number(div.getAttribute('aria-valuenow'))).toBe(start - 96);
    fireEvent.keyDown(div, { key: 'End' });
    expect(div.getAttribute('aria-valuenow')).toBe('960');
    fireEvent.keyDown(div, { key: 'Home' });
    expect(div.getAttribute('aria-valuenow')).toBe('360');
    expect(store.get(BAST_CHAT_WIDTH_KEY)).toBe('360');
    fireEvent.doubleClick(div);
    expect(columns()).toBe('minmax(0, 1fr) clamp(360px, 34vw, 480px)');
  });
  it('dragging the divider left widens by the distance and saves on release', async () => {
    await openSplit();
    const div = screen.getByRole('separator');
    fireEvent.pointerDown(div, { clientX: 1000, pointerId: 1, button: 0 });
    fireEvent.pointerMove(div, { clientX: 900, pointerId: 1 });
    expect(columns()).toBe('minmax(0, 1fr) 580px');
    expect(store.get(BAST_CHAT_WIDTH_KEY)).toBeUndefined();
    fireEvent.pointerMove(div, { clientX: 100, pointerId: 1 });
    expect(columns()).toBe('minmax(0, 1fr) 960px');
    fireEvent.pointerUp(div, { clientX: 700, pointerId: 1 });
    expect(columns()).toBe('minmax(0, 1fr) 780px');
    expect(store.get(BAST_CHAT_WIDTH_KEY)).toBe('780');
  });
  it('a saved width wider than this window allows is held to the limit', async () => {
    store.set(BAST_CHAT_WIDTH_KEY, '950');
    setVw(1200);
    await openSplit();
    expect(columns()).toBe('minmax(0, 1fr) 840px');
  });
});
