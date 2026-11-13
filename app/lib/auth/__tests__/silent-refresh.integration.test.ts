// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-access-secret-test-access-secret';
  process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-test-refresh-secret';
});

// A mutable cookie jar and header set stand in for the request, so the layout helper and the auth
// routes run for real against the scratch database.
const mocks = vi.hoisted(() => ({ jar: {} as Record<string, string>, headers: {} as Record<string, string> }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (mocks.jar[n] !== undefined ? { name: n, value: mocks.jar[n] } : undefined) }),
  headers: async () => new Headers(mocks.headers),
}));
class Redirected extends Error {
  constructor(public to: string) {
    super(to);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { signAccessToken, signRefreshToken, createOrUpdateSession, deleteUserSessions } from '@/lib/auth/jwt';
import { GET as continueRoute } from '@/app/api/auth/continue/route';
import { POST as refreshRoute } from '@/app/api/auth/refresh/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { redirectToContinueOrLogin } from '@/lib/auth/silent-refresh';

const cont = (to: string | null, cookies: Record<string, string> = {}) => {
  const url = `http://localhost/api/auth/continue${to === null ? '' : `?to=${encodeURIComponent(to)}`}`;
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return continueRoute(new NextRequest(url, { headers: cookie ? { cookie } : {} }));
};
const setNames = (res: Response) => res.headers.getSetCookie().map((c) => c.split('=')[0]).sort();
const cookieValue = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);
const layoutTarget = async () => {
  try {
    await redirectToContinueOrLogin();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  return 'no-redirect';
};

describe.skipIf(!SCRATCH)('silent refresh on a cold open (real database)', () => {
  const tag = crypto.randomBytes(3).toString('hex');
  const roles = ['admin', 'pm', 'tech', 'designer'] as const;
  const users: Record<string, { id: string; email: string; refresh: string }> = {};

  beforeAll(async () => {
    for (const role of roles) {
      const u = await prisma.user.create({
        data: { email: `sr-${role}-${tag}@example.test`, password_hash: 'x', name: `SR ${role}`, role },
      });
      const refresh = await signRefreshToken({ userId: u.id, email: u.email, role });
      await createOrUpdateSession(u.id, refresh);
      users[role] = { id: u.id, email: u.email, refresh };
    }
  });
  afterAll(async () => {
    const ids = Object.values(users).map((u) => u.id);
    await prisma.session.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });
  beforeEach(() => {
    mocks.jar = {};
    mocks.headers = {};
  });

  it.each(roles)('%s: valid refresh cookie lands on the requested page with a new access cookie', async (role) => {
    const res = await cont('/tasks/abc?tab=2', { refresh_token: users[role].refresh });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/tasks/abc?tab=2');
    const access = cookieValue(res, 'access_token');
    expect(access).toBeTruthy();
    expect(setNames(res)).toEqual(['access_token', 'refresh_token', 'silent_refresh']);
    const header = res.headers.getSetCookie().find((c) => c.startsWith('access_token='))!.toLowerCase();
    expect(header).toContain('httponly');
    expect(header).toContain('samesite=lax');
    expect(header).toContain('max-age=900');
    expect(header).toContain('path=/');
    const rt = res.headers.getSetCookie().find((c) => c.startsWith('refresh_token='))!.toLowerCase();
    expect(rt).toContain('max-age=604800');
    // The new access token works against a real route handler (role carried through).
    const { verifyAccessToken } = await import('@/lib/auth/jwt');
    expect((await verifyAccessToken(access!)).role).toBe(role);
    // The session row now holds the new refresh token (same as POST /api/auth/refresh).
    const row = await prisma.session.findFirst({ where: { user_id: users[role].id } });
    expect(row?.refresh_token).toBe(cookieValue(res, 'refresh_token'));
    users[role].refresh = cookieValue(res, 'refresh_token')!;
  });

  it('never touches portal cookies', async () => {
    const res = await cont('/dashboard', { refresh_token: users.admin.refresh, client_session: 'portal', view_as_stash: 's' });
    expect(setNames(res).some((n) => /client_session|stash/i.test(n))).toBe(false);
  });

  it('garbage refresh cookie goes to /login with nothing set', async () => {
    const res = await cont('/dashboard', { refresh_token: 'garbage' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/login');
    expect(setNames(res)).toEqual([]);
  });

  it('expired refresh token goes to /login with nothing set', async () => {
    const { SignJWT } = await import('jose');
    const old = await new SignJWT({ userId: users.admin.id, email: users.admin.email, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(new TextEncoder().encode(process.env.JWT_REFRESH_SECRET));
    const res = await cont('/dashboard', { refresh_token: old });
    expect(res.headers.get('location')).toBe('/login');
    expect(setNames(res)).toEqual([]);
  });

  it('no refresh cookie goes to /login', async () => {
    const res = await cont('/dashboard');
    expect(res.headers.get('location')).toBe('/login');
    expect(setNames(res)).toEqual([]);
  });

  it('revoked (signed out) session goes to /login', async () => {
    const u = users.tech;
    await deleteUserSessions(u.id);
    const res = await cont('/dashboard', { refresh_token: u.refresh });
    expect(res.headers.get('location')).toBe('/login');
    expect(setNames(res)).toEqual([]);
    await createOrUpdateSession(u.id, u.refresh); // restore for later tests
  });

  it('inactive user goes to /login', async () => {
    const u = users.pm;
    await prisma.user.update({ where: { id: u.id }, data: { is_active: false } });
    const res = await cont('/dashboard', { refresh_token: u.refresh });
    expect(res.headers.get('location')).toBe('/login');
    await prisma.user.update({ where: { id: u.id }, data: { is_active: true } });
  });

  it.each([
    'https://evil.example/x',
    '//evil.example',
    '/\\evil.example',
    '/%5Cevil.example',
    '/api/tasks',
  ])('open-redirect attempt %s never becomes the Location', async (to) => {
    const res = await cont(to, { refresh_token: users.admin.refresh });
    const loc = res.headers.get('location');
    expect(loc).toBe('/dashboard'); // refresh still succeeds, the bad target is replaced by the default
    users.admin.refresh = cookieValue(res, 'refresh_token')!;
  });

  it('missing to goes to /dashboard', async () => {
    const res = await cont(null, { refresh_token: users.admin.refresh });
    expect(res.headers.get('location')).toBe('/dashboard');
    users.admin.refresh = cookieValue(res, 'refresh_token')!;
  });

  describe('layout helper', () => {
    it('refresh cookie and page header: sends the cold open through continue with the page path', async () => {
      mocks.jar = { refresh_token: 'x' };
      mocks.headers = { 'x-citadel-page': '/tasks/abc?tab=2' };
      expect(await layoutTarget()).toBe('/api/auth/continue?to=%2Ftasks%2Fabc%3Ftab%3D2');
    });
    it('no refresh cookie: /login as today', async () => {
      mocks.headers = { 'x-citadel-page': '/tasks' };
      expect(await layoutTarget()).toBe('/login');
    });
    it('no loop: just came through continue (marker cookie), goes to /login', async () => {
      mocks.jar = { refresh_token: 'x', silent_refresh: '1' };
      mocks.headers = { 'x-citadel-page': '/tasks' };
      expect(await layoutTarget()).toBe('/login');
    });
    it('unsafe or missing page header: /login, never an open redirect', async () => {
      mocks.jar = { refresh_token: 'x' };
      mocks.headers = { 'x-citadel-page': '//evil.example' };
      expect(await layoutTarget()).toBe('/login');
      mocks.headers = {};
      expect(await layoutTarget()).toBe('/login');
    });
  });

  describe('API routes unchanged', () => {
    it('a protected API route with no access cookie is still 401, not a redirect', async () => {
      const res = await meRoute();
      expect(res.status).toBe(401);
      expect(res.headers.get('location')).toBeNull();
    });
    it('POST /api/auth/refresh still refreshes, and still 401s without a cookie', async () => {
      const bad = await refreshRoute();
      expect(bad.status).toBe(401);
      mocks.jar = { refresh_token: users.admin.refresh };
      const ok = await refreshRoute();
      expect(ok.status).toBe(200);
      expect(setNames(ok)).toEqual(['access_token', 'refresh_token']);
    });
  });
});
