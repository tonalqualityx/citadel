import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { recordKeyViolation, resetKeyViolationThrottle } from '../key-violations';

// Fleet item 6: the violation row really lands in the table, once per key/method/path per minute.
describe.skipIf(!SCRATCH)('api key violations (real database)', () => {
  const keyId = crypto.randomUUID();
  const rows = () => prisma.apiKeyViolation.findMany({ where: { api_key_id: keyId }, orderBy: { at: 'asc' } });
  const settle = async (n: number) => {
    for (let i = 0; i < 50; i++) {
      if ((await rows()).length >= n) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  beforeEach(() => resetKeyViolationThrottle());
  afterAll(async () => {
    await prisma.apiKeyViolation.deleteMany({ where: { api_key_id: keyId } });
    await prisma.$disconnect();
  });

  it('writes one row and throttles repeats', async () => {
    const v = { apiKeyId: keyId, keyPrefix: 'citadel_0123abcd', lane: 'qbo', method: 'GET', path: '/api/email-outbox', enforced: false };
    const t = Date.now();
    expect(recordKeyViolation(v, t)).toBe(true);
    expect(recordKeyViolation(v, t + 1000)).toBe(false);
    await settle(1);
    const got = await rows();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ key_prefix: 'citadel_0123abcd', lane: 'qbo', method: 'GET', path: '/api/email-outbox', enforced: false });
    expect(recordKeyViolation(v, t + 61_000)).toBe(true);
    await settle(2);
    expect(await rows()).toHaveLength(2);
  });

  it('clips an overlong path to the column width', async () => {
    const long = '/api/' + 'x'.repeat(400);
    recordKeyViolation({ apiKeyId: keyId, keyPrefix: 'citadel_0123abcd', lane: 'qbo', method: 'GET', path: long, enforced: true });
    await settle(3);
    const got = (await rows()).find((r) => r.enforced);
    expect(got?.path.length).toBe(300);
  });
});
