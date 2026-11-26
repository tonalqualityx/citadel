import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET, PATCH } from '../route';
import { jsonRequest, signIn, anonymous, DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() }, userPreference: { findUnique: vi.fn(), upsert: vi.fn() } },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const prefFind = prisma.userPreference.findUnique as Mock;
const upsert = prisma.userPreference.upsert as Mock;
const patch = (b: unknown, headers: Record<string, string> = { origin: 'http://localhost' }) =>
  PATCH(jsonRequest('/api/design/me/auto-timer', 'PATCH', b, headers));

beforeEach(() => vi.clearAllMocks());

describe('GET /api/design/me/auto-timer', () => {
  it('is off for a designer with no preferences row', async () => {
    signIn(auth, userFind, 'designer');
    prefFind.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ auto_time_tracking: false });
    expect(prefFind).toHaveBeenCalledWith({ where: { user_id: DESIGNER_ID }, select: { auto_time_tracking: true } });
  });
  it('returns the stored value', async () => {
    signIn(auth, userFind, 'tech');
    prefFind.mockResolvedValue({ auto_time_tracking: true });
    expect(await (await GET()).json()).toEqual({ auto_time_tracking: true });
  });
  it('401 when signed out; 403 for an API key', async () => {
    anonymous(auth);
    expect((await GET()).status).toBe(401);
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await GET()).status).toBe(403);
  });
});

describe('PATCH /api/design/me/auto-timer', () => {
  it('a designer turns their own setting on and off', async () => {
    signIn(auth, userFind, 'designer');
    for (const value of [true, false]) {
      upsert.mockResolvedValue({ auto_time_tracking: value });
      const res = await patch({ auto_time_tracking: value });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ auto_time_tracking: value });
      expect(upsert.mock.calls.at(-1)![0]).toEqual({
        where: { user_id: DESIGNER_ID },
        update: { auto_time_tracking: value },
        create: { user_id: DESIGNER_ID, auto_time_tracking: value },
        select: { auto_time_tracking: true },
      });
    }
  });
  it('rejects anything but the one boolean field', async () => {
    signIn(auth, userFind, 'designer');
    expect((await patch({ auto_time_tracking: 'yes' })).status).toBe(400);
    expect((await patch({ auto_time_tracking: true, theme: 'dark' })).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
  it('refuses a cross-site request', async () => {
    signIn(auth, userFind, 'designer');
    expect((await patch({ auto_time_tracking: true }, { origin: 'https://evil.example' })).status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});
