import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  prefs: { data: undefined as unknown, isLoading: false, isError: false },
  search: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => h.search }));
vi.mock('@/lib/hooks/use-preferences', () => ({ usePreferences: () => h.prefs }));
vi.mock('@/lib/hooks/use-dashboard', () => ({
  useDashboard: () => ({
    data: { kind: 'tech' },
    isLoading: false,
    error: null,
    loadMore: vi.fn(),
    isLoadingMore: false,
  }),
  isTechDashboard: () => true,
  isPmDashboard: () => false,
  isAdminDashboard: () => false,
}));
vi.mock('@/components/domain/dashboard/tech-overlook', () => ({
  TechOverlook: () => <div>overlook-screen</div>,
}));
vi.mock('@/components/domain/dashboard/pm-overlook', () => ({ PmOverlook: () => null }));
vi.mock('@/components/domain/dashboard/admin-overlook', () => ({ AdminOverlook: () => null }));
vi.mock('@/components/domain/home/HomeScreen', () => ({
  HomeScreen: () => <div>home-screen</div>,
}));

import DashboardRoute from '../page';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  h.prefs = { data: undefined, isLoading: false, isError: false };
  h.search = new URLSearchParams();
});

describe('/dashboard switch', () => {
  it('shows the Overlook when home_view is overlook', async () => {
    h.prefs = { data: { preferences: { home_view: 'overlook' } }, isLoading: false, isError: false };
    render(<DashboardRoute />);
    expect(await screen.findByText('overlook-screen')).toBeTruthy();
    expect(screen.queryByText('home-screen')).toBeNull();
  });

  it('shows the Overlook when home_view is missing', async () => {
    h.prefs = { data: { preferences: {} }, isLoading: false, isError: false };
    render(<DashboardRoute />);
    expect(await screen.findByText('overlook-screen')).toBeTruthy();
    expect(screen.queryByText('home-screen')).toBeNull();
  });

  it('shows the Overlook when the preferences request errors', async () => {
    h.prefs = { data: undefined, isLoading: false, isError: true };
    render(<DashboardRoute />);
    expect(await screen.findByText('overlook-screen')).toBeTruthy();
    expect(screen.queryByText('home-screen')).toBeNull();
  });

  it('shows neither screen while preferences load', () => {
    h.prefs = { data: undefined, isLoading: true, isError: false };
    render(<DashboardRoute />);
    expect(screen.queryByText('overlook-screen')).toBeNull();
    expect(screen.queryByText('home-screen')).toBeNull();
  });

  it('shows HomeScreen when home_view is home', async () => {
    h.prefs = { data: { preferences: { home_view: 'home' } }, isLoading: false, isError: false };
    render(<DashboardRoute />);
    expect(await screen.findByText('home-screen')).toBeTruthy();
    expect(screen.queryByText('overlook-screen')).toBeNull();
  });

  it('shows the Overlook for home plus ?view=overlook', async () => {
    h.prefs = { data: { preferences: { home_view: 'home' } }, isLoading: false, isError: false };
    h.search = new URLSearchParams('view=overlook');
    render(<DashboardRoute />);
    expect(await screen.findByText('overlook-screen')).toBeTruthy();
    expect(screen.queryByText('home-screen')).toBeNull();
  });

  it('sends the person to the Overlook when preferences are still loading after 3 seconds', () => {
    vi.useFakeTimers();
    try {
      h.prefs = { data: undefined, isLoading: true, isError: false };
      render(<DashboardRoute />);
      act(() => {
        vi.advanceTimersByTime(2900);
      });
      expect(screen.queryByText('overlook-screen')).toBeNull();
      expect(screen.queryByText('home-screen')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByText('overlook-screen')).toBeTruthy();
      expect(screen.queryByText('home-screen')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the spinner first and decides only after mount (matches the server render)', async () => {
    const { renderToString } = await import('react-dom/server');
    h.prefs = { data: { preferences: { home_view: 'home' } }, isLoading: false, isError: false };
    const html = renderToString(<DashboardRoute />);
    expect(html).not.toContain('home-screen');
    expect(html).not.toContain('overlook-screen');
  });
});
