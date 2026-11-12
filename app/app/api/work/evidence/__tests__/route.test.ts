import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/work/evidence', async (orig) => ({ ...(await orig<typeof import('@/lib/work/evidence')>()), recordEvidence: vi.fn(async () => ({ written: 1, duplicates: 0, unattached: 0 })) }));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { recordEvidence } from '@/lib/work/evidence';

const T = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const item = { kind: 'send', ref: 'o1', at: '2026-11-04T15:00:00.000Z', line: 'Bast sent it.', source: 'courier', target_key: `task:${T}` };
const req = (body: unknown) => new NextRequest('http://localhost:3000/api/work/evidence', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const lane = (l: string) => ({ userId: 'bast', role: 'pm', email: 'b@x.test', via: 'api_key', apiKeyId: 'k', lane: l });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(lane('courier') as never);
});

describe('POST /api/work/evidence', () => {
  it('lets the bast, courier, porter and oracle lanes and an admin in; nobody else', async () => {
    for (const l of ['bast', 'courier', 'porter', 'oracle']) {
      vi.mocked(requireAuth).mockResolvedValue(lane(l) as never);
      expect((await POST(req({ items: [item] }))).status).toBe(200);
    }
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'a', role: 'admin', email: 'a@x.test', via: 'session' } as never);
    expect((await POST(req({ items: [item] }))).status).toBe(200);
    for (const l of ['wright', 'bast-chat', 'clarity']) {
      vi.mocked(requireAuth).mockResolvedValue(lane(l) as never);
      expect((await POST(req({ items: [item] }))).status).toBe(403);
    }
  });

  it('is strict: at most 100 items, a known kind, a target or a source (not both), one plain line of at most 300 characters', async () => {
    expect((await POST(req({ items: [] }))).status).toBe(400);
    expect((await POST(req({ items: Array.from({ length: 101 }, () => item) }))).status).toBe(400);
    expect((await POST(req({ items: [{ ...item, kind: 'rumour' }] }))).status).toBe(400);
    expect((await POST(req({ items: [{ ...item, line: 'x'.repeat(301) }] }))).status).toBe(400);
    expect((await POST(req({ items: [{ ...item, target_key: undefined }] }))).status).toBe(400);
    expect((await POST(req({ items: [{ ...item, from: { kind: 'session', ref: 's1' } }] }))).status).toBe(400);
    expect((await POST(req({ items: [{ ...item, extra: 1 }] }))).status).toBe(400);
    expect((await POST(req({ items: [item], extra: 1 }))).status).toBe(400);
    expect(recordEvidence).not.toHaveBeenCalled();
    expect((await POST(req({ items: Array.from({ length: 100 }, () => item) }))).status).toBe(200);
  });
});
