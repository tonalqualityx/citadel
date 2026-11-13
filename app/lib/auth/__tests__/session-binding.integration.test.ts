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
import { verifyRefreshToken, verifyAccessToken, signRefreshToken } from '@/lib/auth/jwt';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as refreshRoute } from '@/app/api/auth/refresh/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { POST as resetRoute } from '@/app/api/auth/reset-password/route';
import { GET as continueRoute } from '@/app/api/auth/continue/route';
import { PATCH as patchUser, DELETE as deleteUser } from '@/app/api/users/[id]/route';

const DAY = 86400;
let ipn = 1;
const login = (email: string, extra: Record<string, unknown> = {}) =>
  loginRoute(
    new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(ipn / 250)}.${(ipn++ % 250) + 1}` },
      body: JSON.stringify({ email, password: 'pw-test-123', ...extra }),
    })
  );
const attr = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))!;
const val = (res: Response, name: string) => attr(res, name).split(';')[0].slice(name.length + 1);
const maxAge = (res: Response, name: string) => Number(/max-age=(\d+)/i.exec(attr(res, name))![1]);
const refresh = (token: string) => {
  mocks.jar = { refresh_token: token };
  return refreshRoute();
};
const logout = (token: string) => {
  mocks.jar = { refresh_token: token };
  return logoutRoute();
};
const cont = (token: string | null, to = '/tasks') =>
  continueRoute(new NextRequest(`http://localhost/api/auth/continue?to=${encodeURIComponent(to)}`, { headers: token ? { cookie: `refresh_token=${token}` } : {} }));
const rowOf = async (token: string) => prisma.session.findUnique({ where: { id: (await verifyRefreshToken(token)).sid! } });

