import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

const mockUsePreferences = vi.fn();
const mutate = vi.fn();
vi.mock('@/lib/hooks/use-preferences', () => ({
  usePreferences: () => mockUsePreferences(),
  useUpdatePreferences: () => ({ mutate, isPending: false }),
}));

const mockUseAuth = vi.fn();
vi.mock('@/lib/hooks/use-auth', () => ({ useAuth: () => mockUseAuth() }));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/api/client', () => ({ apiClient: { patch: vi.fn() } }));
vi.mock('@/lib/utils/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('@/components/domain/home/LearnedCard', () => ({ LearnedCard: () => <div>Learned card</div> }));
vi.mock('@/components/domain/settings/portal-chat-settings', () => ({ PortalChatSettings: () => null }));

import GuildPage from '../page';

const HELP =
  'Which screen opens first. Home screen also hides the bell, folds the sidebar behind Menu, and quiets mentions from Bast and other bots.';

describe('Settings: First screen card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePreferences.mockReturnValue({
      data: { preferences: { home_view: 'overlook', naming_convention: 'awesome', theme: 'system' } },
      isLoading: false,
    });
  });

  it('shows for admins with both options and the help text', () => {
    mockUseAuth.mockReturnValue({ user: { name: 'Mike', role: 'admin' }, isAdmin: true });
    render(<GuildPage />);
    expect(screen.getByText('First screen')).toBeInTheDocument();
    expect(screen.getByText(HELP)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home screen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overlook' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('choosing Home screen saves home_view home', () => {
    mockUseAuth.mockReturnValue({ user: { name: 'Mike', role: 'admin' }, isAdmin: true });
    render(<GuildPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Home screen' }));
    expect(mutate).toHaveBeenCalledWith({ home_view: 'home' });
  });

  it('choosing Overlook saves home_view overlook', () => {
    mockUsePreferences.mockReturnValue({
      data: { preferences: { home_view: 'home', naming_convention: 'awesome', theme: 'system' } },
      isLoading: false,
    });
    mockUseAuth.mockReturnValue({ user: { name: 'Mike', role: 'admin' }, isAdmin: true });
    render(<GuildPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Overlook' }));
    expect(mutate).toHaveBeenCalledWith({ home_view: 'overlook' });
  });

  it('is not shown to non-admins', () => {
    mockUseAuth.mockReturnValue({ user: { name: 'Sam', role: 'tech' }, isAdmin: false });
    render(<GuildPage />);
    expect(screen.queryByText('First screen')).not.toBeInTheDocument();
  });

  it('shows What the home screen learned only while the Home screen is the first screen', () => {
    mockUseAuth.mockReturnValue({ user: { name: 'Mike', role: 'admin' }, isAdmin: true });
    const { unmount } = render(<GuildPage />);
    expect(screen.queryByText('Learned card')).not.toBeInTheDocument();
    unmount();
    mockUsePreferences.mockReturnValue({
      data: { preferences: { home_view: 'home', naming_convention: 'awesome', theme: 'system' } },
      isLoading: false,
    });
    render(<GuildPage />);
    expect(screen.getByText('Learned card')).toBeInTheDocument();
  });
});
