import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: { findFirst: vi.fn() },
    clientContact: { findMany: vi.fn(), findFirst: vi.fn() },
    portalSession: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    activityLog: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    projectContact: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/services/portal', () => ({ getClientIp: vi.fn(() => '9.9.9.9') }));
vi.mock('@/lib/services/email', () => ({ sendClientMagicLinkEmail: vi.fn() }));

import type { Mock } from 'vitest';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { requireClientAuth, switchActiveClient } from '@/lib/services/client-auth';
import { startViewAsSession, endViewAsSession, readViewAsMetadata, VIEW_AS_TTL_MS } from '../view-as';
import { refuseIfViewAs } from '../view-as-guard';
import { VIEW_AS_READ_ONLY_LINE } from '../view-as-copy';
import { POST as startRoute } from '@/app/api/clients/[id]/view-as/route';
import { POST as exitRoute } from '@/app/api/portal-view-as/exit/route';

const m = (fn: unknown) => fn as Mock;
const CLIENT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';

function cookieJar(values: Record<string, string>) {
  m(cookies).mockResolvedValue({ get: (n: string) => (values[n] ? { value: values[n] } : undefined), set: vi.fn() });
}

beforeEach(() => {
  vi.clearAllMocks();
  m(prisma.client.findFirst).mockResolvedValue({ id: CLIENT, name: 'Acme Co' });
  m(prisma.clientContact.findMany).mockResolvedValue([
    { id: 'c-viewer', portal_role: 'viewer' },
    { id: CONTACT, portal_role: 'owner' },
  ]);
  m(prisma.portalSession.updateMany).mockResolvedValue({ count: 0 });
  m(prisma.portalSession.create).mockResolvedValue({});
  m(prisma.activityLog.create).mockResolvedValue({});
});

