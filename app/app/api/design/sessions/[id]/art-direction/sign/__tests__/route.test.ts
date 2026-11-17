import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { jsonRequest, paramsOf, signIn, anonymous, SESSION_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('@/lib/design/track-route', () => ({ loadTrackedSession: vi.fn() }));
vi.mock('@/lib/design/track-session', () => ({ assertTrackWritable: vi.fn() }));
vi.mock('@/lib/design/track-direction', () => ({ signArtDirection: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { signArtDirection } from '@/lib/design/track-direction';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const loadTracked = loadTrackedSession as Mock;
const sign = signArtDirection as Mock;
const BODY = { base_version: 1, base_revision: 'rev-1' };
const call = (body: unknown = BODY, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/art-direction/sign`, 'POST', body, headers) as never, paramsOf({ id: SESSION_ID }));

beforeEach(() => {
  vi.clearAllMocks();
  loadTracked.mockResolvedValue({ session: { id: SESSION_ID }, track: { id: 'track-1' } });
  sign.mockResolvedValue({ direction: { id: 'dir-1', version: 1, status: 'signed' }, stage: 'home_build' });
});

describe('POST /api/design/sessions/:id/art-direction/sign', () => {
  it('a designer signs: 200, the track is the one loaded, signed by her', async () => {
    const uid = signIn(auth, userFind, 'designer');
    const res = await call();
    expect(res.status).toBe(200);
    expect(loadTracked).toHaveBeenCalledWith(expect.objectContaining({ role: 'designer' }), SESSION_ID, 'write');
    expect(assertTrackWritable).toHaveBeenCalled();
    expect(sign).toHaveBeenCalledWith('track-1', uid, BODY);
  });

  it('a tech user signs: 200, signed by her', async () => {
    const uid = signIn(auth, userFind, 'tech');
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).direction).toMatchObject({ status: 'signed' });
    expect(loadTracked).toHaveBeenCalledWith(expect.objectContaining({ role: 'tech' }), SESSION_ID, 'write');
    expect(sign).toHaveBeenCalledWith('track-1', uid, BODY);
  });

  it('an admin is 403 designer_only and nothing is signed', async () => {
    signIn(auth, userFind, 'admin');
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('designer_only');
    expect(sign).not.toHaveBeenCalled();
  });

  it('a pm is 403 before the role check (the loader refuses a write), anonymous is 401, a key is 403', async () => {
    signIn(auth, userFind, 'pm');
    const { ApiError } = await import('@/lib/api/errors');
    loadTracked.mockRejectedValueOnce(new ApiError('Forbidden', 403, 'forbidden'));
    expect((await call()).status).toBe(403);
    anonymous(auth);
    expect((await call()).status).toBe(401);
    signIn(auth, userFind, 'tech', { via: 'api_key' });
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('session_required');
    expect(sign).not.toHaveBeenCalled();
  });

  it('a bad body is 400 and nothing is signed', async () => {
    signIn(auth, userFind, 'tech');
    expect((await call({ base_version: 'x' })).status).toBe(400);
    expect(sign).not.toHaveBeenCalled();
  });
});
