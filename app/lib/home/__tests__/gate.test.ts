import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { userPreference: { findUnique: vi.fn() } },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { requireHomeUser } from '../gate';

const mockAuth = requireAuth as Mock;
const mockPref = prisma.userPreference.findUnique as Mock;

const session = { userId: 'u1', email: 'a@b.c', role: 'admin', via: 'session' };

async function status(): Promise<number | 'ok'> {
  try {
    await requireHomeUser();
    return 'ok';
  } catch (e) {
    if (e instanceof AuthError) return e.statusCode;
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockPref.mockResolvedValue({ home_view: 'home' });
});

describe('requireHomeUser', () => {
  it('returns the auth payload for an admin session whose own home_view is home', async () => {
    await expect(requireHomeUser()).resolves.toEqual(session);
  });

  it('reads only the caller\'s own preference row', async () => {
    await requireHomeUser();
    expect(mockPref).toHaveBeenCalledWith({ where: { user_id: 'u1' }, select: { home_view: true } });
  });

  it('403 for an admin whose home_view is overlook', async () => {
    mockPref.mockResolvedValue({ home_view: 'overlook' });
    expect(await status()).toBe(403);
  });

  it('403 for an admin with no preference row', async () => {
    mockPref.mockResolvedValue(null);
    expect(await status()).toBe(403);
  });

  it.each(['pm', 'tech', 'designer'])('403 for role %s even with home_view home, without reading the preference', async (role) => {
    mockAuth.mockResolvedValue({ ...session, role });
    expect(await status()).toBe(403);
    expect(mockPref).not.toHaveBeenCalled();
  });

  it('403 for an API key caller, even an admin key with home_view home', async () => {
    mockAuth.mockResolvedValue({ ...session, via: 'api_key', apiKeyId: 'k1' });
    expect(await status()).toBe(403);
    expect(mockPref).not.toHaveBeenCalled();
  });

  it('403 when the payload does not say it is a session', async () => {
    mockAuth.mockResolvedValue({ userId: 'u1', email: 'a@b.c', role: 'admin' });
    expect(await status()).toBe(403);
  });

  it('passes requireAuth\'s own 401 through', async () => {
    mockAuth.mockRejectedValue(new AuthError('Authentication required', 401));
    expect(await status()).toBe(401);
  });
});
