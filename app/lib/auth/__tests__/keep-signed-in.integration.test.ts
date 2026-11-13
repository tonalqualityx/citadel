// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-access-secret-test-access-secret';
  process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-test-refresh-secret';
});

const mocks = vi.hoisted(() => ({ jar: {} as Record<string, string> }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (mocks.jar[n] !== undefined ? { name: n, value: mocks.jar[n] } : undefined) }),
  headers: async () => new Headers(),
}));

import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { verifyRefreshToken, verifyAccessToken } from '@/lib/auth/jwt';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as refreshRoute } from '@/app/api/auth/refresh/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { GET as continueRoute } from '@/app/api/auth/continue/route';

const DAY = 86400;
const login = (email: string, extra: Record<string, unknown> = {}, ip = '10.0.0.1') =>
  loginRoute(
    new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, password: 'pw-test-123', ...extra }),
    })
  );
const attr = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))!;
const val = (res: Response, name: string) => attr(res, name).split(';')[0].slice(name.length + 1);
const maxAge = (res: Response, name: string) => Number(/max-age=(\d+)/i.exec(attr(res, name))![1]);
const lifetime = async (token: string) => {
  const p = await verifyRefreshToken(token);
  return p.exp! - p.iat!;
};

describe.skipIf(!SCRATCH)('Keep me signed in on this device (real database)', () => {
  const tag = crypto.randomBytes(3).toString('hex');
  const email = `keep-${tag}@example.test`;
  let userId = '';

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email, password_hash: await bcrypt.hash('pw-test-123', 4), name: 'Keep', role: 'tech' },
    });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.session.deleteMany({ where: { user_id: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });
  beforeEach(() => {
    mocks.jar = {};
  });

  it('default sign-in is unchanged: 7-day refresh cookie and token, 15-minute access, no keep claim', async () => {
    const res = await login(email, {}, '10.0.1.1');
    expect(res.status).toBe(200);
    expect(maxAge(res, 'refresh_token')).toBe(7 * DAY);
    expect(maxAge(res, 'access_token')).toBe(900);
    const p = await verifyRefreshToken(val(res, 'refresh_token'));
    expect(p.keep).toBeUndefined();
    expect(await lifetime(val(res, 'refresh_token'))).toBe(7 * DAY);
    expect(attr(res, 'refresh_token').toLowerCase()).toContain('httponly');
    // an explicit false is the same as unticked
    const res2 = await login(email, { keep_signed_in: false }, '10.0.1.1');
    expect(maxAge(res2, 'refresh_token')).toBe(7 * DAY);
  });

  it('ticked: 30-day refresh cookie and token, access stays 15 minutes, session row long', async () => {
    const res = await login(email, { keep_signed_in: true }, '10.0.2.1');
    expect(res.status).toBe(200);
    expect(maxAge(res, 'refresh_token')).toBe(30 * DAY);
    expect(maxAge(res, 'access_token')).toBe(900);
    expect(await lifetime(val(res, 'refresh_token'))).toBe(30 * DAY);
    expect((await verifyRefreshToken(val(res, 'refresh_token'))).keep).toBe(true);
    expect((await verifyAccessToken(val(res, 'access_token')) as { keep?: boolean }).keep).toBeUndefined();
    const sid = (await verifyRefreshToken(val(res, 'refresh_token'))).sid!;
    const row = await prisma.session.findUnique({ where: { id: sid } });
    expect(row!.expires_at.getTime() - Date.now()).toBeGreaterThan(29 * DAY * 1000);
  });

  it('ticked refresh renews the full long lifetime (sliding), through refresh and continue', async () => {
    const first = await login(email, { keep_signed_in: true }, '10.0.3.1');
    mocks.jar = { refresh_token: val(first, 'refresh_token') };
    const r = await refreshRoute();
    expect(r.status).toBe(200);
    expect(maxAge(r, 'refresh_token')).toBe(30 * DAY);
    expect(await lifetime(val(r, 'refresh_token'))).toBe(30 * DAY);
    expect((await verifyRefreshToken(val(r, 'refresh_token'))).keep).toBe(true);

    const c = await continueRoute(
      new NextRequest('http://localhost/api/auth/continue?to=/tasks', { headers: { cookie: `refresh_token=${val(r, 'refresh_token')}` } })
    );
    expect(c.status).toBe(307);
    expect(c.headers.get('location')).toBe('/tasks');
    expect(maxAge(c, 'refresh_token')).toBe(30 * DAY);
    expect(maxAge(c, 'access_token')).toBe(900);
  });

  it('unticked refresh stays 7 days through refresh and continue', async () => {
    const first = await login(email, {}, '10.0.4.1');
    mocks.jar = { refresh_token: val(first, 'refresh_token') };
    const r = await refreshRoute();
    expect(maxAge(r, 'refresh_token')).toBe(7 * DAY);
    expect((await verifyRefreshToken(val(r, 'refresh_token'))).keep).toBeUndefined();
    const c = await continueRoute(
      new NextRequest('http://localhost/api/auth/continue?to=/tasks', { headers: { cookie: `refresh_token=${val(r, 'refresh_token')}` } })
    );
    expect(maxAge(c, 'refresh_token')).toBe(7 * DAY);
  });

  it('a default sign-in elsewhere does not shorten a kept device (each device has its own row)', async () => {
    const kept = await login(email, { keep_signed_in: true }, '10.0.5.1');
    const other = await login(email, {}, '10.0.5.2');
    const keptSid = (await verifyRefreshToken(val(kept, 'refresh_token'))).sid!;
    const otherSid = (await verifyRefreshToken(val(other, 'refresh_token'))).sid!;
    expect(keptSid).not.toBe(otherSid);
    const keptRow = await prisma.session.findUnique({ where: { id: keptSid } });
    const otherRow = await prisma.session.findUnique({ where: { id: otherSid } });
    expect(keptRow!.expires_at.getTime() - Date.now()).toBeGreaterThan(29 * DAY * 1000);
    expect(otherRow!.expires_at.getTime() - Date.now()).toBeLessThan(8 * DAY * 1000);
  });

  describe('cannot be obtained by tampering', () => {
    it('a default session cannot be upgraded by a query value, a body value or a cookie on refresh and continue', async () => {
      const first = await login(email, {}, '10.0.6.1');
      const rt = val(first, 'refresh_token');
      mocks.jar = { refresh_token: rt, keep_signed_in: 'true', keep: '1' };
      const r = await refreshRoute();
      expect(maxAge(r, 'refresh_token')).toBe(7 * DAY);
      const c = await continueRoute(
        new NextRequest('http://localhost/api/auth/continue?to=/x&keep_signed_in=true&keep=1', {
          headers: { cookie: `refresh_token=${val(r, 'refresh_token')}; keep_signed_in=true; keep=1` },
        })
      );
      expect(maxAge(c, 'refresh_token')).toBe(7 * DAY);
    });

    it('a refresh token with keep added by hand is refused (bad signature), nothing is set', async () => {
      const { SignJWT } = await import('jose');
      const forged = await new SignJWT({ userId, email, role: 'tech', keep: true, sid: crypto.randomUUID() })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('90d')
        .sign(new TextEncoder().encode('not-the-refresh-secret-not-the-refresh-secret'));
      const c = await continueRoute(
        new NextRequest('http://localhost/api/auth/continue?to=/x', { headers: { cookie: `refresh_token=${forged}` } })
      );
      expect(c.headers.get('location')).toBe('/login');
      expect(c.headers.getSetCookie()).toEqual([]);
      mocks.jar = { refresh_token: forged };
      {
        const r = await refreshRoute();
        expect(r.status).toBe(401);
        expect(r.headers.getSetCookie()).toEqual([]);
      }
    });

    it('a keep claim on an access token (the other secret) does not work as a refresh token', async () => {
      const { SignJWT } = await import('jose');
      const t = await new SignJWT({ userId, email, role: 'tech', keep: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('90d')
        .sign(new TextEncoder().encode(process.env.JWT_SECRET));
      mocks.jar = { refresh_token: t };
      const r = await refreshRoute();
      expect(r.status).toBe(401);
      expect(r.headers.getSetCookie()).toEqual([]);
    });

    it('a non-boolean keep_signed_in at login is refused, not treated as ticked', async () => {
      const res = await login(email, { keep_signed_in: 'true' }, '10.0.7.1');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers.getSetCookie()).toEqual([]);
    });
  });

  it('sign out on a kept device clears both cookies and ends the session', async () => {
    const kept = await login(email, { keep_signed_in: true }, '10.0.8.1');
    const rt = val(kept, 'refresh_token');
    mocks.jar = { refresh_token: rt };
    const out = await logoutRoute();
    expect(maxAge(out, 'refresh_token')).toBe(0);
    expect(maxAge(out, 'access_token')).toBe(0);
    expect(await prisma.session.count({ where: { user_id: userId } })).toBe(0);
    // the old long token no longer refreshes or continues
    expect((await refreshRoute()).status).toBe(401);
    const c = await continueRoute(
      new NextRequest('http://localhost/api/auth/continue?to=/x', { headers: { cookie: `refresh_token=${rt}` } })
    );
    expect(c.headers.get('location')).toBe('/login');
  });
});
