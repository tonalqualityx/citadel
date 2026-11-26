// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { applyWatch, resolveRuleItem, ruleBodySchema, saveNotEmergencyRule, watchBodySchema } from '../store';

const mocks = vi.hoisted(() => ({
  ownerOnHome: vi.fn(),
  trackWatch: vi.fn(),
  claimLines: vi.fn(),
  loadWatchItems: vi.fn(),
  loadEmergencySlack: vi.fn(),
}));
vi.mock('../../keeper/run', async (orig) => ({ ...(await orig<object>()), ownerOnHome: mocks.ownerOnHome }));
vi.mock('../slack-store', async (orig) => ({
  ...(await orig<object>()),
  trackWatch: mocks.trackWatch,
  claimLines: mocks.claimLines,
  loadWatchItems: mocks.loadWatchItems,
  loadEmergencySlack: mocks.loadEmergencySlack,
}));

const TASK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-11T15:00:00Z');

// A db that fails the test on any call: a task must be refused before anything is read or written.
const trap = new Proxy({}, { get: () => { throw new Error('db touched'); } }) as unknown as PrismaClient;

describe('rule store without a database', () => {
  it('a task item is refused before any read or write', async () => {
    await expect(resolveRuleItem(trap, `task:${TASK}`)).rejects.toMatchObject({ statusCode: 400, message: 'A security flag is never turned into a rule.' });
    await expect(saveNotEmergencyRule(trap, 'u', { item_key: `task:${TASK}`, scope: 'sender' }, NOW)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('other item kinds are 400 too', async () => {
    for (const k of [`wait:${TASK}`, 'session:abc', 'review:none', 'thread:a@b.com:t', 'site:not-a-uuid', 'junk', 'x:y']) {
      await expect(resolveRuleItem(trap, k)).rejects.toMatchObject({ statusCode: 400 });
    }
  });
  it('the body schema is strict and caps the reason at 300', () => {
    expect(ruleBodySchema.safeParse({ item_key: 'crisis:x', scope: 'sender', reason: 'x'.repeat(300) }).success).toBe(true);
    expect(ruleBodySchema.safeParse({ item_key: 'crisis:x', scope: 'sender', reason: 'x'.repeat(301) }).success).toBe(false);
    expect(ruleBodySchema.safeParse({ item_key: 'crisis:x', scope: 'sender', user_id: 'u' }).success).toBe(false);
    expect(ruleBodySchema.safeParse({ item_key: 'crisis:x', scope: 'anyone' }).success).toBe(false);
  });
});

describe('watch body schema', () => {
  it('defaults kuma to null and checks to none, and refuses extra fields', () => {
    expect(watchBodySchema.parse({})).toEqual({ kuma: null, checks: [] });
    expect(watchBodySchema.safeParse({ user_id: 'u' }).success).toBe(false);
    expect(watchBodySchema.safeParse({ kuma: [{ monitor: 'm', domain: 'a.com', started: '2026-11-11T14:00:00Z', extra: 1 }] }).success).toBe(false);
  });
});

describe('applyWatch open_rows (crisis clearing)', () => {
  const ROW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ROW_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const watchFindMany = vi.fn();
  const db = {
    site: { findMany: vi.fn(async () => []) },
    homeKeeperSettings: { findUnique: vi.fn(async () => null) },
    homeEmergencyWatch: { findMany: watchFindMany },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as PrismaClient;
  const post = (caps?: string[]) => applyWatch(db, 'owner', watchBodySchema.parse({ kuma: null, checks: [], ...(caps ? { caps } : {}) }), NOW);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ownerOnHome.mockResolvedValue({ ok: true, timezone: 'America/New_York' });
    mocks.loadWatchItems.mockResolvedValue([]);
    mocks.loadEmergencySlack.mockResolvedValue(true);
    mocks.claimLines.mockResolvedValue([]);
    watchFindMany.mockResolvedValue([{ id: ROW_A }, { id: ROW_B }]);
  });

  it('lists the owner\'s open rows (cleared_at null), after tracking, only with the clear cap', async () => {
    const res = await post(['slack', 'clear']);
    expect(res.open_rows).toEqual([ROW_A, ROW_B]);
    expect(watchFindMany).toHaveBeenCalledWith({ where: { user_id: 'owner', cleared_at: null }, select: { id: true } });
    expect(mocks.trackWatch.mock.invocationCallOrder[0]).toBeLessThan(watchFindMany.mock.invocationCallOrder[0]);
  });
  it('an empty list is still present when nothing is open', async () => {
    watchFindMany.mockResolvedValue([]);
    expect((await post(['clear'])).open_rows).toEqual([]);
  });
  it('is absent without the clear cap (older script, or other caps), and the table is not even read', async () => {
    for (const caps of [undefined, ['slack'], ['slack', 'scan']]) {
      const res = await post(caps);
      expect('open_rows' in res).toBe(false);
    }
    expect(watchFindMany).not.toHaveBeenCalled();
  });
  it('is absent when home is off, even with the clear cap', async () => {
    mocks.ownerOnHome.mockResolvedValue({ ok: false, timezone: 'UTC' });
    const res = await post(['clear']);
    expect(res.skipped).toBe('home_off');
    expect('open_rows' in res).toBe(false);
    expect(watchFindMany).not.toHaveBeenCalled();
  });
});