describe('startViewAsSession', () => {
  it('audit-logs on the client first, then mints a 30 minute session flagged view_as with the admin and role', async () => {
    const order: string[] = [];
    m(prisma.activityLog.create).mockImplementation(async () => void order.push('audit'));
    m(prisma.portalSession.create).mockImplementation(async () => void order.push('session'));
    const r = await startViewAsSession({ adminUserId: ADMIN, clientId: CLIENT, role: 'owner', ipAddress: '1.1.1.1', userAgent: 'ua' });
    expect(r.ok).toBe(true);
    expect(order).toEqual(['audit', 'session']);
    expect(m(prisma.activityLog.create).mock.calls[0][0].data).toMatchObject({
      user_id: ADMIN,
      action: 'view_as_started',
      entity_type: 'client',
      entity_id: CLIENT,
      entity_name: 'Acme Co',
    });
    const data = m(prisma.portalSession.create).mock.calls[0][0].data;
    expect(data).toMatchObject({ token_type: 'client_session', entity_id: CLIENT, contact_id: CONTACT, action: 'view_as' });
    expect(data.metadata).toEqual({ view_as: true, admin_user_id: ADMIN, role: 'owner' });
    expect(data.session_token).toMatch(/^[0-9a-f]{128}$/);
    const ttl = data.expires_at.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it('attributes the view to a contact holding the chosen role when there is one', async () => {
    await startViewAsSession({ adminUserId: ADMIN, clientId: CLIENT, role: 'viewer', ipAddress: 'x', userAgent: null });
    expect(m(prisma.portalSession.create).mock.calls[0][0].data.contact_id).toBe('c-viewer');
  });

  it('ends the admin\'s earlier views when a new one starts', async () => {
    await startViewAsSession({ adminUserId: ADMIN, clientId: CLIENT, role: 'owner', ipAddress: 'x', userAgent: null });
    expect(m(prisma.portalSession.updateMany).mock.calls[0][0].where).toMatchObject({ action: 'view_as', revoked_at: null });
  });

  it('creates no session when the audit row cannot be written', async () => {
    m(prisma.activityLog.create).mockRejectedValue(new Error('db down'));
    await expect(startViewAsSession({ adminUserId: ADMIN, clientId: CLIENT, role: 'owner', ipAddress: 'x', userAgent: null })).rejects.toThrow();
    expect(prisma.portalSession.create).not.toHaveBeenCalled();
  });

  it('refuses a missing client and a client with no contacts', async () => {
    m(prisma.client.findFirst).mockResolvedValue(null);
    expect(await startViewAsSession({ adminUserId: ADMIN, clientId: CLIENT, role: 'owner', ipAddress: 'x', userAgent: null })).toEqual({ ok: false, reason: 'client_not_found' });
    m(prisma.client.findFirst).mockResolvedValue({ id: CLIENT, name: 'Acme Co' });
    m(prisma.clientContact.findMany).mockResolvedValue([]);
    expect(await startViewAsSession({ adminUserId: ADMIN, clientId: CLIENT, role: 'owner', ipAddress: 'x', userAgent: null })).toEqual({ ok: false, reason: 'no_contact' });
    expect(prisma.portalSession.create).not.toHaveBeenCalled();
  });
});

describe('requireClientAuth with a view-as session', () => {
  const now = Date.now();
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'sess-1',
    entity_id: CLIENT,
    contact_id: CONTACT,
    expires_at: new Date(now + 20 * 60 * 1000),
    created_at: new Date(now - 10 * 60 * 1000),
    revoked_at: null,
    action: 'view_as',
    metadata: { view_as: true, admin_user_id: ADMIN, role: 'member' },
    ...over,
  });
  beforeEach(() => {
    cookieJar({ client_session: 'tok' });
    m(prisma.portalSession.findFirst).mockResolvedValue(row());
    m(prisma.user.findFirst).mockResolvedValue({ id: ADMIN });
    m(prisma.clientContact.findFirst).mockResolvedValue({ email: 'jane@acme.com' });
    m(prisma.client.findFirst).mockResolvedValue({ id: CLIENT });
  });

  it('returns the pinned client and the role from the row, flagged viewAs, without resolving the person\'s accessible clients', async () => {
    const s = await requireClientAuth();
    expect(s).toMatchObject({ clientId: CLIENT, contactId: CONTACT, role: 'member', moved: false, viewAs: { adminUserId: ADMIN, role: 'member' } });
    expect(prisma.clientContact.findMany).not.toHaveBeenCalled();
  });

  it('never slides the session', async () => {
    await requireClientAuth();
    expect(prisma.portalSession.update).not.toHaveBeenCalled();
  });

  it('is dead after 30 minutes from creation even if expires_at was pushed out', async () => {
    m(prisma.portalSession.findFirst).mockResolvedValue(row({ created_at: new Date(now - VIEW_AS_TTL_MS - 1000), expires_at: new Date(now + 86400000) }));
    await expect(requireClientAuth()).rejects.toBeInstanceOf(AuthError);
  });

  it('is dead when the admin is no longer an active admin', async () => {
    m(prisma.user.findFirst).mockResolvedValue(null);
    await expect(requireClientAuth()).rejects.toBeInstanceOf(AuthError);
    expect(m(prisma.user.findFirst).mock.calls[0][0].where).toMatchObject({ id: ADMIN, is_active: true, role: 'admin' });
  });

  it('is dead when revoked, when the metadata is malformed or the role is none', async () => {
    m(prisma.portalSession.findFirst).mockResolvedValue(row({ revoked_at: new Date() }));
    await expect(requireClientAuth()).rejects.toBeInstanceOf(AuthError);
    m(prisma.portalSession.findFirst).mockResolvedValue(row({ metadata: { view_as: true, admin_user_id: ADMIN, role: 'none' } }));
    await expect(requireClientAuth()).rejects.toBeInstanceOf(AuthError);
    m(prisma.portalSession.findFirst).mockResolvedValue(row({ metadata: null }));
    await expect(requireClientAuth()).rejects.toBeInstanceOf(AuthError);
  });

  it('cannot switch clients', async () => {
    const s = await requireClientAuth();
    await expect(switchActiveClient(s, 'other')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('readViewAsMetadata only trusts a complete marker', () => {
    expect(readViewAsMetadata({ view_as: true, admin_user_id: ADMIN, role: 'owner' })).toEqual({ adminUserId: ADMIN, role: 'owner' });
    expect(readViewAsMetadata({ admin_user_id: ADMIN, role: 'owner' })).toBeNull();
    expect(readViewAsMetadata('x')).toBeNull();
  });
});

describe('refuseIfViewAs', () => {
  it('lets a request with no portal cookie through without touching the database', async () => {
    cookieJar({});
    expect(await refuseIfViewAs()).toBeNull();
    expect(prisma.portalSession.findFirst).not.toHaveBeenCalled();
  });
  it('lets a real client session through', async () => {
    cookieJar({ client_session: 'real' });
    m(prisma.portalSession.findFirst).mockResolvedValue(null);
    expect(await refuseIfViewAs()).toBeNull();
    expect(m(prisma.portalSession.findFirst).mock.calls[0][0].where).toEqual({ session_token: 'real', action: 'view_as' });
  });
  it('refuses a view-as cookie, expired or not, with 403 and the plain line', async () => {
    cookieJar({ client_session: 'v' });
    m(prisma.portalSession.findFirst).mockResolvedValue({ id: 'x' });
    const res = await refuseIfViewAs();
    expect(res?.status).toBe(403);
    expect((await res!.json()).error).toBe(VIEW_AS_READ_ONLY_LINE);
  });
  it('fails closed when the lookup errors', async () => {
    cookieJar({ client_session: 'v' });
    m(prisma.portalSession.findFirst).mockRejectedValue(new Error('db'));
    expect((await refuseIfViewAs())?.status).toBe(403);
  });
});

describe('POST /api/clients/:id/view-as', () => {
  const req = (body: object = {}) =>
    new NextRequest(`http://localhost:3000/api/clients/${CLIENT}/view-as`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const ctx = { params: Promise.resolve({ id: CLIENT }) };
  beforeEach(() => {
    m(requireRole).mockReset();
    m(requireAuth).mockResolvedValue({ userId: ADMIN, role: 'admin', email: 'a@x.com' });
    cookieJar({ access_token: 'jwt' });
  });

  it('is admin only', async () => {
    m(requireRole).mockImplementation(() => {
      throw new AuthError('Forbidden', 403);
    });
    const res = await startRoute(req(), ctx);
    expect(res.status).toBe(403);
    expect(prisma.portalSession.create).not.toHaveBeenCalled();
  });

  it('refuses a caller with no browser session (an API key)', async () => {
    cookieJar({});
    const res = await startRoute(req(), ctx);
    expect(res.status).toBe(403);
    expect(prisma.portalSession.create).not.toHaveBeenCalled();
  });

  it('sets an httpOnly 30 minute cookie, never returns the token, and defaults to owner', async () => {
    const res = await startRoute(req(), ctx);
    expect(res.status).toBe(200);
    const token = m(prisma.portalSession.create).mock.calls[0][0].data.session_token as string;
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body).toMatchObject({ url: '/portal/home', role: 'owner', client_name: 'Acme Co' });
    const cookie = res.cookies.get('client_session');
    expect(cookie?.value).toBe(token);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(cookie?.maxAge).toBeLessThanOrEqual(1800);
    expect(cookie?.maxAge).toBeGreaterThan(1700);
    // The admin's own session cookie is not touched.
    expect(res.cookies.get('access_token')).toBeUndefined();
  });

  it('rejects an unknown role and a cross-site call', async () => {
    expect((await startRoute(req({ role: 'none' }), ctx)).status).toBe(400);
    const cross = new NextRequest(`http://localhost:3000/api/clients/${CLIENT}/view-as`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json', 'sec-fetch-site': 'cross-site' },
    });
    expect((await startRoute(cross, ctx)).status).toBe(403);
  });

  it('409s with a plain line when the client has no contacts', async () => {
    m(prisma.clientContact.findMany).mockResolvedValue([]);
    const res = await startRoute(req(), ctx);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/portal-view-as/exit', () => {
  const exitReq = (cookie?: string) =>
    new NextRequest('http://localhost:3000/api/portal-view-as/exit', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `client_session=${cookie}` } : {}) },
    });

  it('revokes the view-as row only and clears the cookie, returning to the client record', async () => {
    m(prisma.portalSession.findFirst).mockResolvedValue({ id: 'row', entity_id: CLIENT });
    const res = await exitRoute(exitReq('tok'));
    expect(m(prisma.portalSession.findFirst).mock.calls[0][0].where).toMatchObject({ session_token: 'tok', action: 'view_as' });
    expect(m(prisma.portalSession.updateMany).mock.calls[0][0].data.revoked_at).toBeInstanceOf(Date);
    expect((await res.json()).return_to).toBe(`/clients/${CLIENT}`);
    expect(res.cookies.get('client_session')?.maxAge).toBe(0);
  });

  it('leaves a real client session alone', async () => {
    m(prisma.portalSession.findFirst).mockResolvedValue(null);
    const res = await exitRoute(exitReq('real'));
    expect(prisma.portalSession.updateMany).not.toHaveBeenCalled();
    expect((await res.json()).ended).toBe(false);
    expect(res.cookies.get('client_session')).toBeUndefined();
  });
});

describe('endViewAsSession', () => {
  it('is a no-op for an empty token', async () => {
    expect(await endViewAsSession('')).toBeNull();
  });
});
