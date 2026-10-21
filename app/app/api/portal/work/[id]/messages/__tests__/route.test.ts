import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { ApiError, AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
// Portal phase C: the chat opens lazily; with chat off for the contact the phase B path runs unchanged.
vi.mock('@/lib/portal/chat/post-message', () => ({ ensureConversation: vi.fn().mockResolvedValue(null), postChatMessage: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { clientContact: { findFirst: vi.fn() } } }));
vi.mock('@/lib/portal/thread', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/thread')>();
  return { ...actual, loadThread: vi.fn(), postClientMessage: vi.fn() };
});

import { GET, POST } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import { loadThread, postClientMessage } from '@/lib/portal/thread';

const ID = '33333333-3333-4333-8333-333333333333';
const REF = '44444444-4444-4444-8444-444444444444';
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const get = (qs = '', id = ID) => GET(new NextRequest(new URL(`http://localhost/api/portal/work/${id}/messages${qs}`)), ctx(id));
const post = (body: unknown, id = ID) =>
  POST(new NextRequest(new URL(`http://localhost/api/portal/work/${id}/messages`), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), ctx(id));

beforeEach(() => {
  vi.clearAllMocks();
  (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'viewer' });
  (prisma.clientContact.findFirst as Mock).mockResolvedValue({ id: 'c1', name: 'Dana' });
});

describe('GET /api/portal/work/:id/messages', () => {
  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await get()).status).toBe(401);
  });
  it('404s work the contact may not see, and a malformed id without a query', async () => {
    (loadThread as Mock).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    (loadThread as Mock).mockClear();
    expect((await get('', 'nope')).status).toBe(404);
    expect(loadThread).not.toHaveBeenCalled();
  });
  it('returns the thread for the signed-in access, with an after cursor when valid', async () => {
    (loadThread as Mock).mockResolvedValue([{ id: 'm1' }]);
    const res = await get('?after=2026-10-21T10:00:00Z');
    expect(await res.json()).toEqual({ messages: [{ id: 'm1' }] });
    const [access, id, opts] = (loadThread as Mock).mock.calls[0];
    expect(access).toMatchObject({ clientId: 'cl1', contactId: 'c1', role: 'viewer' });
    expect(id).toBe(ID);
    expect(opts.after).toEqual(new Date('2026-10-21T10:00:00Z'));
    (loadThread as Mock).mockClear();
    await get('?after=garbage');
    expect((loadThread as Mock).mock.calls[0][2].after).toBeNull();
  });
});

describe('POST /api/portal/work/:id/messages', () => {
  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await post({ client_ref: REF, text: 'hi' })).status).toBe(401);
  });
  it('201 for a new message, 200 for a repeat', async () => {
    (postClientMessage as Mock).mockResolvedValueOnce({ message: { id: 'm1' }, created: true }).mockResolvedValueOnce({ message: { id: 'm1' }, created: false });
    expect((await post({ client_ref: REF, text: 'hi' })).status).toBe(201);
    const again = await post({ client_ref: REF, text: 'hi' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ message: { id: 'm1' } });
  });
  it('passes the contact and the body through, any role (a viewer here)', async () => {
    (postClientMessage as Mock).mockResolvedValue({ message: { id: 'm1' }, created: true });
    await post({ client_ref: REF, text: 'Use this photo' });
    const [access, contact, id, input] = (postClientMessage as Mock).mock.calls[0];
    expect(access.role).toBe('viewer');
    expect(contact).toEqual({ id: 'c1', name: 'Dana' });
    expect(id).toBe(ID);
    expect(input).toEqual({ client_ref: REF, text: 'Use this photo' });
  });
  it('validates the body: uuid ref, 1 to 4,000 characters', async () => {
    expect((await post({ client_ref: 'x', text: 'hi' })).status).toBe(400);
    expect((await post({ client_ref: REF, text: '' })).status).toBe(400);
    expect((await post({ client_ref: REF, text: 'x'.repeat(4001) })).status).toBe(400);
    expect(postClientMessage).not.toHaveBeenCalled();
  });
  it('404s a deleted contact and a bad task id', async () => {
    (prisma.clientContact.findFirst as Mock).mockResolvedValue(null);
    expect((await post({ client_ref: REF, text: 'hi' })).status).toBe(404);
    expect((await post({ client_ref: REF, text: 'hi' }, 'nope')).status).toBe(404);
  });
  it('turns the service errors into their status: 404 out of scope, 429 with the plain message', async () => {
    (postClientMessage as Mock).mockRejectedValueOnce(new ApiError('Not found', 404));
    expect((await post({ client_ref: REF, text: 'hi' })).status).toBe(404);
    (postClientMessage as Mock).mockRejectedValueOnce(new ApiError('You have sent a lot in a short time.', 429, 'rate_limited'));
    const r = await post({ client_ref: REF, text: 'hi' });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toContain('You have sent a lot');
  });
});
