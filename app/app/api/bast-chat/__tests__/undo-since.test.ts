// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { OTHER_SESSION, OWNER_ID, OWNER_KEY, OWNER_SESSION, SETTINGS, req } from './harness';

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ role: 'admin', is_active: true })) } } }));
vi.mock('@/lib/bast-chat/settings', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/settings')>()),
  getSettings: vi.fn(async () => h.settings),
}));
vi.mock('@/lib/bast-chat/actions', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/actions')>()),
  undoSince: vi.fn(async () => ({ undone: [{ id: 'a', summary: 'Renamed A.' }], proposed: [], stopped: null, left: [], waiting: [] })),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { undoSince } from '@/lib/bast-chat/actions';
import { POST } from '../actions/undo-since/route';

const PATH = '/api/bast-chat/actions/undo-since';
const call = (body: unknown, headers?: Record<string, string>) => POST(req('POST', PATH, body, headers) as never);

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = { ...SETTINGS, handoff_user_ids: [] };
  vi.mocked(requireAuth).mockResolvedValue(OWNER_SESSION);
});

describe('POST /api/bast-chat/actions/undo-since', () => {
  it('runs for the owner session with the time given, and returns the report, no-store', async () => {
    const res = await call({ since: '2026-11-10T09:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ undone: [{ id: 'a', summary: 'Renamed A.' }], proposed: [], stopped: null, left: [], waiting: [] });
    expect(undoSince).toHaveBeenCalledWith(OWNER_ID, { since: '2026-11-10T09:00:00.000Z' });
  });
  it('takes an action id instead', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect((await call({ from_action_id: id })).status).toBe(200);
    expect(undoSince).toHaveBeenCalledWith(OWNER_ID, { from_action_id: id });
  });
  it('400 for neither, both, an unknown field or a bad time, and nothing runs', async () => {
    for (const body of [{}, { since: '2026-11-10T09:00:00.000Z', from_action_id: '22222222-2222-4222-8222-222222222222' }, { since: 'yesterday' }, { since: '2026-11-10T09:00:00.000Z', all: true }]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(Object.keys(await res.json())).toEqual(['error']);
    }
    expect(undoSince).not.toHaveBeenCalled();
  });
  it('401 signed out, 403 for an API key (even the owner\'s), 403 for another admin, 403 when the chat is off', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError('Authentication required', 401));
    expect((await call({ since: '2026-11-10T09:00:00.000Z' })).status).toBe(401);
    vi.mocked(requireAuth).mockResolvedValueOnce(OWNER_KEY);
    expect((await call({ since: '2026-11-10T09:00:00.000Z' })).status).toBe(403);
    vi.mocked(requireAuth).mockResolvedValueOnce(OTHER_SESSION);
    expect((await call({ since: '2026-11-10T09:00:00.000Z' })).status).toBe(403);
    h.settings = { ...SETTINGS, enabled: false, handoff_user_ids: [] };
    expect((await call({ since: '2026-11-10T09:00:00.000Z' })).status).toBe(403);
    expect(undoSince).not.toHaveBeenCalled();
  });
  it('refuses a cross-site request and a body that is not JSON', async () => {
    expect((await call({ since: '2026-11-10T09:00:00.000Z' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('since=now', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect(undoSince).not.toHaveBeenCalled();
  });
});
