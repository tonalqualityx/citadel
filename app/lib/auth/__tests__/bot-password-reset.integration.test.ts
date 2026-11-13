// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

const mail = vi.hoisted(() => ({ send: vi.fn(async () => undefined) }));
vi.mock('@/lib/services/email', async (orig) => ({ ...(await orig<object>()), sendPasswordResetEmail: mail.send }));

import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { DOX_USER_ID, DOX_SERVICE_EMAIL } from '@/lib/dox/identity';
import { POST as forgot } from '@/app/api/auth/forgot-password/route';
import { POST as reset } from '@/app/api/auth/reset-password/route';

let n = 1;
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost/api/auth/${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.8.${n++}.1` },
    body: JSON.stringify(body),
  });
const ask = async (email: string) => {
  const r = await forgot(post('forgot-password', { email }));
  return { status: r.status, body: await r.json() };
};
const tokenCount = (userId: string) => prisma.passwordResetToken.count({ where: { user_id: userId } });

describe.skipIf(!SCRATCH)('password reset refuses bot users (real database)', () => {
  const tag = crypto.randomBytes(3).toString('hex');
  const humanEmail = `reset-${tag}@example.test`;
  let humanId = '';
  let botTokenId = '';

  beforeAll(async () => {
    humanId = (await prisma.user.create({ data: { email: humanEmail, password_hash: await bcrypt.hash('pw-test-123', 4), name: 'Reset', role: 'tech' } })).id;
    expect(await prisma.user.findUnique({ where: { id: DOX_USER_ID } })).not.toBeNull(); // from the migration
  });
  afterAll(async () => {
    if (botTokenId) await prisma.passwordResetToken.deleteMany({ where: { id: botTokenId } });
    await prisma.passwordResetToken.deleteMany({ where: { user_id: humanId } });
    await prisma.session.deleteMany({ where: { user_id: humanId } });
    await prisma.user.delete({ where: { id: humanId } });
  });
  beforeEach(() => mail.send.mockClear());

  it('forgot-password: a bot user gets the unknown-email response, no token, no mail', async () => {
    const unknown = await ask(`nobody-${tag}@example.test`);
    const bot = await ask(DOX_SERVICE_EMAIL);
    expect(bot).toEqual(unknown);
    expect(bot.status).toBe(200);
    expect(await tokenCount(DOX_USER_ID)).toBe(0);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('forgot-password: a non-bot user still gets a token and a mail, with the same response', async () => {
    const unknown = await ask(`nobody2-${tag}@example.test`);
    mail.send.mockClear();
    const human = await ask(humanEmail);
    expect(human).toEqual(unknown);
    expect(await tokenCount(humanId)).toBe(1);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('reset-password: a token belonging to a bot user is refused like an unknown token, and the password is unchanged', async () => {
    const before = (await prisma.user.findUnique({ where: { id: DOX_USER_ID } }))!.password_hash;
    const tok = await prisma.passwordResetToken.create({ data: { user_id: DOX_USER_ID, token: `bot-${tag}`, expires_at: new Date(Date.now() + 3600_000) } });
    botTokenId = tok.id;
    const unknown = await reset(post('reset-password', { token: `nope-${tag}`, password: 'longenough1' }));
    const bot = await reset(post('reset-password', { token: `bot-${tag}`, password: 'longenough1' }));
    expect(bot.status).toBe(unknown.status);
    expect(await bot.json()).toEqual(await unknown.json());
    expect((await prisma.user.findUnique({ where: { id: DOX_USER_ID } }))!.password_hash).toBe(before);
    expect((await prisma.passwordResetToken.findUnique({ where: { id: tok.id } }))!.used_at).toBeNull();
  });

  it('reset-password: a non-bot token still works', async () => {
    const t = (await prisma.passwordResetToken.findFirst({ where: { user_id: humanId } }))!;
    const res = await reset(post('reset-password', { token: t.token, password: 'longenough1' }));
    expect(res.status).toBe(200);
    const after = (await prisma.user.findUnique({ where: { id: humanId } }))!.password_hash;
    expect(await bcrypt.compare('longenough1', after)).toBe(true);
  });
});
