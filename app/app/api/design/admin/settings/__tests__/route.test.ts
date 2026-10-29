import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET, PATCH } from '../route';
import { jsonRequest, signIn, anonymous, ADMIN_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    designPortalSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    designWorkerState: { findUnique: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const settingsFind = prisma.designPortalSettings.findUnique as Mock;
const upsert = prisma.designPortalSettings.upsert as Mock;
const patch = (body: unknown, headers?: Record<string, string>) => PATCH(jsonRequest('/api/design/admin/settings', 'PATCH', body, headers));
const dec = (n: number) => ({ toString: () => String(n) });
const row = (over: Record<string, unknown> = {}) => ({
  id: 1, enabled: true, owner_user_id: ADMIN_ID, designer_publish_mode: 'per_site', confirmation_ttl_minutes: 10, default_session_budget_usd: dec(25),
  designer_raise_cap_usd: dec(50), hard_session_cap_usd: dec(150), default_monthly_cap_usd: null, model: 'opus', effort: 'high', idle_close_minutes: 10,
  auto_timer_enabled: true, auto_timer_lapse_minutes: 5, auto_timer_billable: false, max_live_sessions: 4, updated_by_id: null, updated_at: new Date(), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  signIn(auth, userFind, 'admin');
  settingsFind.mockResolvedValue(row());
  upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => row(update));
  (prisma.designWorkerState.findUnique as Mock).mockResolvedValue({ last_heartbeat_at: new Date(), version: '1', sdk_version: '2', paused: false, pause_reason: null, configured_site_ids: [], site_main_roles: null, site_live_urls: null, live_sessions: 0 });
});

describe('GET /api/design/admin/settings', () => {
  it('returns settings (numbers, not Decimals) and the worker state', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.settings).toMatchObject({ enabled: true, default_session_budget_usd: 25, hard_session_cap_usd: 150, designer_publish_mode: 'per_site', auto_timer_lapse_minutes: 5 });
    expect(json.worker_state).toMatchObject({ paused: false, configured_site_ids: [] });
  });
  it('before the row exists it answers the defaults with enabled false', async () => {
    settingsFind.mockResolvedValue(null);
    (prisma.designWorkerState.findUnique as Mock).mockResolvedValue(null);
    const json = await (await GET()).json();
    expect(json.settings).toMatchObject({ enabled: false, model: 'opus', default_session_budget_usd: 25 });
    expect(json.worker_state).toBeNull();
  });
  it('anonymous 401; designer, pm 403; API key 403', async () => {
    anonymous(auth);
    expect((await GET()).status).toBe(401);
    for (const role of ['designer', 'pm'] as const) { signIn(auth, userFind, role); expect((await GET()).status).toBe(403); }
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await GET()).status).toBe(403);
  });
});

describe('PATCH /api/design/admin/settings', () => {
  it('updates fields and stamps updated_by_id', async () => {
    const res = await patch({ enabled: false, designer_publish_mode: 'pre_launch_only', auto_timer_lapse_minutes: 12, auto_timer_billable: true });
    expect(res.status).toBe(200);
    expect(upsert.mock.calls[0][0].update).toEqual({ enabled: false, designer_publish_mode: 'pre_launch_only', auto_timer_lapse_minutes: 12, auto_timer_billable: true, updated_by_id: ADMIN_ID });
    expect((await res.json()).settings.designer_publish_mode).toBe('pre_launch_only');
  });
  it('refuses a Fable model in any casing', async () => {
    for (const m of ['fable', 'Claude-Fable-5', 'FABLE-x']) expect((await patch({ model: m })).status, m).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
  it('W8.1 H5: the model is an allowlist; aliases that resolve elsewhere (best, default) and unknown names are 400', async () => {
    for (const m of ['best', 'fable', 'mythos', 'default', 'BEST', 'claude-fable-5-1', 'opusplan', 'opus[1m]', 'gpt-5', 'claude-opus', 'claude-mythos-1'])
      expect((await patch({ model: m })).status, m).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
  it('W8.1 H5: opus, sonnet, haiku (any casing) and dated ids are 200', async () => {
    for (const m of ['opus', 'sonnet', 'haiku', 'Opus', 'claude-opus-5-5', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5', 'claude-haiku-4-5'])
      expect((await patch({ model: m })).status, m).toBe(200);
  });
  it('designer_publish_mode must be per_site | pre_launch_only | off', async () => {
    expect((await patch({ designer_publish_mode: 'always' })).status).toBe(400);
    for (const m of ['per_site', 'pre_launch_only', 'off']) expect((await patch({ designer_publish_mode: m })).status).toBe(200);
  });
  it('timer settings ranges: lapse 1 to 60', async () => {
    for (const v of [0, 61, 1.5, -1]) expect((await patch({ auto_timer_lapse_minutes: v })).status, String(v)).toBe(400);
    for (const v of [1, 60]) expect((await patch({ auto_timer_lapse_minutes: v })).status, String(v)).toBe(200);
  });
  it('zod: unknown field, empty body, wrong types, caps out of range are 400', async () => {
    for (const b of [{}, { nope: 1 }, { enabled: 'yes' }, { max_live_sessions: 0 }, { default_session_budget_usd: -1 }, { effort: 'extreme' }, { owner_user_id: 'x' }, { idle_close_minutes: 0 }]) {
      expect((await patch(b)).status, JSON.stringify(b)).toBe(400);
    }
  });
  it('the raise cap cannot exceed the hard cap (merged with stored values)', async () => {
    expect((await patch({ designer_raise_cap_usd: 200 })).status).toBe(400);
    expect((await patch({ hard_session_cap_usd: 40 })).status).toBe(400);
    expect((await patch({ designer_raise_cap_usd: 40, hard_session_cap_usd: 300 })).status).toBe(200);
  });
  it('owner_user_id must be an active user', async () => {
    userFind.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === ADMIN_ID ? { id: ADMIN_ID, role: 'admin', is_active: true } : null));
    expect((await patch({ owner_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })).status).toBe(400);
    expect((await patch({ owner_user_id: ADMIN_ID })).status).toBe(200);
    expect((await patch({ owner_user_id: null })).status).toBe(200);
  });
  it('413 over the cap; cross-site 403; anonymous 401; non-admin and API key 403', async () => {
    expect((await patch(JSON.stringify({ model: 'opus', pad: 'x'.repeat(9000) }))).status).toBe(413);
    expect((await patch({ enabled: true }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    anonymous(auth);
    expect((await patch({ enabled: true })).status).toBe(401);
    for (const role of ['designer', 'pm', 'tech'] as const) { signIn(auth, userFind, role); expect((await patch({ enabled: true })).status).toBe(403); }
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await patch({ enabled: true })).status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});
