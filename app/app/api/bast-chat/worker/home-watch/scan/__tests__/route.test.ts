// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, OWNER_ID, WORKER, req } from '../../../../__tests__/harness';

const h = vi.hoisted(() => ({ ownerId: '3ecfb7be-0000-4000-8000-000000000001' as string | null, on: true }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __marker: 'prisma' } }));
vi.mock('@/lib/bast-chat/route-helpers', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/route-helpers')>()),
  workerOwnerId: vi.fn(async () => {
    if (!h.ownerId) {
      const { ApiError } = await import('@/lib/api/errors');
      throw new ApiError('Chat not found', 404, 'not_found');
    }
    return h.ownerId;
  }),
}));
vi.mock('@/lib/home/keeper/run', () => ({ ownerOnHome: vi.fn(async () => ({ ok: h.on, timezone: 'America/New_York' })) }));
vi.mock('@/lib/home/emergency/scan-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/home/emergency/scan-store')>()),
  recordScan: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { recordScan } from '@/lib/home/emergency/scan-store';
import { POST } from '../route';

const PATH = '/api/bast-chat/worker/home-watch/scan';
const KEY = 'site:11111111-1111-4111-8111-111111111111';
const good = { key: KEY, summary: 'the home page answers. Nothing new found from outside.', findings: { home_status: 200, link_hosts: ['a.com'] } };

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  h.on = true;
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(recordScan).mockResolvedValue({ recorded: true });
});

describe('home-watch scan route', () => {
  it('401 signed out, 403 for everyone but the chat worker, 404 with no owner; nothing runs', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await POST(req('POST', PATH, good) as never)).status).toBe(401);
    for (const [, auth] of NOT_WORKERS) {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      expect((await POST(req('POST', PATH, good) as never)).status).toBe(403);
    }
    vi.mocked(requireAuth).mockResolvedValue(WORKER);
    h.ownerId = null;
    expect((await POST(req('POST', PATH, good) as never)).status).toBe(404);
    expect(recordScan).not.toHaveBeenCalled();
  });

  it('stores the result for the configured owner, no-store', async () => {
    const res = await POST(req('POST', PATH, good) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ recorded: true });
    const [, owner, body, , tz] = vi.mocked(recordScan).mock.calls[0];
    expect(owner).toBe(OWNER_ID);
    expect(body.key).toBe(KEY);
    expect(tz).toBe('America/New_York');
  });

  it('answers recorded false for an unrequested key as the store says', async () => {
    vi.mocked(recordScan).mockResolvedValue({ recorded: false });
    expect(await (await POST(req('POST', PATH, good) as never)).json()).toEqual({ recorded: false });
  });

  it('does nothing when the owner is off the home view', async () => {
    h.on = false;
    expect(await (await POST(req('POST', PATH, good) as never)).json()).toEqual({ recorded: false, skipped: 'home_off' });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it('400 for a bad summary, an unknown field, a user id, a missing field or non-JSON; nothing runs', async () => {
    const dash = String.fromCharCode(0x2014);
    const bads: unknown[] = [
      { ...good, summary: '' },
      { ...good, summary: 'x'.repeat(501) },
      { ...good, summary: 'two\n\nparagraphs' },
      { ...good, summary: `a ${dash} b` },
      { ...good, summary: 'the most important priority is here' },
      { ...good, summary: 'it is overdue' },
      { ...good, summary: 'see https://evil.example/login' },
      { ...good, summary: 'see evil.example/login now' },
      { ...good, extra: 1 },
      { ...good, user_id: OWNER_ID },
      { key: KEY, summary: 'ok' },
      { ...good, findings: 'text' },
      { ...good, findings: { big: 'y'.repeat(9000) } },
    ];
    for (const b of bads) expect((await POST(req('POST', PATH, b) as never)).status, JSON.stringify(b).slice(0, 80)).toBe(400);
    expect((await POST(req('POST', PATH, 'not json') as never)).status).toBe(400);
    expect(recordScan).not.toHaveBeenCalled();
  });

  it('accepts a bare hostname and a hyphen', async () => {
    const ok = { ...good, summary: '2 links to outside sites are new since the last check: ki-system.org, other.example.' };
    expect((await POST(req('POST', PATH, ok) as never)).status).toBe(200);
  });

  it('413 for a body over 16 KB', async () => {
    const res = await POST(req('POST', PATH, { ...good, findings: { a: 'z'.repeat(17000) } }) as never);
    expect(res.status).toBe(413);
  });
});
