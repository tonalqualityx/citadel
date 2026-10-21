import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError, ApiError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
vi.mock('@/lib/db/prisma', () => ({ prisma: { clientContact: { findFirst: vi.fn() } } }));
vi.mock('@/lib/portal/intake/file-request', () => ({ fileRequest: vi.fn() }));
vi.mock('@/lib/api/rate-limit', async () => {
  const { NextResponse } = await import('next/server');
  return { rateLimit: vi.fn(() => null), tooMany: () => NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 }) };
});
vi.mock('@/lib/portal/requests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/requests')>();
  return { ...actual, loadRequests: vi.fn() };
});

import { GET, POST } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import { fileRequest } from '@/lib/portal/intake/file-request';
import { loadRequests } from '@/lib/portal/requests';
import { rateLimit } from '@/lib/api/rate-limit';

const INTAKE = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/portal/requests', { method: 'POST', body: JSON.stringify(body) });
const get = (qs = '') => new NextRequest(new URL(`http://localhost/api/portal/requests${qs}`));
const valid = { intake_id: INTAKE, type: 'site_change', site_id: SITE, answers: [{ key: 'q1', value: 'x' }, { key: 'q2', value: 'y' }] };
const filed = (created: boolean) => ({
  created,
  urgent: false,
  task: { id: 't1', client_title: 'Site change: x', state: { label: 'Received', tone: 'quiet' }, engagement: { kind: 'request', label: 'example.com', href: null } },
});

beforeEach(() => {
  vi.clearAllMocks();
  (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'owner' });
  (prisma.clientContact.findFirst as Mock).mockResolvedValue({ id: 'c1', name: 'Dana Reyes' });
});

describe('POST /api/portal/requests', () => {
  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await POST(post(valid))).status).toBe(401);
    expect(fileRequest).not.toHaveBeenCalled();
  });

  it('201s a new request with the client-safe task', async () => {
    (fileRequest as Mock).mockResolvedValue(filed(true));
    const res = await POST(post(valid));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ task: filed(true).task, urgent: false });
    const [access, contact, body] = (fileRequest as Mock).mock.calls[0];
    expect(access).toMatchObject({ clientId: 'cl1', contactId: 'c1', role: 'owner' });
    expect(contact).toEqual({ id: 'c1', name: 'Dana Reyes' });
    expect(body).toMatchObject({ intake_id: INTAKE, type: 'site_change', site_id: SITE });
  });

  it('200s a repeat of the same intake_id', async () => {
    (fileRequest as Mock).mockResolvedValue(filed(false));
    expect((await POST(post(valid))).status).toBe(200);
  });

  it('applies the per-IP guard first: 429 before any auth, lookup or filing', async () => {
    const { NextResponse } = await import('next/server');
    (rateLimit as Mock).mockReturnValueOnce(NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 }));
    expect((await POST(post(valid))).status).toBe(429);
    expect(requireClientAuth).not.toHaveBeenCalled();
    expect(fileRequest).not.toHaveBeenCalled();
  });

  it('never takes the client from the body', async () => {
    (fileRequest as Mock).mockResolvedValue(filed(true));
    await POST(post({ ...valid, client_id: 'another-client', contact_id: 'someone' }));
    const [access] = (fileRequest as Mock).mock.calls[0];
    expect(access.clientId).toBe('cl1');
    expect(access.contactId).toBe('c1');
  });

  it.each([
    ['a bad type', { ...valid, type: 'nope' }],
    ['a non-uuid intake id', { ...valid, intake_id: 'abc' }],
    ['a non-uuid site', { ...valid, site_id: 'abc' }],
    ['no answers array', { ...valid, answers: undefined }],
    ['over-long answer', { ...valid, answers: [{ key: 'q1', value: 'x'.repeat(2001) }] }],
  ])('400s %s', async (_n, body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(fileRequest).not.toHaveBeenCalled();
  });

  it('passes through the service\'s errors: 429 rate limit, 404 out of scope, 422 choose project, 403 no permission', async () => {
    for (const [status, code] of [[429, 'rate_limited'], [404, undefined], [422, 'choose_project'], [403, 'no_permission']] as const) {
      (fileRequest as Mock).mockRejectedValueOnce(new ApiError('msg', status, code));
      const res = await POST(post(valid));
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe('msg');
    }
  });
});

describe('GET /api/portal/requests', () => {
  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await GET(get())).status).toBe(401);
  });

  it('returns open and recently closed, scoped to the session client', async () => {
    (loadRequests as Mock).mockResolvedValue({ open: [{ id: 'a' }], recently_closed: [{ id: 'b' }] });
    const res = await GET(get());
    expect(await res.json()).toEqual({ open: [{ id: 'a' }], recently_closed: [{ id: 'b' }] });
    const [access, opts] = (loadRequests as Mock).mock.calls[0];
    expect(access).toMatchObject({ clientId: 'cl1', contactId: 'c1' });
    expect(opts).toEqual({ site_id: null, closed_days: undefined });
  });

  it('passes a valid site_id and closed_days, ignores junk', async () => {
    (loadRequests as Mock).mockResolvedValue({ open: [], recently_closed: [] });
    await GET(get(`?site_id=${SITE}&closed_days=7`));
    expect((loadRequests as Mock).mock.calls[0][1]).toEqual({ site_id: SITE, closed_days: 7 });
    await GET(get('?site_id=not-a-uuid&closed_days=abc'));
    expect((loadRequests as Mock).mock.calls[1][1]).toEqual({ site_id: null, closed_days: undefined });
    await GET(get('?closed_days=99999'));
    expect((loadRequests as Mock).mock.calls[2][1].closed_days).toBe(365);
  });
});
