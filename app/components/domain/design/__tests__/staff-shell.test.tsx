import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

let pathname = '/design/s/11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: ({ collapsed }: { collapsed?: boolean }) => <aside data-testid="sidebar" data-collapsed={collapsed ? 'yes' : 'no'} /> }));
vi.mock('@/components/layout/Header', () => ({ Header: () => <header /> }));
vi.mock('@/components/layout/app-providers', () => ({ AppProviders: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/layout/CommandPalette', () => ({ CommandPalette: () => null }));

import { DesignStaffShell, SIDEBAR_KEY, isWorkspaceRoute } from '../DesignStaffShell';

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

  it.each(['/design', '/design/admin', '/design/admin/budgets'])('keeps the normal sidebar and no toggle on %s', (p) => {
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
