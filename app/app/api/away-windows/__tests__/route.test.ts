import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { PATCH, DELETE } from '../[id]/route';

const rows = new Map<string, Record<string, unknown>>();
let seq = 0;
const ADMIN = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
const USER = 'b565b492-cdea-497b-a13d-85f003916bf9';
const ID = '55555555-5555-4555-8555-555555555555';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === USER || where.id === ADMIN ? { id: where.id } : null)) },
    awayWindow: {
      findMany: vi.fn(async () => [...rows.values()]),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = seq++ === 0 ? ID : `55555555-5555-4555-8555-55555555555${seq}`;
        const row = { id, created_at: new Date(), ...data };
        rows.set(id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => rows.delete(where.id)),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import type { Mock } from 'vitest';

const req = (method: string, body?: object, url = 'http://localhost/api/away-windows') =>
  new NextRequest(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
const ctx = { params: Promise.resolve({ id: ID }) };
const good = { user_id: USER, starts_at: '2026-10-26T04:00:00.000Z', ends_at: '2026-10-30T16:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  rows.clear();
  seq = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: ADMIN, role: 'admin' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('/api/away-windows', () => {
  it('is admin only on every method', async () => {
    await GET(req('GET'));
    await POST(req('POST', good));
    await PATCH(req('PATCH', { note: 'x' }, `http://localhost/api/away-windows/${ID}`), ctx);
    await DELETE(req('DELETE', undefined, `http://localhost/api/away-windows/${ID}`), ctx);
    const calls = (requireRole as Mock).mock.calls;
    expect(calls.length).toBe(4);
    for (const c of calls) expect(c[1]).toEqual(['admin']);
  });

  it('refuses a non-admin (the role check throws)', async () => {
    (requireRole as Mock).mockImplementation(() => {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    });
    const res = await POST(req('POST', good));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(rows.size).toBe(0);
  });

  it('creates a window, lists it, edits it and deletes it', async () => {
    const created = await POST(req('POST', { ...good, note: 'Away week' }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({ user_id: USER, source: 'manual', confirmed_at: null, note: 'Away week' });
    const list = await (await GET(req('GET'))).json();
    expect(list.meta.count).toBe(1);
    const patched = await PATCH(req('PATCH', { confirmed_at: '2026-10-20T12:00:00.000Z' }, `http://localhost/api/away-windows/${ID}`), ctx);
    expect(patched.status).toBe(200);
    expect((await patched.json()).confirmed_at).toBe('2026-10-20T12:00:00.000Z');
    expect((await DELETE(req('DELETE', undefined, `http://localhost/api/away-windows/${ID}`), ctx)).status).toBe(200);
    expect(rows.size).toBe(0);
  });

  it('rejects an end before the start, an unknown user and a bad body', async () => {
    expect((await POST(req('POST', { ...good, ends_at: good.starts_at }))).status).toBe(400);
    expect((await POST(req('POST', { ...good, user_id: '66666666-6666-4666-8666-666666666666' }))).status).toBe(400);
    expect((await POST(req('POST', { user_id: 'nope' }))).status).toBe(400);
    expect(rows.size).toBe(0);
  });

  it('PATCH cannot move the end before the start; unknown id is 404', async () => {
    await POST(req('POST', good));
    expect((await PATCH(req('PATCH', { ends_at: '2026-10-20T00:00:00.000Z' }, `http://localhost/api/away-windows/${ID}`), ctx)).status).toBe(400);
    const missing = { params: Promise.resolve({ id: '77777777-7777-4777-8777-777777777777' }) };
    expect((await PATCH(req('PATCH', { note: 'x' }, 'http://localhost/api/away-windows/x'), missing)).status).toBe(404);
  });
});
