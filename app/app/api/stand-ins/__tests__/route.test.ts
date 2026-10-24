import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { GET, POST } from '../route';
import { PATCH, DELETE } from '../[id]/route';

const rows = new Map<string, { id: string; for_user_id: string; role_key: string; stand_in_user_id: string }>();
const MIKE = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
const SABEEN = 'b565b492-cdea-497b-a13d-85f003916bf9';
const NILS = '5b98dcb5-93a1-4147-82b7-f462c9ea09ae';
const ID = '88888888-8888-4888-8888-888888888888';
const known = new Set([MIKE, SABEEN, NILS]);

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((i) => known.has(i)).map((id) => ({ id }))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (known.has(where.id) ? { id: where.id } : null)),
    },
    standIn: {
      findMany: vi.fn(async () => [...rows.values()]),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: { for_user_id: string; role_key: string; stand_in_user_id: string } }) => {
        if ([...rows.values()].some((r) => r.for_user_id === data.for_user_id && r.role_key === data.role_key)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { id: ID, ...data };
        rows.set(ID, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { stand_in_user_id: string } }) => {
        const row = { ...rows.get(where.id)!, ...data };
        rows.set(where.id, row);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => rows.delete(where.id)),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import type { Mock } from 'vitest';

const req = (method: string, body?: object, url = 'http://localhost/api/stand-ins') =>
  new NextRequest(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
const ctx = { params: Promise.resolve({ id: ID }) };
const good = { for_user_id: MIKE, role_key: 'wordpress', stand_in_user_id: SABEEN };

beforeEach(() => {
  vi.clearAllMocks();
  rows.clear();
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE, role: 'admin' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('/api/stand-ins', () => {
  it('is admin only on every method', async () => {
    await GET(req('GET'));
    await POST(req('POST', good));
    await PATCH(req('PATCH', { stand_in_user_id: NILS }, `http://localhost/api/stand-ins/${ID}`), ctx);
    await DELETE(req('DELETE', undefined, `http://localhost/api/stand-ins/${ID}`), ctx);
    const calls = (requireRole as Mock).mock.calls;
    expect(calls.length).toBe(4);
    for (const c of calls) expect(c[1]).toEqual(['admin']);
  });

  it('creates, lists, changes and removes a mapping', async () => {
    const created = await POST(req('POST', good));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: ID, ...good });
    expect((await (await GET(req('GET'))).json()).meta.count).toBe(1);
    const patched = await PATCH(req('PATCH', { stand_in_user_id: NILS }, `http://localhost/api/stand-ins/${ID}`), ctx);
    expect((await patched.json()).stand_in_user_id).toBe(NILS);
    expect((await DELETE(req('DELETE', undefined, `http://localhost/api/stand-ins/${ID}`), ctx)).status).toBe(200);
    expect(rows.size).toBe(0);
  });

  it('answers 409 on a repeat of person and role', async () => {
    await POST(req('POST', good));
    expect((await POST(req('POST', { ...good, stand_in_user_id: NILS }))).status).toBe(409);
  });

  it('rejects self cover, an unknown user, an unknown role', async () => {
    expect((await POST(req('POST', { ...good, stand_in_user_id: MIKE }))).status).toBe(400);
    expect((await POST(req('POST', { ...good, stand_in_user_id: '99999999-9999-4999-8999-999999999999' }))).status).toBe(400);
    expect((await POST(req('POST', { ...good, role_key: 'astronaut' }))).status).toBe(400);
    expect(rows.size).toBe(0);
  });
});
