import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', async () => ({ prisma: (await import('@/lib/design/__tests__/publish-fake-db')).fakeDb }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn() }));

import { POST } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { fakeDb } from '@/lib/design/__tests__/publish-fake-db';
import { IDS, authAs, jsonRequest, paramsOf, seedWorld, sessionOf, settingsOf, siteOf, type Who } from '@/lib/design/__tests__/publish-scenario';

const mockAuth = vi.mocked(requireAuth);
const mockDispatch = vi.mocked(dispatchNotification);

function call(who: Who, body: unknown = {}, via: 'session' | 'api_key' = 'session', headers: Record<string, string> = {}) {
  mockAuth.mockResolvedValue(authAs(who, via) as never);
  return POST(jsonRequest(`/api/design/sessions/${IDS.session}/request-publish`, body, headers), paramsOf(IDS.session));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seedWorld(fakeDb);
  mockDispatch.mockResolvedValue({ inApp: { sent: true }, email: { sent: false }, slack: { sent: false } });
});

describe('POST /api/design/sessions/:id/request-publish', () => {
  it('with the defaults 409 publish_allowed (publish it yourself); nothing sent', async () => {
    const res = await call('designer');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('publish_allowed');
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(sessionOf(fakeDb).publish_requested_at).toBeNull();
  });

  it('where an admin switched the site off: stamps the request and sends the owner one FYI', async () => {
    siteOf(fakeDb).designer_publish = false;
    const res = await call('designer', { note: 'ready for the client' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe(IDS.session);
    expect(body.session.publish_requested_at).toBeTruthy();
    expect(sessionOf(fakeDb).publish_requested_by).toBe(IDS.designer);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][0]).toMatchObject({
      userId: IDS.owner, type: 'design_publish_requested', priority: 'normal', entityType: 'design_session', entityId: IDS.session,
    });
    expect(mockDispatch.mock.calls[0][0].message).toContain('ready for the client');
  });

  it('mode off: allowed to request; with no owner set every active admin gets it', async () => {
    settingsOf(fakeDb).designer_publish_mode = 'off';
    settingsOf(fakeDb).owner_user_id = null;
    expect((await call('designer')).status).toBe(200);
    expect(mockDispatch.mock.calls.map((c) => c[0].userId).sort()).toEqual([IDS.admin, IDS.owner].sort());
  });

  it('pm 403, another designer 404, an API key 403, cross-site 403', async () => {
    siteOf(fakeDb).designer_publish = false;
    expect((await call('pm')).status).toBe(403);
    expect((await call('other')).status).toBe(404);
    expect((await call('admin', {}, 'api_key')).status).toBe(403);
    expect((await call('designer', {}, 'session', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('a closed session 409; a note over 2000 characters 400', async () => {
    siteOf(fakeDb).designer_publish = false;
    expect((await call('designer', { note: 'x'.repeat(2001) })).status).toBe(400);
    sessionOf(fakeDb).status = 'closed';
    expect((await call('designer')).status).toBe(409);
  });
});
