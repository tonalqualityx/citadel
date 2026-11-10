import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { ZodError } from 'zod';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../settings';
import { OFFLINE_AFTER_SECONDS, recordHeartbeat, workerStatus } from '../heartbeat';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const mk = (user: unknown) => ({
  bastChatSettings: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
  user: { findUnique: vi.fn().mockResolvedValue(user) },
}) as never;

describe('settings', () => {
  it('defaults to off with no owner', async () => {
    expect(await getSettings(mk(null))).toEqual(DEFAULT_SETTINGS);
  });
  it.each(['opus', 'fable', 'best', 'default', 'claude-opus-4-1'])('refuses model %s', async (m) => {
    await expect(updateSettings({ model: m }, OWNER, mk({ role: 'admin', is_active: true }))).rejects.toBeInstanceOf(ZodError);
  });
  it('accepts sonnet, haiku and dated ids, and refuses unknown keys', async () => {
    const db = mk({ role: 'admin', is_active: true });
    await updateSettings({ model: 'haiku', daily_turn_cap: 50 }, OWNER, db);
    await updateSettings({ model: 'claude-sonnet-4-5-20250929' }, OWNER, db);
    await expect(updateSettings({ retention_days: 30 }, OWNER, db)).rejects.toBeInstanceOf(ZodError);
  });
  it('the owner must be an active admin', async () => {
    await expect(updateSettings({ owner_user_id: OWNER }, OWNER, mk({ role: 'pm', is_active: true }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateSettings({ owner_user_id: OWNER }, OWNER, mk(null))).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('heartbeat', () => {
  const body = { version: '1', sdk_version: '2', paused: true, pause_reason: 'fleet — pause', live_conversations: [{ id: '11111111-1111-4111-8111-111111111111', alive: true }], isolation: { ok: true }, auth_state: 'token' as const };
  it('writes the worker state (cleaned reason, live count) and deletes nothing', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { bastChatWorkerState: { upsert }, bastChatSettings: { findUnique: vi.fn().mockResolvedValue(null) }, bastChatEvent: { findMany: vi.fn().mockResolvedValue([]) }, bastChatConversation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as never;
    const now = new Date();
    expect(await recordHeartbeat(body, now, db)).toEqual({ ok: true });
    const data = upsert.mock.calls[0][0].update;
    expect(data).toMatchObject({ paused: true, pause_reason: 'fleet, pause', live_conversations: 1, auth_state: 'token', isolation_ok_at: now });
  });
  it('offline after 45 seconds', async () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const at = (s: number) => ({ bastChatWorkerState: { findUnique: vi.fn().mockResolvedValue({ last_heartbeat_at: new Date(now.getTime() - s * 1000), paused: false, pause_reason: null, auth_state: 'login', isolation_ok_at: now, live_conversations: 0 }) } }) as never;
    expect((await workerStatus(now, at(OFFLINE_AFTER_SECONDS))).online).toBe(true);
    expect((await workerStatus(now, at(60))).online).toBe(false);
    expect((await workerStatus(now, { bastChatWorkerState: { findUnique: vi.fn().mockResolvedValue(null) } } as never)).online).toBe(false);
  });
});
