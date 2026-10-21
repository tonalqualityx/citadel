import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import * as React from 'react';

let pathname = '/portal/home';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { PortalShell } from '../portal-shell';
import { isBarePath, activeKey } from '../nav-items';
import { ThemeControl } from '../theme-control';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ active_client_id: 'c1', clients: [{ id: 'c1', name: 'Ridgeline' }, { id: 'c2', name: 'Other' }] }) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const sidebar = () => screen.getByRole('complementary', { name: 'Portal' });

describe('PortalShell', () => {
  it('sidebar: Request work plus six destinations, in order', () => {
    pathname = '/portal/home';
    render(<PortalShell>page</PortalShell>);
    const side = within(sidebar());
    expect(side.getByRole('link', { name: 'Request work' })).toHaveAttribute('href', '/portal/requests/new');
    const nav = side.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Projects', 'Retainer', 'Requests', 'History', 'Book a meeting']);
  });

  it('phones: five slots, the fifth is More', () => {
    pathname = '/portal/home';
    render(<PortalShell>page</PortalShell>);
    const bar = screen.getAllByRole('navigation', { name: 'Portal' })[0];
    const slots = [...within(bar).queryAllByRole('link'), ...within(bar).queryAllByRole('button')].map((e) => e.textContent);
    expect(slots).toEqual(['Home', 'Projects', 'Retainer', 'Requests', 'More']);
  });

  it('marks the current page with aria-current', () => {
    pathname = '/portal/retainer';
    render(<PortalShell>page</PortalShell>);
    const current = within(sidebar()).getByRole('link', { name: 'Retainer' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('a work page lights Requests, and History lights More on a phone', () => {
    pathname = '/portal/work/abc';
    const { unmount } = render(<PortalShell>page</PortalShell>);
    expect(within(sidebar()).getByRole('link', { name: 'Requests' })).toHaveAttribute('aria-current', 'page');
    unmount();
    pathname = '/portal/history';
    render(<PortalShell>page</PortalShell>);
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  });

  it('names the active client and offers Switch account only with two or more', async () => {
    pathname = '/portal/home';
    render(<PortalShell>page</PortalShell>);
    await waitFor(() => expect(within(sidebar()).getByText('Ridgeline')).toBeInTheDocument());
    expect(within(sidebar()).getByRole('link', { name: 'Switch account' })).toHaveAttribute('href', '/portal/select');
  });

  for (const p of ['/portal/login', '/portal/login/verify', '/portal/select', '/portal/proposal/x', '/portal/contract/x', '/portal/msa/x', '/portal/addendum/x', '/portal/onboard/x', '/portal/task-approval/x']) {
    it(`${p} is the bare variant: no nav, no session fetch, help line present`, () => {
      pathname = p;
      render(<PortalShell>page</PortalShell>);
      expect(screen.queryByRole('navigation')).toBeNull();
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(screen.getByText('support@becomeindelible.com')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('isBarePath and activeKey agree on the edges', () => {
    expect(isBarePath('/portal/articles/1')).toBe(false);
    expect(isBarePath('/portal/work/1')).toBe(false);
    expect(activeKey('/portal/articles/1')).toBeNull();
  });
});

describe('More sheet', () => {
  it('opens as a modal dialog, closes on Escape and returns focus to More', () => {
    pathname = '/portal/home';
    render(<PortalShell>page</PortalShell>);
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    fireEvent.click(more);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole('link', { name: 'History' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Book a meeting' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('keeps Tab inside the dialog', () => {
    pathname = '/portal/home';
    render(<PortalShell>page</PortalShell>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog');
    const items = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    items[items.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });
});

describe('ThemeControl', () => {
  it('survives a throwing localStorage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    document.body.innerHTML = '';
    const root = document.createElement('div');
    root.setAttribute('data-portal', '');
    document.body.appendChild(root);
    render(<ThemeControl />, { container: root.appendChild(document.createElement('div')) });
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
