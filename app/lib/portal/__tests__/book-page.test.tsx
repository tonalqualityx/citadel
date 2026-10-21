import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const cookieGet = vi.fn();

vi.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock('@/lib/services/client-auth', () => ({
  CLIENT_SESSION_COOKIE: 'client_session',
  validateClientSession: vi.fn(),
}));
vi.mock('@/components/portal/booking-picker', () => ({ BookingPicker: () => null }));

import BookMeetingPage from '@/app/(portal)/portal/book/page';
import { validateClientSession } from '@/lib/services/client-auth';
import type { Mock } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/portal/book session gate', () => {
  it('redirects to the login page without a session cookie', async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(BookMeetingPage()).rejects.toThrow('NEXT_REDIRECT:/portal/login');
    expect(validateClientSession).not.toHaveBeenCalled();
  });

  it('redirects when the session is expired or revoked', async () => {
    cookieGet.mockReturnValue({ value: 'tok' });
    (validateClientSession as Mock).mockResolvedValue(null);
    await expect(BookMeetingPage()).rejects.toThrow('NEXT_REDIRECT:/portal/login');
  });

  it('renders the picker for a valid session', async () => {
    cookieGet.mockReturnValue({ value: 'tok' });
    (validateClientSession as Mock).mockResolvedValue({ clientId: 'c', contactId: 'x' });
    const el = await BookMeetingPage();
    expect(el).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
