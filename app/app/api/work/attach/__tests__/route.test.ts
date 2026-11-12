import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/work/attach-store', () => ({ attachOrPropose: vi.fn(async () => ({ result: 'none' })) }));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { attachOrPropose } from '@/lib/work/attach-store';

const T = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const req = (body: unknown) => new NextRequest('http://localhost:3000/api/work/attach', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const lane = (l: string) => ({ userId: 'bast', role: 'pm', email: 'b@x.test', via: 'api_key', apiKeyId: 'k', lane: l });
const admin = { userId: 'a', role: 'admin', email: 'a@x.test', via: 'session' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(lane('porter') as never);
});

describe('POST /api/work/attach', () => {
  it('lets the porter, oracle and bast-chat lanes and the owner in; nobody else', async () => {
    for (const l of ['porter', 'oracle', 'bast-chat']) {
      vi.mocked(requireAuth).mockResolvedValue(lane(l) as never);
      expect((await POST(req({ kind: 'email', ref: 'c1', propose: true }))).status).toBe(200);
    }
    vi.mocked(requireAuth).mockResolvedValue(admin as never);
    expect((await POST(req({ kind: 'email', ref: 'c1', propose: true }))).status).toBe(200);
    for (const l of ['wright', 'courier', 'bast', 'audit-lane']) {
      vi.mocked(requireAuth).mockResolvedValue(lane(l) as never);
      expect((await POST(req({ kind: 'email', ref: 'c1', propose: true }))).status).toBe(403);
    }
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'u', role: 'pm', email: 'u@x.test', via: 'session' } as never);
    expect((await POST(req({ kind: 'email', ref: 'c1', propose: true }))).status).toBe(403);
  });

  it('is strict: a target or propose, never both and never neither; unknown keys and kinds are 400', async () => {
    expect((await POST(req({ kind: 'email', ref: 'c1' }))).status).toBe(400);
    expect((await POST(req({ kind: 'email', ref: 'c1', propose: true, target_key: `task:${T}` }))).status).toBe(400);
    expect((await POST(req({ kind: 'email', ref: 'c1', propose: true, nope: 1 }))).status).toBe(400);
    expect((await POST(req({ kind: 'letter', ref: 'c1', propose: true }))).status).toBe(400);
    expect((await POST(req({ kind: 'email', ref: 'c1', target_key: 'proposed' }))).status).toBe(400);
    expect((await POST(req({ kind: 'email', ref: 'x'.repeat(301), propose: true }))).status).toBe(400);
    expect(attachOrPropose).not.toHaveBeenCalled();
  });

  it('passes who attached: the porter is intake, the owner is mike, every other lane is bast', async () => {
    await POST(req({ kind: 'email', ref: 'c1', target_key: `task:${T}` }));
    expect(vi.mocked(attachOrPropose).mock.calls[0][1]).toMatchObject({ attached_by: 'intake', target_key: `task:${T}` });
    vi.mocked(requireAuth).mockResolvedValue(lane('oracle') as never);
    await POST(req({ kind: 'session', ref: 's1', propose: true, cwd: '/x' }));
    expect(vi.mocked(attachOrPropose).mock.calls[1][1]).toMatchObject({ attached_by: 'bast', cwd: '/x' });
    vi.mocked(requireAuth).mockResolvedValue(admin as never);
    await POST(req({ kind: 'email', ref: 'c1', propose: true }));
    expect(vi.mocked(attachOrPropose).mock.calls[2][1]).toMatchObject({ attached_by: 'mike' });
  });
});
