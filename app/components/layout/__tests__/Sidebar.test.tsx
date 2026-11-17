import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img alt="" src={String(props.src)} />,
}));

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({
    isAwesome: false,
    t: (key: string) => {
      const terms: Record<string, string> = { dashboard: 'Dashboard', foundry: 'Foundry', projects: 'Projects', clients: 'Clients', sites: 'Sites', domains: 'Domains', tasks: 'Tasks', tools: 'Tools' };
      return terms[key] || key;
    },
  }),
}));

vi.mock('@/lib/api/client', () => ({ apiClient: { post: vi.fn() } }));

const mockUseAuth = vi.fn();
vi.mock('@/lib/hooks/use-auth', () => ({ useAuth: () => mockUseAuth() }));

import { Sidebar } from '../Sidebar';

const hrefs = () => Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));

describe('Sidebar Design and Projects links', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tech sees Design and not Projects', () => {
    mockUseAuth.mockReturnValue({ isPmOrAdmin: false, isAdmin: false, isTech: true });
    render(<Sidebar />);
    expect(hrefs()).toContain('/design');
    expect(hrefs()).not.toContain('/projects');
  });

  it('pm and admin see Projects, then Design right after it', () => {
    mockUseAuth.mockReturnValue({ isPmOrAdmin: true, isAdmin: true, isTech: false });
    render(<Sidebar />);
    const list = hrefs();
    expect(list).toContain('/projects');
    expect(list.indexOf('/design')).toBe(list.indexOf('/projects') + 1);
  });

  it('a user with no flags sees neither', () => {
    mockUseAuth.mockReturnValue({ isPmOrAdmin: false, isAdmin: false, isTech: false });
    render(<Sidebar />);
    expect(hrefs()).not.toContain('/design');
    expect(hrefs()).not.toContain('/projects');
  });
});
