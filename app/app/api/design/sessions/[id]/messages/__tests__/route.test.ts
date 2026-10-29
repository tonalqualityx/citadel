import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { ApiError } from '@/lib/api/errors';
import { jsonRequest, paramsOf, signIn, sessionRow, sessionRouteMatrix, REF, SESSION_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, projectTeamAssignment: { findFirst: vi.fn(async () => ({ id: 'pta-1' })), findMany: vi.fn(async () => [{ project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) }, designSession: { findUnique: vi.fn() } } }));
vi.mock('@/lib/design/events', async (orig) => ({ ...(await orig<typeof import('@/lib/design/events')>()), appendDesignerEvent: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { appendDesignerEvent } from '@/lib/design/events';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const append = appendDesignerEvent as Mock;
const call = (body: unknown, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/messages`, 'POST', body, headers), paramsOf({ id: SESSION_ID }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionFind.mockResolvedValue(sessionRow());
  append.mockResolvedValue({ seq: 7, duplicate: false });
});

describe('POST /api/design/sessions/:id/messages', () => {
  it('stores a text event and returns 201 {seq}', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call({ client_ref: REF, text: ' make the hero bolder ' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ seq: 7 });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION_ID, kind: 'text', payload: { text: 'make the hero bolder' }, clientRef: REF }));
  });
  it('a repeat of the same client_ref is 200', async () => {
    signIn(auth, userFind, 'designer');
    append.mockResolvedValue({ seq: 7, duplicate: true });
    expect((await call({ client_ref: REF, text: 'hi' })).status).toBe(200);
  });
  it('a closed session is refused with 409', async () => {
    signIn(auth, userFind, 'designer');
    append.mockRejectedValue(new ApiError('This session is closed', 409, 'session_closed'));
    expect((await call({ client_ref: REF, text: 'hi' })).status).toBe(409);
  });
  it('zod: missing client_ref, empty text and text over 8000 are 400', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call({ text: 'hi' })).status).toBe(400);
    expect((await call({ client_ref: REF, text: '   ' })).status).toBe(400);
    expect((await call({ client_ref: REF, text: 'x'.repeat(8001) })).status).toBe(400);
    expect((await call({ client_ref: 'nope', text: 'hi' })).status).toBe(400);
  });
  it('a body over the cap is 413', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call(JSON.stringify({ client_ref: REF, text: 'x'.repeat(60 * 1024) }))).status).toBe(413);
  });
  it('invalid JSON is 400', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call('{nope')).status).toBe(400);
  });
  sessionRouteMatrix('messages', { invoke: (h) => call({ client_ref: REF, text: 'hi' }, h), requireAuth: auth, userFind, assignmentFind: prisma.projectTeamAssignment.findFirst as Mock, arrange: () => sessionFind.mockResolvedValue(sessionRow()), write: true });
});

describe('W8.2 on messages', () => {
  it('N8: an unknown field is 400, nothing appended', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call({ client_ref: REF, text: 'hi', role: 'system' })).status).toBe(400);
    expect(append).not.toHaveBeenCalled();
  });
  it('H5: the 429 from the rate limit reaches the client with its code', async () => {
    signIn(auth, userFind, 'designer');
    append.mockRejectedValue(new ApiError('At most 30 messages a minute per session', 429, 'rate_limited', 'messages_per_minute'));
    const res = await call({ client_ref: REF, text: 'hi' });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'rate_limited', limit: 'messages_per_minute' });
  });
});
