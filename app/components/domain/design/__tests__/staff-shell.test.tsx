import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as React from 'react';

let pathname = '/design/s/11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: ({ collapsed }: { collapsed?: boolean }) => <aside data-testid="sidebar" data-collapsed={collapsed ? 'yes' : 'no'} /> }));
vi.mock('@/components/layout/Header', () => ({ Header: () => <header /> }));
vi.mock('@/components/layout/app-providers', () => ({ AppProviders: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/layout/CommandPalette', () => ({ CommandPalette: () => null }));

import { DesignStaffShell, SIDEBAR_KEY, isWorkspaceRoute } from '../DesignStaffShell';
import { TOP_KEY, resetTopHiddenForTests } from '../workspace-chrome';

// A small in-memory Storage, so the test does not depend on the environment's localStorage.
function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
let store = memoryStorage();
const collapsed = () => screen.getByTestId('sidebar').getAttribute('data-collapsed');

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
  pathname = '/design/s/11111111-1111-4111-8111-111111111111';
  resetTopHiddenForTests();
});

describe('DesignStaffShell sidebar', () => {
  it('recognises only the workspace route', () => {
    expect(isWorkspaceRoute('/design/s/abc')).toBe(true);
    expect(isWorkspaceRoute('/design')).toBe(false);
    expect(isWorkspaceRoute('/design/admin')).toBe(false);
    expect(isWorkspaceRoute(null)).toBe(false);
  });

  it('is collapsed by default on the workspace route, with a toggle that opens it and remembers', () => {
    const { unmount } = render(<DesignStaffShell>x</DesignStaffShell>);
    expect(collapsed()).toBe('yes');
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(collapsed()).toBe('no');
    expect(store.getItem(SIDEBAR_KEY)).toBe('open');
    unmount();
    render(<DesignStaffShell>x</DesignStaffShell>);
    expect(collapsed()).toBe('no');
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(collapsed()).toBe('yes');
    expect(store.getItem(SIDEBAR_KEY)).toBe('closed');
  });

  it.each(['/design', '/design/admin'])('keeps the normal sidebar and no toggle on %s', (p) => {
    pathname = p;
    store.setItem(SIDEBAR_KEY, 'closed');
    render(<DesignStaffShell>x</DesignStaffShell>);
    expect(collapsed()).toBe('no');
    expect(screen.queryByTestId('sidebar-toggle')).toBeNull();
  });

  it('still works when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    render(<DesignStaffShell>x</DesignStaffShell>);
    expect(collapsed()).toBe('yes');
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(collapsed()).toBe('no');
  });
});

describe('DesignStaffShell layout and hidden top', () => {
  const wrap = () => screen.getByTestId('staff-header-wrap');

  it('the workspace route is exactly the viewport tall and does not scroll; other routes keep their layout', () => {
    const { container, unmount } = render(<DesignStaffShell>x</DesignStaffShell>);
    expect(container.firstElementChild!.className).toContain('h-dvh');
    expect(container.firstElementChild!.className).toContain('overflow-hidden');
    expect(container.querySelector('main')!.className).toBe('flex min-h-0 flex-1 flex-col p-3');
    expect(wrap().parentElement!.className).toContain('flex h-dvh min-h-0 flex-col');
    unmount();
    pathname = '/design';
    const other = render(<DesignStaffShell>x</DesignStaffShell>);
    expect(other.container.firstElementChild!.className).toContain('min-h-screen');
    expect(other.container.firstElementChild!.className).not.toContain('h-dvh');
    expect(other.container.querySelector('main')!.className).toBe('p-6');
  });

  it('shows the header and the sidebar toggle by default', () => {
    render(<DesignStaffShell>x</DesignStaffShell>);
    expect(wrap().hidden).toBe(false);
    expect((screen.getByTestId('sidebar-toggle') as HTMLButtonElement).hidden).toBe(false);
  });

  it('with the top hidden: header wrapper hidden but mounted, no toggle row, sidebar collapsed, saved choice untouched', () => {
    store.setItem(SIDEBAR_KEY, 'open');
    store.setItem(TOP_KEY, 'hidden');
    const { container } = render(<DesignStaffShell>x</DesignStaffShell>);
    expect(wrap().hidden).toBe(true);
    expect(wrap().querySelector('header')).not.toBeNull();
    expect((screen.getByTestId('sidebar-toggle') as HTMLButtonElement).hidden).toBe(true);
    expect(collapsed()).toBe('yes');
    expect(container.querySelector('.lg\\:pl-60')).toBeNull();
    expect(store.getItem(SIDEBAR_KEY)).toBe('open');
  });

  it('brings the sidebar back to the saved choice when the top is shown again', () => {
    store.setItem(SIDEBAR_KEY, 'open');
    store.setItem(TOP_KEY, 'hidden');
    render(<DesignStaffShell>x</DesignStaffShell>);
    expect(collapsed()).toBe('yes');
    act(() => {
      store.setItem(TOP_KEY, 'shown');
      resetTopHiddenForTests();
    });
    expect(collapsed()).toBe('no');
    expect(wrap().hidden).toBe(false);
  });

  it.each(['/design', '/design/admin'])('does not apply the hidden top on %s', (p) => {
    pathname = p;
    store.setItem(TOP_KEY, 'hidden');
    render(<DesignStaffShell>x</DesignStaffShell>);
    expect(wrap().hidden).toBe(false);
    expect(collapsed()).toBe('no');
  });
});
