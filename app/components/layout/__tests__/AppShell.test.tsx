import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: vi.fn() }) }));
vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({ user: { name: 'Mike' }, isPmOrAdmin: true, isAdmin: true }),
}));
vi.mock('@/lib/hooks/use-terminology', () => ({ useTerminology: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/hooks/use-console-capture', () => ({ useConsoleCapture: () => {} }));
vi.mock('@/lib/api/client', () => ({ apiClient: { markLoggedOut: vi.fn() } }));
vi.mock('@/components/layout/timer-widget', () => ({ TimerWidget: () => null }));
vi.mock('@/components/layout/quick-task-modal', () => ({ QuickTaskModal: () => null }));
vi.mock('@/components/layout/bug-report-modal', () => ({ BugReportModal: () => null }));
vi.mock('@/components/layout/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/domain/notifications', () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));
vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: ({ collapsed }: { collapsed?: boolean }) => (
    <aside data-testid="sidebar" data-collapsed={collapsed ? 'true' : 'false'} />
  ),
}));

const mockUsePreferences = vi.fn();
vi.mock('@/lib/hooks/use-preferences', () => ({ usePreferences: () => mockUsePreferences() }));

import { AppShell } from '../AppShell';

function wrapperOf(container: HTMLElement) {
  return container.querySelector('main')!.parentElement!;
}

function expectToday(container: HTMLElement) {
  expect(screen.getByTestId('bell')).toBeInTheDocument();
  expect(wrapperOf(container)).toHaveClass('lg:pl-60');
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false');
  const menuButton = container.querySelector('header button')!;
  expect(menuButton).toHaveClass('lg:hidden');
  expect(screen.queryByText('Menu')).not.toBeInTheDocument();
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps today chrome for the overlook view', () => {
    mockUsePreferences.mockReturnValue({ data: { preferences: { home_view: 'overlook' } } });
    const { container } = render(<AppShell>body</AppShell>);
    expectToday(container);
  });

  it('keeps today chrome while preferences are missing', () => {
    mockUsePreferences.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<AppShell>body</AppShell>);
    expectToday(container);
  });

  it('keeps today chrome when preferences fail', () => {
    mockUsePreferences.mockReturnValue({ data: undefined, isError: true });
    const { container } = render(<AppShell>body</AppShell>);
    expectToday(container);
  });

  it('home view: no bell, sidebar collapsed, Menu visible and opens the nav', () => {
    mockUsePreferences.mockReturnValue({ data: { preferences: { home_view: 'home' } } });
    const { container } = render(<AppShell>body</AppShell>);
    expect(screen.queryByTestId('bell')).not.toBeInTheDocument();
    expect(wrapperOf(container)).not.toHaveClass('lg:pl-60');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');

    const menuButton = screen.getByRole('button', { name: 'Menu' });
    expect(menuButton).not.toHaveClass('lg:hidden');
    fireEvent.click(menuButton);
    const nav = screen.getByRole('navigation');
    expect(nav.parentElement).not.toHaveClass('lg:hidden');
  });
});
