import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { ApiError } from '@/lib/api/errors';
import { DEFAULT_SETTINGS } from '../settings';
import { assertCanSend, assertWriteAllowed, bumpUsage, reserveWrite, COST_CAP_TEXT, easternDay, getUsage, MESSAGE_CAP_TEXT, usageLeft, WRITE_CAP_TEXT } from '../usage';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const row = (turns: number, writes: number, cost: number) => ({ turns, writes, cost_usd: { toString: () => String(cost) } });
const db = (r: ReturnType<typeof row> | null) => ({ bastChatUsage: { findUnique: vi.fn().mockResolvedValue(r), upsert: vi.fn().mockResolvedValue({}) } }) as never;
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ApiError;
  }
};

describe('usage and caps', () => {
  it('easternDay uses the Eastern calendar date', () => {
    expect(easternDay(new Date('2026-11-10T03:30:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(easternDay(new Date('2026-11-10T12:00:00Z')).toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });
  it('no row means zero', async () => {
    expect(await getUsage(OWNER, new Date(), db(null))).toEqual({ turns: 0, writes: 0, cost_usd: 0 });
  });
  it('the 101st message is a 429 with a plain line', async () => {
    await expect(assertCanSend(OWNER, DEFAULT_SETTINGS, new Date(), db(row(99, 0, 0)))).resolves.toBeUndefined();
    const e = await refusal(assertCanSend(OWNER, DEFAULT_SETTINGS, new Date(), db(row(100, 0, 0))));
    expect(e?.statusCode).toBe(429);
    expect(e?.message).toBe(MESSAGE_CAP_TEXT);
  });
  it('the cost cap refuses with its own line', async () => {
    const e = await refusal(assertCanSend(OWNER, DEFAULT_SETTINGS, new Date(), db(row(3, 0, 8))));
    expect(e?.statusCode).toBe(429);
    expect(e?.message).toBe(COST_CAP_TEXT);
  });
  it('the 26th task change is refused', async () => {
    await expect(assertWriteAllowed(OWNER, DEFAULT_SETTINGS, new Date(), db(row(0, 24, 0)))).resolves.toBeUndefined();
    const e = await refusal(assertWriteAllowed(OWNER, DEFAULT_SETTINGS, new Date(), db(row(0, 25, 0))));
    expect(e?.statusCode).toBe(429);
    expect(e?.message).toBe(WRITE_CAP_TEXT);
  });
  it('usageLeft never goes below zero', () => {
    expect(usageLeft(DEFAULT_SETTINGS, { turns: 150, writes: 30, cost_usd: 9 })).toEqual({ turns_left: 0, writes_left: 0, usd_left: 0 });
    expect(usageLeft(DEFAULT_SETTINGS, { turns: 1, writes: 2, cost_usd: 0.5 })).toEqual({ turns_left: 99, writes_left: 23, usd_left: 7.5 });
  });
  it('every cap sentence is plain: no dash, no banned words', () => {
    for (const s of [MESSAGE_CAP_TEXT, WRITE_CAP_TEXT, COST_CAP_TEXT]) {
      expect(s).not.toMatch(/[–—]/);
      expect(s.toLowerCase()).not.toMatch(/priority|overdue/);
    }
  });
  it('bumpUsage upserts with increments on the Eastern day', async () => {
    const d = db(null);
    await bumpUsage(OWNER, { turns: 1 }, new Date('2026-11-10T12:00:00Z'), d);
    const call = (d as unknown as { bastChatUsage: { upsert: { mock: { calls: unknown[][] } } } }).bastChatUsage.upsert.mock.calls[0][0] as { update: { turns: { increment: number } } };
    expect(call.update.turns).toEqual({ increment: 1 });
  });
  it('reserveWrite ensures the row, then takes one slot with one conditional update', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await reserveWrite(OWNER, 3, new Date('2026-11-10T12:00:00Z'), { bastChatUsage: { upsert, updateMany } } as never);
    expect(upsert.mock.calls[0][0].update).toEqual({});
    expect(updateMany).toHaveBeenCalledWith({
      where: { owner_id: OWNER, day: new Date('2026-11-10T00:00:00Z'), writes: { lt: 3 } },
      data: { writes: { increment: 1 } },
    });
  });
  it('reserveWrite throws the cap sentence as a 429 when no slot was taken', async () => {
    const d = { bastChatUsage: { upsert: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as never;
    const e = await refusal(reserveWrite(OWNER, 3, new Date(), d));
    expect(e?.statusCode).toBe(429);
    expect(e?.message).toBe(WRITE_CAP_TEXT);
  });
  it('reserveWrite carries on when a concurrent request created the row first, and rethrows other errors', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const dup = { bastChatUsage: { upsert: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })), updateMany } } as never;
    await expect(reserveWrite(OWNER, 3, new Date(), dup)).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledTimes(1);
    const bad = { bastChatUsage: { upsert: vi.fn().mockRejectedValue(new Error('db down')), updateMany } } as never;
    await expect(reserveWrite(OWNER, 3, new Date(), bad)).rejects.toThrow('db down');
  });
});
