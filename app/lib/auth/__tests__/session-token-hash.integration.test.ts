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
import { verifyRefreshToken, hashRefreshToken } from '@/lib/auth/jwt';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as continueRoute } from '@/app/api/auth/continue/route';
import { hashSessionTokens } from '@/scripts/hash-session-tokens';

let ipn = 1;
const login = (email: string, extra: Record<string, unknown> = {}) =>
  loginRoute(
    new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.8.${Math.floor(ipn / 250)}.${(ipn++ % 250) + 1}` },
      body: JSON.stringify({ email, password: 'pw-test-123', ...extra }),
    })
  );
const val = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))!.split(';')[0].slice(name.length + 1);
const HEX64 = /^[0-9a-f]{64}$/;

describe.skipIf(!SCRATCH)('session table stores a hash of the refresh token (real database)', () => {
  const tag = crypto.randomBytes(3).toString('hex');
  // 225 characters: 64-char local part, then a domain of three 63/62-char labels.
  const longEmail = `${'l'.repeat(58)}${tag}@${'d'.repeat(63)}.${'e'.repeat(63)}.${'f'.repeat(27)}.test`;
  const shortEmail = `hash-${tag}@example.test`;
  let longId = '';
  let shortId = '';
  const extraIds: string[] = [];

  beforeAll(async () => {
    expect(longEmail.length).toBe(225);
    const hash = await bcrypt.hash('pw-test-123', 4);
    longId = (await prisma.user.create({ data: { email: longEmail, password_hash: hash, name: 'Long', role: 'tech' } })).id;
    shortId = (await prisma.user.create({ data: { email: shortEmail, password_hash: hash, name: 'Short', role: 'tech' } })).id;
  });
  afterAll(async () => {
    await prisma.session.deleteMany({ where: { user_id: { in: [longId, shortId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [longId, shortId] } } });
  });
  beforeEach(async () => {
    mocks.jar = {};
    await prisma.session.deleteMany({ where: { user_id: { in: [longId, shortId] } } });
  });

  it.each([
    ['unticked', {}],
    ['ticked', { keep_signed_in: true }],
  ])('sign-in with a 225-character email succeeds (%s), and the row holds a 64-hex hash, not the token', async (_n, extra) => {
    const res = await login(longEmail, extra);
    expect(res.status).toBe(200);
    const token = val(res, 'refresh_token');
    const row = await prisma.session.findUnique({ where: { id: (await verifyRefreshToken(token)).sid! } });
    expect(row!.refresh_token).toMatch(HEX64);
    expect(row!.refresh_token).not.toBe(token);
    expect(row!.refresh_token).toBe(hashRefreshToken(token));
  });

  it('the stored value changes on refresh (still a hash) and the refreshed token still works', async () => {
    const res = await login(shortEmail);
    const t1 = val(res, 'refresh_token');
    const sid = (await verifyRefreshToken(t1)).sid!;
    const c = await continueRoute(new NextRequest('http://localhost/api/auth/continue?to=/x', { headers: { cookie: `refresh_token=${t1}` } }));
    const t2 = val(c, 'refresh_token');
    const row = await prisma.session.findUnique({ where: { id: sid } });
    expect(row!.refresh_token).toBe(hashRefreshToken(t2));
    expect(row!.refresh_token).toMatch(HEX64);
  });

  it('one-off script: dry run writes nothing; apply hashes raw values only, leaves hashes alone, and is idempotent', async () => {
    const rawA = `raw-a-${tag}.${'x'.repeat(300)}`;
    const rawB = `raw-b-${tag}`;
    const done = hashRefreshToken(`already-${tag}`);
    const exp = new Date(Date.now() + 3600_000);
    const a = await prisma.session.create({ data: { user_id: shortId, refresh_token: rawA, expires_at: exp } });
    const b = await prisma.session.create({ data: { user_id: shortId, refresh_token: rawB, expires_at: exp } });
    const c = await prisma.session.create({ data: { user_id: shortId, refresh_token: done, expires_at: exp } });
    extraIds.push(a.id, b.id, c.id);
    const get = async (id: string) => (await prisma.session.findUniqueOrThrow({ where: { id } })).refresh_token;

    const dry = await hashSessionTokens(false);
    expect(dry.found).toBeGreaterThanOrEqual(2);
    expect(dry.changed).toBe(0);
    expect(await get(a.id)).toBe(rawA);
    expect(await get(b.id)).toBe(rawB);

    const applied = await hashSessionTokens(true);
    expect(applied.changed).toBeGreaterThanOrEqual(2);
    expect(await get(a.id)).toBe(hashRefreshToken(rawA));
    expect(await get(b.id)).toBe(hashRefreshToken(rawB));
    expect(await get(c.id)).toBe(done);

    const again = await hashSessionTokens(true);
    expect(again.found).toBe(0);
    expect(await get(a.id)).toBe(hashRefreshToken(rawA));
  });
});
