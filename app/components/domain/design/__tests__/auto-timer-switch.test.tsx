import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a) } }));

import { AutoTimerSwitch } from '../AutoTimerSwitch';

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AutoTimerSwitch /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('AutoTimerSwitch (the person\'s own automatic time tracking, portal header)', () => {
  it('shows the stored setting off and turns it on', async () => {
    get.mockResolvedValue({ auto_time_tracking: false });
    patch.mockResolvedValue({ auto_time_tracking: true });
    renderIt();
    const sw = await screen.findByRole('switch');
    expect(get).toHaveBeenCalledWith('/design/me/auto-timer');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Auto timer')).toBeTruthy();
    fireEvent.click(sw);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/me/auto-timer', { auto_time_tracking: true }));
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'));
  });

  it('shows it on and turns it off', async () => {
    get.mockResolvedValue({ auto_time_tracking: true });
    patch.mockResolvedValue({ auto_time_tracking: false });
    renderIt();
    const sw = await screen.findByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/me/auto-timer', { auto_time_tracking: false }));
  });
});
