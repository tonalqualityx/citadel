import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalChatSettings } from '../portal-chat-settings';

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(async (url: string) =>
      url === '/portal-chat/status'
        ? { runner: { last_seen_at: new Date(Date.now() - 5 * 60_000).toISOString(), last_claim_at: null, dead: true }, today: { jobs: { done: 3, expired: 1 }, spend_usd: 0.42 } }
        : { mode: 'pilot', daily_cap_usd: 30, pilot_contact_ids: ['c1'], sites: [{ id: 's1', name: 'Maple', url: null, client: 'Maple Co', portal_chat_enabled: true }], contacts: [{ id: 'c1', name: 'Dana', email: 'd@x.test', role: 'owner', client: 'Maple Co' }] }
    ),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

describe('PortalChatSettings', () => {
  it('shows the mode, the pilot contact, the site switch, and the runner state', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PortalChatSettings />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId('portal-chat-settings')).toBeTruthy());
    expect((screen.getByRole('radio', { name: /Pilot/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /Dana/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /^Maple \(Maple Co\)/ }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(screen.getByTestId('chat-runner-status').textContent).toMatch(/Runner not answering.*Last seen 5 min ago/));
  });
});
