import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

// Real client-auth (switchActiveClient) and real access rules; only the cookie-reading
// requireClientAuth is stubbed, and prisma is an in-memory fake.
vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: { findMany: vi.fn(), findFirst: vi.fn() },
    client: { findMany: vi.fn(), findFirst: vi.fn() },
    projectContact: { findMany: vi.fn() },
    portalSession: { update: vi.fn() },
  },
}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/services/email', () => ({ sendClientMagicLinkEmail: vi.fn() }));

import { POST } from '../route';
import { GET } from '../../../clients/route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import { FakePortalDb } from '@/lib/portal/__tests__/fake-portal-db';

const db = new FakePortalDb();
const mockAuth = requireClientAuth as Mock;
const mockSessionUpdate = prisma.portalSession.update as Mock;

const session = (clientId: string, contactId: string, role = 'member') => ({
  clientId, contactId, contactIds: [contactId], role, email: 'pat@nerdherd.com', sessionId: 'sess-1', moved: false,
});
const post = (client_id: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/api/portal/session/client', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ client_id }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  db.install(prisma as unknown as Record<string, Record<string, Mock>>);
  db.addClient({ id: 'nh', name: 'Nerd Herd', type: 'agency_partner' });
  db.addClient({ id: 'sub-a', name: 'Sub A', type: 'sub_client', parent_agency_id: 'nh' });
  db.addClient({ id: 'secret', name: 'Secret Co' });
  db.addContact({ id: 'k-nh', client_id: 'nh', email: 'pat@nerdherd.com', portal_role: 'member' });
  mockSessionUpdate.mockResolvedValue({});
  mockAuth.mockResolvedValue(session('nh', 'k-nh'));
});

describe('POST /api/portal/session/client', () => {
  it('switching to a client without access returns 403 and writes nothing', async () => {
    const res = await post('secret');
    expect(res.status).toBe(403);
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it('agency member switches to a sub-client', async () => {
    const res = await post('sub-a');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ active_client_id: 'sub-a', client: { role: 'member' } });
    expect(mockSessionUpdate).toHaveBeenCalledWith({ where: { id: 'sess-1' }, data: { entity_id: 'sub-a' } });
  });

  it('logs every switch with the session and both client ids, never the email', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await post('sub-a');
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain('sess-1');
    expect(line).toContain('nh -> sub-a');
    expect(line).not.toContain('pat@nerdherd.com');
    info.mockRestore();
  });

  it('rejects cross-site and non-JSON posts before touching the session', async () => {
    expect((await post('sub-a', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post('sub-a', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('sub-a', { 'content-type': 'text/plain' })).status).toBe(415);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockSessionUpdate).not.toHaveBeenCalled();
    expect((await post('sub-a', { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });

  it('revoked access blocks the switch: after the contact is deleted the sub-client is 403', async () => {
    db.contacts[0].is_deleted = true;
    const res = await post('sub-a');
    expect(res.status).toBe(403);
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it('sub-client contact cannot switch to the agency or a sibling', async () => {
    db.addClient({ id: 'sub-b', name: 'Sub B', type: 'sub_client', parent_agency_id: 'nh' });
    db.addContact({ id: 'k-sa', client_id: 'sub-a', email: 'sam@suba.com', portal_role: 'owner' });
    mockAuth.mockResolvedValue({ ...session('sub-a', 'k-sa', 'owner'), email: 'sam@suba.com' });
    expect((await post('nh')).status).toBe(403);
    expect((await post('sub-b')).status).toBe(403);
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it('rejects a missing client_id with 400 and no session with 401', async () => {
    expect((await post(undefined)).status).toBe(400);
    mockAuth.mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await post('sub-a')).status).toBe(401);
  });
});

describe('GET /api/portal/clients', () => {
  it('lists the agency and its sub-clients for an agency member, flagging the active one', async () => {
    const res = await GET(new NextRequest('http://localhost/api/portal/clients'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active_client_id).toBe('nh');
    expect(body.clients.map((c: { id: string }) => c.id).sort()).toEqual(['nh', 'sub-a']);
    expect(body.clients[0]).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), role: 'member', project_only: false }));
    expect(Object.keys(body.clients[0]).sort()).toEqual(['id', 'name', 'project_only', 'role']);
  });

  it('revoked access drops the client from the list', async () => {
    db.contacts[0].portal_role = 'none';
    const body = await (await GET(new NextRequest('http://localhost/api/portal/clients'))).json();
    expect(body.clients).toEqual([]);
  });

  it('is 401 without a session', async () => {
    mockAuth.mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await GET(new NextRequest('http://localhost/api/portal/clients'))).status).toBe(401);
  });
});
