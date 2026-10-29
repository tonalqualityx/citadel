import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PATCH } from '../route';
import { jsonRequest, paramsOf, signIn, anonymous, sessionRow, CHANGE_ID, SESSION_ID, DESIGNER_ID, OTHER_DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, designSession: { findUnique: vi.fn() }, designChange: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock('@/lib/design/events', async (orig) => ({ ...(await orig<typeof import('@/lib/design/events')>()), appendDesignerEvent: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { appendDesignerEvent } from '@/lib/design/events';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const changeFind = prisma.designChange.findUnique as Mock;
const changeUpdate = prisma.designChange.update as Mock;
const append = appendDesignerEvent as Mock;
const now = new Date();
const changeRow = (over: Record<string, unknown> = {}) => ({
  id: CHANGE_ID, session_id: SESSION_ID, apply_event_seq: 2, commit_sha: 'c0ffee1', parent_sha: 'base1', summary: 'Enlarged the hero heading', files: ['a.njk'], data_libs: ['hero'],
  pages: ['/'], render_count: 3, pin_ids: [], before_asset_ids: [], after_asset_ids: [], gates: null, is_restore: false, restored_from: null, decision: 'pending',
  designer_note: null, decided_at: null, created_at: now, ...over,
});
const call = (body: unknown, headers?: Record<string, string>, id = CHANGE_ID) =>
  PATCH(jsonRequest(`/api/design/changes/${id}`, 'PATCH', body, headers), paramsOf({ id }));

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.designSession.findUnique as Mock).mockResolvedValue(sessionRow());
  changeFind.mockResolvedValue(changeRow());
  changeUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => changeRow(data));
  append.mockResolvedValue({ seq: 11, duplicate: false });
});

describe('PATCH /api/design/changes/:id', () => {
  it('accepts a change with a note and writes no event', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call({ decision: 'accepted', note: 'looks right' });
    expect(res.status).toBe(200);
    expect(changeUpdate.mock.calls[0][0].data).toMatchObject({ decision: 'accepted', designer_note: 'looks right', decided_by_id: DESIGNER_ID });
    expect(append).not.toHaveBeenCalled();
    expect((await res.json()).change).toMatchObject({ id: CHANGE_ID, decision: 'accepted' });
  });
  it('a denial writes a designer text event "Denied: <summary>. <note>" for the worker', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call({ decision: 'denied', note: 'too big' });
    expect(res.status).toBe(200);
    expect(append.mock.calls[0][0]).toMatchObject({
      sessionId: SESSION_ID, kind: 'text', payload: { text: 'Denied: Enlarged the hero heading. too big' }, clientRef: `deny:${CHANGE_ID}`,
    });
    expect(changeUpdate.mock.calls[0][0].data.decision).toBe('denied');
  });
  it('denying twice does not append a second time', async () => {
    signIn(auth, userFind, 'designer');
    changeFind.mockResolvedValue(changeRow({ decision: 'denied' }));
    await call({ decision: 'denied' });
    expect(append).not.toHaveBeenCalled();
  });
  it('a closed session is 409 and nothing changes', async () => {
    signIn(auth, userFind, 'designer');
    (prisma.designSession.findUnique as Mock).mockResolvedValue(sessionRow({ status: 'closed' }));
    expect((await call({ decision: 'denied' })).status).toBe(409);
    expect(changeUpdate).not.toHaveBeenCalled();
  });
  it('zod: decision pending/other and note over 4000 are 400; 413 over the cap', async () => {
    signIn(auth, userFind, 'designer');
    for (const b of [{}, { decision: 'pending' }, { decision: 'maybe' }, { decision: 'accepted', note: 'x'.repeat(4001) }]) expect((await call(b)).status).toBe(400);
    expect((await call(JSON.stringify({ decision: 'accepted', note: 'x'.repeat(20 * 1024) }))).status).toBe(413);
  });
  it("anonymous 401; another designer's change 404; unknown/malformed id 404; pm 403; cross-site 403", async () => {
    anonymous(auth);
    expect((await call({ decision: 'accepted' })).status).toBe(401);
    signIn(auth, userFind, 'designer', { userId: OTHER_DESIGNER_ID });
    expect((await call({ decision: 'accepted' })).status).toBe(404);
    signIn(auth, userFind, 'designer');
    changeFind.mockResolvedValue(null);
    expect((await call({ decision: 'accepted' })).status).toBe(404);
    expect((await call({ decision: 'accepted' }, undefined, 'nope')).status).toBe(404);
    changeFind.mockResolvedValue(changeRow());
    signIn(auth, userFind, 'pm');
    expect((await call({ decision: 'accepted' })).status).toBe(403);
    signIn(auth, userFind, 'designer');
    expect((await call({ decision: 'accepted' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});
