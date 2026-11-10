import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { requireChatOwner, requireChatOwnerForSettings } from '../access';
import { isChatWorker, requireChatWorker } from '../worker-kit';

const MIKE = '3ecfb7be-0000-4000-8000-000000000001';
const OTHER = '3ecfb7be-0000-4000-8000-000000000002';

function makeDb(settings: Record<string, unknown> | null, user: Record<string, unknown> | null) {
  return {
    bastChatSettings: { findUnique: vi.fn().mockResolvedValue(settings) },
    user: { findUnique: vi.fn().mockResolvedValue(user) },
  } as never;
}
const ON = { id: 1, enabled: true, owner_user_id: MIKE, model: 'sonnet', effort: 'low', turn_budget_usd: 0.4, daily_turn_cap: 100, daily_write_cap: 25, daily_cost_cap_usd: 8, stale_after_minutes: 120, idle_close_minutes: 10 };
const ADMIN = { role: 'admin', is_active: true };
const auth = (over: Record<string, unknown> = {}) => ({ userId: MIKE, email: 'mike@example.test', role: 'admin', via: 'session', ...over });

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof AuthError) return e.statusCode;
    throw e;
  }
}

beforeEach(() => {
  vi.mocked(requireAuth).mockReset();
});

describe('requireChatOwner (Mike side)', () => {
  it('passes for the owner on a session with the chat on', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never);
    const r = await requireChatOwner(makeDb(ON, ADMIN));
    expect(r.auth.userId).toBe(MIKE);
    expect(r.settings.enabled).toBe(true);
  });
  it('401 when signed out', async () => {
    vi.mocked(requireAuth).mockImplementation(async () => { throw new AuthError('Unauthorized', 401); });
    expect(await status(requireChatOwner(makeDb(ON, ADMIN)))).toBe(401);
  });
  it('403 for an API key, even the owner own key', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth({ via: 'api_key' }) as never);
    expect(await status(requireChatOwner(makeDb(ON, ADMIN)))).toBe(403);
  });
  it('403 for a bast-chat lane key on Mike routes', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth({ via: 'api_key', lane: 'bast-chat', laneEnforced: true }) as never);
    expect(await status(requireChatOwner(makeDb(ON, ADMIN)))).toBe(403);
  });
  it('403 for an admin who is not the owner', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth({ userId: OTHER }) as never);
    expect(await status(requireChatOwner(makeDb(ON, ADMIN)))).toBe(403);
  });
  it('403 when the chat is disabled', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never);
    expect(await status(requireChatOwner(makeDb({ ...ON, enabled: false }, ADMIN)))).toBe(403);
  });
  it('403 when there are no settings yet', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never);
    expect(await status(requireChatOwner(makeDb(null, ADMIN)))).toBe(403);
  });
  it('403 when the owner is no longer an admin in the database, whatever the token says', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth({ role: 'admin' }) as never);
    expect(await status(requireChatOwner(makeDb(ON, { role: 'pm', is_active: true })))).toBe(403);
  });
  it('403 when the owner is inactive or missing', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never);
    expect(await status(requireChatOwner(makeDb(ON, { role: 'admin', is_active: false })))).toBe(403);
    expect(await status(requireChatOwner(makeDb(ON, null)))).toBe(403);
  });
  it('the settings variant passes while the chat is off, but still only for the owner on a session', async () => {
    const off = makeDb({ ...ON, enabled: false }, ADMIN);
    vi.mocked(requireAuth).mockResolvedValue(auth() as never);
    expect(await status(requireChatOwnerForSettings(off))).toBe(200);
    vi.mocked(requireAuth).mockResolvedValue(auth({ userId: OTHER }) as never);
    expect(await status(requireChatOwnerForSettings(off))).toBe(403);
    vi.mocked(requireAuth).mockResolvedValue(auth({ via: 'api_key' }) as never);
    expect(await status(requireChatOwnerForSettings(off))).toBe(403);
  });
});

describe('requireChatWorker (daemon side)', () => {
  const key = (over: Record<string, unknown> = {}) => ({ userId: 'b', email: 'bast@becomeindelible.com', role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true, ...over });
  it('passes for an enforced bast-chat lane key', async () => {
    vi.mocked(requireAuth).mockResolvedValue(key() as never);
    expect(await status(requireChatWorker())).toBe(200);
  });
  it('401 when signed out', async () => {
    vi.mocked(requireAuth).mockImplementation(async () => { throw new AuthError('Unauthorized', 401); });
    expect(await status(requireChatWorker())).toBe(401);
  });
  it('403 for a session, even the owner', async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never);
    expect(await status(requireChatWorker())).toBe(403);
  });
  it('403 for a session that carries the lane field', async () => {
    vi.mocked(requireAuth).mockResolvedValue(key({ via: 'session' }) as never);
    expect(await status(requireChatWorker())).toBe(403);
  });
  it('403 for the wrong lane', async () => {
    vi.mocked(requireAuth).mockResolvedValue(key({ lane: 'design-worker' }) as never);
    expect(await status(requireChatWorker())).toBe(403);
    vi.mocked(requireAuth).mockResolvedValue(key({ lane: 'bast' }) as never);
    expect(await status(requireChatWorker())).toBe(403);
  });
  it('403 for a key with no lane', async () => {
    vi.mocked(requireAuth).mockResolvedValue(key({ lane: undefined, laneEnforced: undefined }) as never);
    expect(await status(requireChatWorker())).toBe(403);
  });
  it('403 when the lane is not enforced (missing or false)', async () => {
    vi.mocked(requireAuth).mockResolvedValue(key({ laneEnforced: false }) as never);
    expect(await status(requireChatWorker())).toBe(403);
    vi.mocked(requireAuth).mockResolvedValue(key({ laneEnforced: undefined }) as never);
    expect(await status(requireChatWorker())).toBe(403);
  });
  it('isChatWorker is false for null', () => {
    expect(isChatWorker(null)).toBe(false);
    expect(isChatWorker(undefined)).toBe(false);
  });
});
