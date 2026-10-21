import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';

let pathname = '/portal/home';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { PortalNav as Nav } from '../portal-nav';
const PortalNav = () => <Nav>page</Nav>;

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const labels = () => within(screen.getAllByRole('navigation', { name: 'Main' })[0]).getAllByRole('link').map((a) => a.textContent);

describe('PortalNav', () => {
  it('shows Home first, then the other destinations, on a page only a signed-in person can open', () => {
    pathname = '/portal/home';
    render(<PortalNav />);
    expect(labels()).toEqual(['Home', 'Projects', 'Retainer', 'Requests', 'History', 'Book a meeting']);
  });

  it('marks the current page', () => {
    pathname = '/portal/retainer';
    render(<PortalNav />);
    expect(within(screen.getAllByRole('navigation', { name: 'Main' })[0]).getByRole('link', { name: 'Retainer' })).toHaveAttribute('aria-current', 'page');
  });

  for (const p of ['/portal/task-approval/abc', '/portal/proposal/abc', '/portal/contract/abc', '/portal/msa/abc', '/portal/addendum/abc', '/portal/onboard/abc', '/portal/articles/1']) {
    it(`${p} shows the nav once a session is confirmed`, async () => {
      pathname = p;
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ active_client_id: 'c1', clients: [{ id: 'c1', name: 'Ridgeline' }] }) });
      render(<PortalNav />);
      if (!p.startsWith('/portal/articles')) await waitFor(() => expect(screen.getAllByRole('navigation', { name: 'Main' })[0]).toBeInTheDocument());
      expect(labels()[0]).toBe('Home');
    });
  }

  it('a token page opened with no session shows no nav', async () => {
    pathname = '/portal/proposal/abc';
    fetchMock.mockResolvedValue({ ok: false });
    render(<PortalNav />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/portal/clients'));
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('the sign-in pages never show it and never ask', () => {
    for (const p of ['/portal/login', '/portal/login/verify']) {
      pathname = p;
      const { unmount } = render(<PortalNav />);
      expect(screen.queryByRole('navigation')).toBeNull();
      unmount();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the account picker carries the nav', () => {
    pathname = '/portal/select';
    render(<PortalNav />);
    expect(labels()[0]).toBe('Home');
  });
});
