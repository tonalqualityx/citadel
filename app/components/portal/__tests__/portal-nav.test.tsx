import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

let pathname = '/portal/home';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

import { PortalNav } from '../portal-nav';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const labels = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('PortalNav', () => {
  it('shows Home first, then the other destinations, on a page only a signed-in person can open', () => {
    pathname = '/portal/home';
    render(<PortalNav />);
    expect(labels().slice(0, 6)).toEqual(['Home', 'Projects', 'Retainer', 'Requests', 'History', 'Book a meeting']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the current page', () => {
    pathname = '/portal/retainer';
    render(<PortalNav />);
    expect(screen.getByRole('link', { name: 'Retainer' })).toHaveAttribute('aria-current', 'page');
  });

  for (const p of ['/portal/task-approval/abc', '/portal/proposal/abc', '/portal/contract/abc', '/portal/msa/abc', '/portal/addendum/abc', '/portal/onboard/abc', '/portal/articles/1']) {
    it(`${p} shows the nav once a session is confirmed`, async () => {
      pathname = p;
      fetchMock.mockResolvedValue({ ok: true });
      render(<PortalNav />);
      if (!p.startsWith('/portal/articles')) await waitFor(() => expect(screen.getByRole('navigation', { name: 'Portal' })).toBeInTheDocument());
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
      const { container } = render(<PortalNav />);
      expect(container).toBeEmptyDOMElement();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the account picker carries the nav', () => {
    pathname = '/portal/select';
    render(<PortalNav />);
    expect(labels()[0]).toBe('Home');
  });
});
