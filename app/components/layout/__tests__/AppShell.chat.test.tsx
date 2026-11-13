import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/layout/Header', () => ({ Header: () => <header data-testid="header">header</header> }));
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/lib/hooks/use-preferences', () => ({ usePreferences: () => ({ data: { preferences: { home_view: 'home' } } }) }));

import { AppShell } from '../AppShell';
import { usePageBastChat, useBastChatShell } from '@/components/domain/bast-chat/BastChatProvider';

let split = true;
const online = { online: true, paused: false, auth_state: 'token' };
let mounts = 0;
function Page() {
  usePageBastChat(null);
  const shell = useBastChatShell();
  React.useEffect(() => {
    mounts += 1;
  }, []);
  return <button onClick={shell.openChat}>open</button>;
}

beforeEach(() => {
  mounts = 0;
  split = true;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('orientation') ? split : false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
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

describe('AppShell with the Bast chat', () => {
  it('closed: the shell is exactly the old one (no grid, no fixed height, page scrolls in the window)', async () => {
    const { container } = render(<AppShell><Page /></AppShell>);
    await screen.findByTestId('bast-chat-button');
    const root = container.firstElementChild as HTMLElement;
    const body = screen.getByTestId('shell-body');
    expect(root.style.height).toBe('');
    expect(root.style.overflow).toBe('');
    expect(body.style.display).toBe('');
    expect(container.querySelector('main')!.style.overflowY).toBe('');
    expect(root.getAttribute('data-shell-mode')).toBe('closed');
  });
  it('split: a two-column grid of minmax(0,1fr) and clamp(360px,34vw,480px), one screen tall, the page and the chat each scrolling in their own column', async () => {
    const { container } = render(<AppShell><Page /></AppShell>);
    fireEvent.click(await screen.findByText('open'));
    const aside = await screen.findByTestId('bast-chat-split');
    const root = container.firstElementChild as HTMLElement;
    const body = screen.getByTestId('shell-body');
    const main = container.querySelector('main')!;
    expect(root.style.height).toBe('100dvh');
    expect(root.style.overflow).toBe('hidden');
    expect(root.style.position).toBe('relative'); // clips absolutely placed page content so the window cannot scroll
    expect(body.style.display).toBe('grid');
    expect(body.getAttribute('data-columns')).toBe('minmax(0, 1fr) clamp(360px, 34vw, 480px)'); // jsdom cannot hold clamp() in a style
    expect(body.className).toContain('[&>header]:col-span-full');
    expect(main.style.overflowY).toBe('auto');
    expect(aside.parentElement).toBe(body);
    expect(main.parentElement).toBe(body);
    expect(aside.style.overflow).toBe('hidden'); // its own log scrolls inside it
    // closing returns the page to full width
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await waitFor(() => expect(screen.queryByTestId('bast-chat-split')).toBeNull());
    expect(body.style.display).toBe('');
    expect(main.style.overflowY).toBe('');
  });
  it('opening and closing the chat never remounts the page', async () => {
    render(<AppShell><Page /></AppShell>);
    fireEvent.click(await screen.findByText('open'));
    await screen.findByTestId('bast-chat-split');
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await waitFor(() => expect(screen.queryByTestId('bast-chat-split')).toBeNull());
    expect(mounts).toBe(1);
  });
  it('full screen (portrait): the shell is not turned into a grid; the sheet covers it', async () => {
    split = false;
    const { container } = render(<AppShell><Page /></AppShell>);
    fireEvent.click(await screen.findByText('open'));
    await screen.findByTestId('bast-chat-sheet');
    expect((container.firstElementChild as HTMLElement).style.height).toBe('');
    expect(screen.getByTestId('shell-body').style.display).toBe('');
  });
});
