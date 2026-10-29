import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { getRequest, paramsOf, signIn, sessionRow, sessionRouteMatrix, SESSION_ID, SITE_ID } from '@/lib/design/__tests__/route-test-kit';
import { findForbiddenKeys } from '@/lib/design/projections';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    designSession: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    designPortalSettings: { findUnique: vi.fn() },
    designWorkerState: { findUnique: vi.fn() },
    designPublish: { findMany: vi.fn() },
    designEvent: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/design/presence', () => ({ onPresence: vi.fn().mockResolvedValue({ running: true, elapsed_s: 125 }) }));
vi.mock('@/lib/design/events', async (orig) => ({ ...(await orig<typeof import('@/lib/design/events')>()), feed: vi.fn(), hasUndelivered: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { feed, hasUndelivered } from '@/lib/design/events';
import { onPresence } from '@/lib/design/presence';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const feedMock = feed as Mock;
const call = (qs = '', headers?: Record<string, string>) => {
  void headers;
  return GET(getRequest(`/api/design/sessions/${SESSION_ID}/feed${qs}`), paramsOf({ id: SESSION_ID }));
};
const ev = (seq: number) => ({ seq, role: 'assistant', kind: 'text', payload: { text: `m${seq}` }, created_at: new Date() });

function arrange(over: Record<string, unknown> = {}) {
  sessionFind.mockResolvedValue(sessionRow(over));
  feedMock.mockResolvedValue({ events: [ev(4), ev(5)], last_seq: 5, has_more: false });
  (hasUndelivered as Mock).mockResolvedValue(false);
  (prisma.site.findUnique as Mock).mockResolvedValue({ id: SITE_ID, design_portal_enabled: true, designer_publish: true, is_deleted: false });
  (prisma.designPortalSettings.findUnique as Mock).mockResolvedValue({ designer_publish_mode: 'per_site' });
  (prisma.designWorkerState.findUnique as Mock).mockResolvedValue({ site_main_roles: { [SITE_ID]: 'client_preview' } });
  (prisma.designPublish.findMany as Mock).mockResolvedValue([]);
  (prisma.designEvent.findFirst as Mock).mockResolvedValue(null);
}
beforeEach(() => { vi.clearAllMocks(); arrange(); (onPresence as Mock).mockResolvedValue({ running: true, elapsed_s: 125 }); });

describe('GET /api/design/sessions/:id/feed', () => {
  it('lib_index events are hidden from the events list; the latest sha is exposed', async () => {
    signIn(auth, userFind, 'designer');
    feedMock.mockResolvedValue({ events: [ev(4), { ...ev(5), kind: 'lib_index', payload: { sha: 'abc1234', index: {} } }], last_seq: 5, has_more: false });
    (prisma.designEvent.findFirst as Mock).mockResolvedValue({ payload: { sha: 'abc1234', index: {} } });
    const json = await (await call()).json();
    expect(json.events.map((e: { seq: number }) => e.seq)).toEqual([4]);
    expect(json.last_seq).toBe(5);
    expect(json.lib_index_sha).toBe('abc1234');
  });
  it('returns events, live line, publish state, timer and the next poll interval', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call('?after=3&visible=1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.events.map((e: { seq: number }) => e.seq)).toEqual([4, 5]);
    expect(json.last_seq).toBe(5);
    expect(json.status).toBe('awaiting_input');
    expect(json.next_poll_ms).toBe(5000);
    expect(json.timer).toEqual({ running: true, elapsed_s: 125 });
    expect(json.publish).toMatchObject({ can_publish: false, reason: 'gates_not_green', main_role: 'client_preview' });
    expect(json.preview_sha).toBe('abc1234');
    expect(findForbiddenKeys(json)).toEqual([]);
  });
  it('after is the cursor: the service gets seq > after and the limit, nothing else', async () => {
    signIn(auth, userFind, 'designer');
    await call('?after=41&limit=50');
    expect(feedMock).toHaveBeenCalledWith(SESSION_ID, { after: 41, limit: 50 });
    await call('');
    expect(feedMock).toHaveBeenLastCalledWith(SESSION_ID, { after: 0, limit: 200 });
  });
  it('bad cursors are 400', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call('?after=-1')).status).toBe(400);
    expect((await call('?after=abc')).status).toBe(400);
    expect((await call('?limit=0')).status).toBe(400);
    expect((await call('?limit=9999')).status).toBe(400);
  });
  it('visible=1 and visible=0 reach the presence hook; anything else counts as hidden', async () => {
    signIn(auth, userFind, 'designer');
    await call('?visible=1');
    await call('?visible=0');
    await call('');
    expect((onPresence as Mock).mock.calls.map((c) => c[1])).toEqual([true, false, false]);
  });
  it('polls fast while a turn runs or a message is undelivered', async () => {
    signIn(auth, userFind, 'designer');
    arrange({ status: 'active' });
    expect((await (await call()).json()).next_poll_ms).toBe(1500);
    arrange();
    (hasUndelivered as Mock).mockResolvedValue(true);
    expect((await (await call()).json()).next_poll_ms).toBe(1500);
  });
  it('can_publish is true on green gates for this head, and reports a running publish of the session', async () => {
    signIn(auth, userFind, 'designer');
    arrange({ publish_precheck: { head_sha: 'head2222', gates_ok: true } });
    expect((await (await call()).json()).publish).toMatchObject({ can_publish: true, main_role: 'client_preview' });
    (prisma.designPublish.findMany as Mock).mockResolvedValue([{ id: 'pub-1', session_id: SESSION_ID }]);
    const json = await (await call()).json();
    expect(json.publish).toMatchObject({ can_publish: false, reason: 'publish_in_progress', running_publish_id: 'pub-1' });
  });
  sessionRouteMatrix('feed', { invoke: () => call(), requireAuth: auth, userFind, arrange: () => arrange(), write: false });
});