describe.skipIf(!SCRATCH)('refresh is bound to one session per sign-in (real database)', () => {
  const tag = crypto.randomBytes(3).toString('hex');
  const email = `bind-${tag}@example.test`;
  const email2 = `bind2-${tag}@example.test`;
  const adminEmail = `bind-admin-${tag}@example.test`;
  let userId = '';
  let user2Id = '';
  let adminId = '';

  beforeAll(async () => {
    const hash = await bcrypt.hash('pw-test-123', 4);
    userId = (await prisma.user.create({ data: { email, password_hash: hash, name: 'Bind', role: 'tech' } })).id;
    user2Id = (await prisma.user.create({ data: { email: email2, password_hash: hash, name: 'Bind2', role: 'designer' } })).id;
    adminId = (await prisma.user.create({ data: { email: adminEmail, password_hash: hash, name: 'Bind admin', role: 'admin' } })).id;
  });
  afterAll(async () => {
    const ids = [userId, user2Id, adminId];
    await prisma.passwordResetToken.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.session.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });
  beforeEach(async () => {
    mocks.jar = {};
    await prisma.session.deleteMany({ where: { user_id: { in: [userId, user2Id, adminId] } } });
  });

  it('login makes a new row per sign-in with the row id as sid; the refresh token carries sid', async () => {
    const a = await login(email);
    const b = await login(email);
    const sa = (await verifyRefreshToken(val(a, 'refresh_token'))).sid!;
    const sb = (await verifyRefreshToken(val(b, 'refresh_token'))).sid!;
    expect(sa).toMatch(/^[0-9a-f-]{36}$/);
    expect(sa).not.toBe(sb);
    expect(await prisma.session.count({ where: { user_id: userId } })).toBe(2);
    expect((await prisma.session.findUnique({ where: { id: sa } }))!.refresh_token).toBe(val(a, 'refresh_token'));
  });

  it("login deletes only the user's EXPIRED rows, never live ones or another user's", async () => {
    const live = await login(email);
    const mine = await prisma.session.create({ data: { user_id: userId, refresh_token: `old-${tag}`, expires_at: new Date(Date.now() - 1000) } });
    const theirs = await prisma.session.create({ data: { user_id: user2Id, refresh_token: `old2-${tag}`, expires_at: new Date(Date.now() - 1000) } });
    await login(email);
    expect(await prisma.session.findUnique({ where: { id: mine.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    expect(await rowOf(val(live, 'refresh_token'))).not.toBeNull();
  });

  it("sign out on B then sign in again does NOT revive a lost device's older refresh token (the reported weakness)", async () => {
    const phone = await login(email); // phone A, then lost
    const laptop = await login(email); // laptop B
    await logout(val(laptop, 'refresh_token')); // rows deleted
    expect((await refresh(val(phone, 'refresh_token'))).status).toBe(401);
    const laptop2 = await login(email); // B signs in again: a new row
    expect(laptop2.status).toBe(200);
    // the lost phone's old, unexpired token stays dead
    const revived = await refresh(val(phone, 'refresh_token'));
    expect(revived.status).toBe(401);
    expect(revived.headers.getSetCookie()).toEqual([]);
    const c = await cont(val(phone, 'refresh_token'));
    expect(c.headers.get('location')).toBe('/login');
    expect(c.headers.getSetCookie()).toEqual([]);
    // and the new sign-in is fine
    expect((await refresh(val(laptop2, 'refresh_token'))).status).toBe(200);
  });

  it('a password reset (email link) ends every device for good, even after a new sign-in', async () => {
    const a = await login(email);
    const b = await login(email);
    const token = crypto.randomBytes(16).toString('hex');
    await prisma.passwordResetToken.create({ data: { user_id: userId, token, expires_at: new Date(Date.now() + 3600_000) } });
    const res = await resetRoute(
      new NextRequest('http://localhost/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.8.0.1' },
        body: JSON.stringify({ token, password: 'new-password-123' }),
      })
    );
    expect(res.status).toBe(200);
    expect(await prisma.session.count({ where: { user_id: userId } })).toBe(0);
    await prisma.user.update({ where: { id: userId }, data: { password_hash: await bcrypt.hash('pw-test-123', 4) } });
    await login(email); // a later sign-in must not revive them
    expect((await refresh(val(a, 'refresh_token'))).status).toBe(401);
    expect((await refresh(val(b, 'refresh_token'))).status).toBe(401);
  });

  describe('admin routes', () => {
    const asAdmin = async () => {
      const r = await login(adminEmail);
      mocks.jar = { access_token: val(r, 'access_token') };
    };
    const call = (body: unknown) =>
      patchUser(
        new NextRequest(`http://localhost/api/users/${userId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        { params: Promise.resolve({ id: userId }) }
      );

    it('an admin password change ends every device for that user', async () => {
      const a = await login(email);
      const b = await login(email);
      await asAdmin();
      expect((await call({ password: 'another-pass-123' })).status).toBe(200);
      expect(await prisma.session.count({ where: { user_id: userId } })).toBe(0);
      expect((await refresh(val(a, 'refresh_token'))).status).toBe(401);
      expect((await refresh(val(b, 'refresh_token'))).status).toBe(401);
      await prisma.user.update({ where: { id: userId }, data: { password_hash: await bcrypt.hash('pw-test-123', 4) } });
    });

    it('deactivating a user ends every device (rows deleted, and refresh refuses an inactive user)', async () => {
      const a = await login(email);
      await asAdmin();
      expect((await call({ is_active: false })).status).toBe(200);
      expect(await prisma.session.count({ where: { user_id: userId } })).toBe(0);
      expect((await refresh(val(a, 'refresh_token'))).status).toBe(401);
      await prisma.user.update({ where: { id: userId }, data: { is_active: true } });
    });

    it('an inactive user with a live row is refused by refresh (401)', async () => {
      const a = await login(email);
      await prisma.user.update({ where: { id: userId }, data: { is_active: false } });
      expect((await refresh(val(a, 'refresh_token'))).status).toBe(401);
      await prisma.user.update({ where: { id: userId }, data: { is_active: true } });
    });

    it('the soft delete (user with related records) also ends every device', async () => {
      const a = await login(email);
      const client = await prisma.client.create({ data: { name: `Bind ${tag}`, type: 'direct', status: 'active' } });
      const task = await prisma.task.create({ data: { title: `bind ${tag}`, client_id: client.id, assignee_id: userId, status: 'not_started' } });
      await asAdmin();
      const res = await deleteUser(new NextRequest(`http://localhost/api/users/${userId}`, { method: 'DELETE' }), { params: Promise.resolve({ id: userId }) });
      expect(res.status).toBe(200);
      expect(await prisma.session.count({ where: { user_id: userId } })).toBe(0);
      expect((await refresh(val(a, 'refresh_token'))).status).toBe(401);
      await prisma.task.delete({ where: { id: task.id } });
      await prisma.client.delete({ where: { id: client.id } });
      await prisma.user.update({ where: { id: userId }, data: { is_active: true } });
    });
  });

  it("another user's sid is rejected (token subject differs from the row owner)", async () => {
    const mine = await login(email);
    const theirs = await login(email2);
    const theirSid = (await verifyRefreshToken(val(theirs, 'refresh_token'))).sid!;
    const forged = await signRefreshToken({ userId, email, role: 'tech', sid: theirSid });
    const res = await refresh(forged);
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect((await cont(forged)).headers.get('location')).toBe('/login');
    // neither row was touched
    expect((await rowOf(val(theirs, 'refresh_token')))!.refresh_token).toBe(val(theirs, 'refresh_token'));
    expect((await refresh(val(mine, 'refresh_token'))).status).toBe(200);
  });

  it('a missing row, an expired row and a malformed sid are 401, never 500', async () => {
    const a = await login(email);
    const sid = (await verifyRefreshToken(val(a, 'refresh_token'))).sid!;
    await prisma.session.update({ where: { id: sid }, data: { expires_at: new Date(Date.now() - 1000) } });
    expect((await refresh(val(a, 'refresh_token'))).status).toBe(401);
    await prisma.session.delete({ where: { id: sid } });
    expect((await refresh(val(a, 'refresh_token'))).status).toBe(401);
    const unknown = await signRefreshToken({ userId, email, role: 'tech', sid: crypto.randomUUID() });
    expect((await refresh(unknown)).status).toBe(401);
    const junk = await signRefreshToken({ userId, email, role: 'tech', sid: 'not-a-uuid' });
    expect((await refresh(junk)).status).toBe(401);
  });

  it('a token with no sid (signed in before this change) is 401 and lands on /login cleanly, no cookies, no loop', async () => {
    const a = await login(email);
    const noSid = await signRefreshToken({ userId, email, role: 'tech' });
    await prisma.session.update({ where: { id: (await verifyRefreshToken(val(a, 'refresh_token'))).sid! }, data: { refresh_token: noSid } });
    expect((await refresh(noSid)).status).toBe(401);
    const c = await cont(noSid, '/tasks');
    expect(c.status).toBe(307);
    expect(c.headers.get('location')).toBe('/login');
    expect(c.headers.getSetCookie()).toEqual([]);
    // the login page is not behind the continue bounce: signing in works straight away
    expect((await login(email)).status).toBe(200);
  });

  it('two devices for one user are independent; signing out on B ends both (by design)', async () => {
    const a = await login(email);
    const b = await login(email); // B signing in does not sign A out
    expect((await refresh(val(a, 'refresh_token'))).status).toBe(200);
    expect((await refresh(val(b, 'refresh_token'))).status).toBe(200);
    await logout(val(b, 'refresh_token'));
    expect((await refresh(val(a, 'refresh_token'))).status).toBe(401);
    expect((await refresh(val(b, 'refresh_token'))).status).toBe(401);
  });

  it('two tabs refreshing at once with the same token both stay signed in, and the token keeps working', async () => {
    const a = await login(email);
    const t = val(a, 'refresh_token');
    const [r1, r2] = await Promise.all([cont(t, '/x'), cont(t, '/x')]);
    expect(r1.headers.get('location')).toBe('/x');
    expect(r2.headers.get('location')).toBe('/x');
    expect(await prisma.session.count({ where: { user_id: userId } })).toBe(1);
    expect((await refresh(val(r1, 'refresh_token'))).status).toBe(200);
    expect((await refresh(val(r2, 'refresh_token'))).status).toBe(200);
    expect((await refresh(t)).status).toBe(200);
  });

  it('default 7 days and ticked 30 days both slide per device and cannot be upgraded', async () => {
    const d = await login(email);
    const k = await login(email, { keep_signed_in: true });
    await prisma.session.updateMany({ where: { user_id: userId }, data: { expires_at: new Date(Date.now() + 3600_000) } });
    const d2 = await refresh(val(d, 'refresh_token'));
    const k2 = await refresh(val(k, 'refresh_token'));
    expect(maxAge(d2, 'refresh_token')).toBe(7 * DAY);
    expect(maxAge(k2, 'refresh_token')).toBe(30 * DAY);
    const dRow = (await rowOf(val(d2, 'refresh_token')))!;
    const kRow = (await rowOf(val(k2, 'refresh_token')))!;
    expect(dRow.expires_at.getTime() - Date.now()).toBeGreaterThan(6.9 * DAY * 1000);
    expect(dRow.expires_at.getTime() - Date.now()).toBeLessThan(7.1 * DAY * 1000);
    expect(kRow.expires_at.getTime() - Date.now()).toBeGreaterThan(29.9 * DAY * 1000);
    expect((await verifyRefreshToken(val(d2, 'refresh_token'))).keep).toBeUndefined();
    const d3 = await refresh(val(d2, 'refresh_token'));
    expect(maxAge(d3, 'refresh_token')).toBe(7 * DAY);
    expect((await rowOf(val(d3, 'refresh_token')))!.expires_at.getTime() - Date.now()).toBeLessThan(7.1 * DAY * 1000);
  });

  it('the silent-refresh route works for both kinds, keeps the sid and sends no-store', async () => {
    for (const extra of [{}, { keep_signed_in: true }]) {
      const a = await login(email, extra);
      const sid = (await verifyRefreshToken(val(a, 'refresh_token'))).sid;
      const c = await cont(val(a, 'refresh_token'), '/tasks?x=1');
      expect(c.status).toBe(307);
      expect(c.headers.get('location')).toBe('/tasks?x=1');
      expect(c.headers.get('cache-control')).toBe('no-store');
      expect(maxAge(c, 'refresh_token')).toBe(('keep_signed_in' in extra ? 30 : 7) * DAY);
      expect((await verifyRefreshToken(val(c, 'refresh_token'))).sid).toBe(sid);
    }
  });

  it('role comes from the database row on refresh, not the old token', async () => {
    const a = await login(email);
    await prisma.user.update({ where: { id: userId }, data: { role: 'pm' } });
    const r = await refresh(val(a, 'refresh_token'));
    expect((await verifyAccessToken(val(r, 'access_token'))).role).toBe('pm');
    await prisma.user.update({ where: { id: userId }, data: { role: 'tech' } });
  });

  it('the access token lives 15 minutes, the same as its cookie', async () => {
    const a = await login(email);
    const p = await verifyAccessToken(val(a, 'access_token'));
    expect(p.exp! - p.iat!).toBe(900);
    expect(maxAge(a, 'access_token')).toBe(900);
  });

  it('keep me signed in is accepted for every role that can sign in, including designers', async () => {
    const r = await login(email2, { keep_signed_in: true });
    expect(r.status).toBe(200);
    expect(maxAge(r, 'refresh_token')).toBe(30 * DAY);
  });
});
