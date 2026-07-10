import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

// Mock next/navigation
let mockPathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({
    t: (key: string) => {
      const terms: Record<string, string> = {
        dashboard: 'Dashboard',
        foundry: 'Foundry',
        parley: 'Parley',
        grimoire: 'Grimoire',
        projects: 'Projects',
        clients: 'Clients',
        sites: 'Sites',
        domains: 'Domains',
        tasks: 'Tasks',
        tools: 'Tools',
        deals: 'Deals',
        meetings: 'Meetings',
        retainers: 'Retainers',
        products: 'Products',
        sops: 'SOPs',
        recipes: 'Recipes',
      };
      return terms[key] || key;
    },
  }),
}));

const mockUseAuth = vi.fn();
vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Import after mocks
import { MobileNav } from '../MobileNav';

describe('MobileNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/dashboard';
    mockUseAuth.mockReturnValue({ isPmOrAdmin: true, isAdmin: true });
  });

  it('renders nothing when closed', () => {
    render(<MobileNav open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Menu')).not.toBeInTheDocument();
  });

  it('renders the drawer with a bounded, scrollable nav region when open', () => {
    render(<MobileNav open onClose={vi.fn()} />);
    expect(screen.getByText('Menu')).toBeInTheDocument();

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveClass('flex-1');
    expect(nav).toHaveClass('overflow-y-auto');

    // Drawer container is a flex column so header stays fixed-height and
    // the nav gets a bounded height to scroll within.
    const drawer = nav.parentElement;
    expect(drawer).toHaveClass('flex');
    expect(drawer).toHaveClass('flex-col');
  });

  it('collapses and expands a section when its header is tapped', () => {
    render(<MobileNav open onClose={vi.fn()} />);

    // Foundry section defaults open (mirrors Sidebar's defaultOpen)
    expect(screen.getByText('Sites')).toBeInTheDocument();

    const sectionHeader = screen.getByRole('button', { name: /Foundry/i });
    fireEvent.click(sectionHeader);
    expect(screen.queryByText('Sites')).not.toBeInTheDocument();

    fireEvent.click(sectionHeader);
    expect(screen.getByText('Sites')).toBeInTheDocument();
  });

  it('keeps the section containing the active route open by default', () => {
    mockPathname = '/sops';
    render(<MobileNav open onClose={vi.fn()} />);

    // Grimoire section has no defaultOpen, but /sops is active within it
    expect(screen.getByText('SOPs')).toBeInTheDocument();
  });

  it('does not render the Parley or Admin sections for non-PM/Admin users', () => {
    mockUseAuth.mockReturnValue({ isPmOrAdmin: false, isAdmin: false });
    render(<MobileNav open onClose={vi.fn()} />);

    expect(screen.queryByText('Deals')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Admin/i })).not.toBeInTheDocument();
  });
});
