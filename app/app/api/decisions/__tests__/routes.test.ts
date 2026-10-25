import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const decision = { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  return {
    prisma: {
      apiKey: { findUnique: vi.fn() },
      decision,
      decisionSource: { findUnique: vi.fn(), create: vi.fn() },
      decisionLink: { findUnique: vi.fn(), create: vi.fn() },
      task: { findUnique: vi.fn() },
      project: { findUnique: vi.fn() },
      charter: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import { POST as createPOST, GET as listGET } from '../route';
import { GET as inScopeGET } from '../in-scope/route';
import { POST as confirmPOST } from '../[id]/confirm/route';
import { POST as rejectPOST } from '../[id]/reject/route';
import { POST as retractPOST } from '../[id]/retract/route';
import { POST as supersedePOST } from '../[id]/supersede/route';
import { POST as sourcesPOST } from '../[id]/sources/route';
import { GET as getOne } from '../[id]/route';
import { POST as linksPOST } from '../[id]/links/route';
import { POST as importPOST } from '../import/route';

const mockAuth = vi.mocked(requireAuth);
const dCreate = prisma.decision.create as Mock;
const dFindUnique = prisma.decision.findUnique as Mock;
const dUpdate = prisma.decision.update as Mock;
const srcFindUnique = prisma.decisionSource.findUnique as Mock;
const srcCreate = prisma.decisionSource.create as Mock;

const BOT = { userId: 'bot-1', role: 'pm', email: 'bast@example.com', via: 'api_key' as const, apiKeyId: 'key-1' };
const ADMIN = { userId: 'admin-1', role: 'admin', email: 'mike@example.com', via: 'session' as const };
const TECH = { userId: 'tech-1', role: 'tech', email: 't@example.com', via: 'session' as const };
const apiKeyFindUnique = prisma.apiKey.findUnique as Mock;
const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function req(url: string, body?: object, method = 'POST') {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: body ? method : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function dec(over: Record<string, unknown> = {}) {
  return {
    id: UUID_A, key: null, title: 't', text: 'x', kind: 'ruling', status: 'proposed', scope: 'fleet', lane: null,
    client_id: null, project_id: null, charter_id: null, site_id: null, accord_id: null, author_user_id: null,
    author_contact_id: null, ruled_at: null, revision: 1, supersedes_id: null, conflict_note: null, confidence: null,
    confirmed_by_user_id: null, confirmed_at: null, created_by_id: null, tags: [], created_at: new Date(),
    updated_at: new Date(), sources: [], links: [], ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue(BOT);
});

describe('POST /api/decisions', () => {
  it('lets a bot write proposed', async () => {
    dCreate.mockResolvedValue(dec());
    const res = await createPOST(req('/api/decisions', { title: 't', text: 'x' }));
    expect(res.status).toBe(201);
    expect(dCreate.mock.calls[0][0].data.status).toBe('proposed');
  });

  it('lets a bot write recorded_from_source', async () => {
    dCreate.mockResolvedValue(dec({ status: 'recorded_from_source' }));
    const res = await createPOST(req('/api/decisions', { title: 't', text: 'x', status: 'recorded_from_source', sources: [{ kind: 'doc', ref: 'r', quote: 'q' }] }));
    expect(res.status).toBe(201);
  });

  it('refuses confirmed from anyone, even an admin', async () => {
    for (const who of [BOT, ADMIN]) {
      mockAuth.mockResolvedValue(who);
      const res = await createPOST(req('/api/decisions', { title: 't', text: 'x', status: 'confirmed' }));
      expect(res.status).toBe(403);
    }
    expect(dCreate).not.toHaveBeenCalled();
  });

  it('a tech user cannot write decisions, sources or links', async () => {
    mockAuth.mockResolvedValue(TECH);
    expect((await createPOST(req('/api/decisions', { title: 't', text: 'x' }))).status).toBe(403);
    expect((await sourcesPOST(req(`/api/decisions/${UUID_A}/sources`, { kind: 'doc', ref: 'r' }), params(UUID_A))).status).toBe(403);
    expect((await linksPOST(req(`/api/decisions/${UUID_A}/links`, { entity_kind: 'task', entity_id: 'x' }), params(UUID_A))).status).toBe(403);
    expect(dCreate).not.toHaveBeenCalled();
  });

  it('recorded_from_source without a quoted source is a 400', async () => {
    const res = await createPOST(req('/api/decisions', { title: 't', text: 'x', status: 'recorded_from_source' }));
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    mockAuth.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await createPOST(req('/api/decisions', { title: 't', text: 'x' }));
    expect(res.status).toBe(401);
  });
});

describe('admin-only routes', () => {
  it('a bot cannot confirm, reject, retract, supersede or import', async () => {
    apiKeyFindUnique.mockResolvedValue({ scopes: [] });
    const calls = [
      () => confirmPOST(req(`/api/decisions/${UUID_A}/confirm`, {}), params(UUID_A)),
      () => rejectPOST(req(`/api/decisions/${UUID_A}/reject`, {}), params(UUID_A)),
      () => retractPOST(req(`/api/decisions/${UUID_A}/retract`, {}), params(UUID_A)),
      () => supersedePOST(req(`/api/decisions/${UUID_A}/supersede`, { by_id: UUID_B }), params(UUID_A)),
      () => importPOST(req('/api/decisions/import', { decisions: [{ key: 'k', title: 't', text: 'x' }] })),
    ];
    for (const c of calls) {
      const res = await c();
      expect(res.status).toBe(403);
    }
    expect(dUpdate).not.toHaveBeenCalled();
  });

  it('an API key without the decisions:admin scope is refused even if its user is an admin', async () => {
    mockAuth.mockResolvedValue({ ...ADMIN, via: 'api_key', apiKeyId: 'key-2' } as never);
    apiKeyFindUnique.mockResolvedValue({ scopes: ['engine'] });
    const res = await confirmPOST(req(`/api/decisions/${UUID_A}/confirm`, {}), params(UUID_A));
    expect(res.status).toBe(403);
  });

  it('an API key with the decisions:admin scope can confirm', async () => {
    mockAuth.mockResolvedValue(BOT as never);
    apiKeyFindUnique.mockResolvedValue({ scopes: ['decisions:admin'] });
    dFindUnique.mockResolvedValue(dec());
    dUpdate.mockResolvedValue(dec({ status: 'confirmed' }));
    const res = await confirmPOST(req(`/api/decisions/${UUID_A}/confirm`, {}), params(UUID_A));
    expect(res.status).toBe(200);
  });

  it('an admin can confirm a proposed decision and is recorded as the confirmer', async () => {
    mockAuth.mockResolvedValue(ADMIN);
    dFindUnique.mockResolvedValue(dec());
    dUpdate.mockResolvedValue(dec({ status: 'confirmed' }));
    const res = await confirmPOST(req(`/api/decisions/${UUID_A}/confirm`, {}), params(UUID_A));
    expect(res.status).toBe(200);
    expect(dUpdate.mock.calls[0][0].data).toMatchObject({ status: 'confirmed', confirmed_by_user_id: 'admin-1' });
  });

  it('confirm on a superseded decision is a 409', async () => {
    mockAuth.mockResolvedValue(ADMIN);
    dFindUnique.mockResolvedValue(dec({ status: 'superseded' }));
    const res = await confirmPOST(req(`/api/decisions/${UUID_A}/confirm`, {}), params(UUID_A));
    expect(res.status).toBe(409);
  });

  it('admin supersede runs in one transaction', async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const tx = prisma.$transaction as unknown as Mock;
    tx.mockImplementation(async (fn: (t: unknown) => unknown) => fn({ decision: prisma.decision }));
    dFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === UUID_A ? dec({ id: UUID_A, status: 'confirmed' }) : dec({ id: UUID_B, status: 'recorded_from_source' })
    );
    (prisma.decision.findFirst as Mock).mockResolvedValue(null);
    dUpdate.mockResolvedValue(dec({ id: UUID_B, supersedes_id: UUID_A, revision: 2 }));
    const res = await supersedePOST(req(`/api/decisions/${UUID_A}/supersede`, { by_id: UUID_B }), params(UUID_A));
    expect(res.status).toBe(200);
    expect(tx).toHaveBeenCalledTimes(1);
    expect(dUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/decisions/[id]/sources', () => {
  const body = { kind: 'doc', ref: '/a.md#L1' };
  it('creates a new source with 201', async () => {
    dFindUnique.mockResolvedValue({ id: UUID_A });
    srcFindUnique.mockResolvedValue(null);
    srcCreate.mockResolvedValue({ id: 's1', ...body });
    const res = await sourcesPOST(req(`/api/decisions/${UUID_A}/sources`, body), params(UUID_A));
    expect(res.status).toBe(201);
  });
  it('a duplicate kind+ref is a 200 no-op', async () => {
    dFindUnique.mockResolvedValue({ id: UUID_A });
    srcFindUnique.mockResolvedValue({ id: 's1', ...body });
    const res = await sourcesPOST(req(`/api/decisions/${UUID_A}/sources`, body), params(UUID_A));
    expect(res.status).toBe(200);
    expect(srcCreate).not.toHaveBeenCalled();
  });
});

describe('uuid validation', () => {
  it('a non-uuid id is a 400 on get, sources, confirm and the list filters', async () => {
    mockAuth.mockResolvedValue(ADMIN);
    expect((await getOne(req('/api/decisions/nope'), params('nope'))).status).toBe(400);
    expect((await sourcesPOST(req('/api/decisions/nope/sources', { kind: 'doc', ref: 'r' }), params('nope'))).status).toBe(400);
    expect((await confirmPOST(req('/api/decisions/nope/confirm', {}), params('nope'))).status).toBe(400);
    expect((await listGET(req('/api/decisions?client_id=Herba'))).status).toBe(400);
    expect(dFindUnique).not.toHaveBeenCalled();
  });
});

describe('GET routes', () => {
  it('status=active filters to recorded_from_source and confirmed', async () => {
    (prisma.decision.findMany as Mock).mockResolvedValue([]);
    await listGET(req('/api/decisions?status=active'));
    expect((prisma.decision.findMany as Mock).mock.calls[0][0].where.status).toEqual({
      in: ['recorded_from_source', 'confirmed'],
    });
  });
  it('in-scope with a non-uuid id is a 400', async () => {
    const res = await inScopeGET(req('/api/decisions/in-scope?client=Herba'));
    expect(res.status).toBe(400);
  });
  it('in-scope with no scope is a 400', async () => {
    const res = await inScopeGET(req('/api/decisions/in-scope'));
    expect(res.status).toBe(400);
  });
  it('in-scope by lane returns the decisions and the truncated flag', async () => {
    (prisma.decision.findMany as Mock).mockResolvedValue([dec({ status: 'confirmed' })]);
    const res = await inScopeGET(req('/api/decisions/in-scope?lane=wright'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.fleet_rows).toHaveLength(1);
    expect(body.truncated).toBe(false);
    expect(body.total_matched).toBe(1);
  });
});
