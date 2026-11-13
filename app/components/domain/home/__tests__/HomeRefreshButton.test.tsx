import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HomeRefreshButton } from '../HomeRefreshButton';

function setDisplayMode(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: standalone && q.includes('display-mode: standalone'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => vi.restoreAllMocks());

describe('HomeRefreshButton', () => {
  it('does not render in a normal browser tab', () => {
    setDisplayMode(false);
    render(<HomeRefreshButton onRefresh={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
  });
  it('renders in standalone display mode and reloads the home data when tapped', async () => {
    setDisplayMode(true);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<HomeRefreshButton onRefresh={onRefresh} />);
    fireEvent.click(await screen.findByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: /refresh/i })).not.toBeDisabled());
  });
});
