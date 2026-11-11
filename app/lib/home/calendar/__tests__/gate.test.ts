import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { userPreference: { findUnique: vi.fn() } } }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { requireCalendarOwner } from '../gate';

const mockAuth = requireAuth as Mock;
const mockPref = prisma.userPreference.findUnique as Mock;
const mike = { userId: 'u1', email: 'mike@becomeindelible.com', role: 'admin', via: 'session' };

async function status(): Promise<number | 'ok'> {
  try {
    await requireCalendarOwner();
    return 'ok';
  } catch (e) {
    if (e instanceof AuthError) return e.statusCode;
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mike);
  mockPref.mockResolvedValue({ home_view: 'home' });
});

describe('requireCalendarOwner', () => {
  it('lets him in, whatever the case of the address', async () => {
    expect(await status()).toBe('ok');
    mockAuth.mockResolvedValue({ ...mike, email: 'Mike@BecomeIndelible.com' });
    expect(await status()).toBe('ok');
  });
  it('403 for an API key', async () => {
    mockAuth.mockResolvedValue({ ...mike, via: 'api_key' });
    expect(await status()).toBe(403);
  });
  it('403 for a tech user', async () => {
    mockAuth.mockResolvedValue({ ...mike, role: 'tech' });
    expect(await status()).toBe(403);
  });
  it('403 for an admin whose home view is overlook', async () => {
    mockPref.mockResolvedValue({ home_view: 'overlook' });
    expect(await status()).toBe(403);
  });
  it('403 for an admin with home view home and another address', async () => {
    mockAuth.mockResolvedValue({ ...mike, userId: 'u2', email: 'sabeen@becomeindelible.com' });
    expect(await status()).toBe(403);
  });
  it('403 when the address is missing', async () => {
    mockAuth.mockResolvedValue({ ...mike, email: undefined });
    expect(await status()).toBe(403);
  });
});
