import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

vi.mock('next/navigation', () => ({ usePathname: () => '/portal/home', useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { PortalShell } from '../shell/portal-shell';
import { PortalButton } from '../ui/button';
import { ViewAsProvider } from '../view-as-context';
import { viewAsBannerText, VIEW_AS_READ_ONLY_LINE } from '@/lib/portal/view-as-copy';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('view-as banner and read-only buttons', () => {
  it('builds the banner line the spec asks for', () => {
    expect(viewAsBannerText('Acme Co', 'owner')).toBe('Viewing as Acme Co (Owner). Read-only.');
    expect(viewAsBannerText('Acme Co', 'viewer')).toBe('Viewing as Acme Co (Viewer). Read-only.');
  });

  it('shows the banner on a portal page when the session is a view-as session, and Exit view ends it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/portal/clients') {
        return { ok: true, json: async () => ({ active_client_id: 'c1', clients: [{ id: 'c1', name: 'Acme Co' }], view_as: { client_name: 'Acme Co', role: 'member' } }) };
      }
      return { ok: true, json: async () => ({ ended: true, return_to: '/clients/c1' }) };
    });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    render(<PortalShell>page</PortalShell>);
    const banner = await screen.findByText('Viewing as Acme Co (Member). Read-only.');
    expect(banner.closest('[data-view-as-banner]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit view' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/clients/c1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/portal-view-as/exit', expect.objectContaining({ method: 'POST' }));
  });

  it('shows no banner for a real client session', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ active_client_id: 'c1', clients: [{ id: 'c1', name: 'Acme Co' }] }) });
    render(<PortalShell>page</PortalShell>);
    await waitFor(() => expect(screen.getAllByText('Acme Co').length).toBeGreaterThan(0));
    expect(document.querySelector('[data-view-as-banner]')).toBeNull();
  });

  it('a writes button is disabled with the read-only line in a view, and normal outside one', () => {
    const { rerender } = render(<PortalButton writes>Approve</PortalButton>);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.queryByText(VIEW_AS_READ_ONLY_LINE)).toBeNull();
    rerender(
      <ViewAsProvider value={{ clientName: 'Acme Co', role: 'owner' }}>
        <PortalButton writes>Approve</PortalButton>
        <PortalButton>Open</PortalButton>
      </ViewAsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByText(VIEW_AS_READ_ONLY_LINE)).toBeInTheDocument();
    // A button that only looks at something stays live.
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
  });
});
