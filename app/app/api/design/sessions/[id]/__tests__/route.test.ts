import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { getRequest, paramsOf, signIn, sessionRow, pinRow, sessionRouteMatrix, SESSION_ID, TASK_ID } from '@/lib/design/__tests__/route-test-kit';
import { findForbiddenKeys } from '@/lib/design/projections';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    designSession: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    designPin: { findMany: vi.fn() },
    designChange: { findMany: vi.fn() },
    designWorkerState: { findUnique: vi.fn() },
    designEvent: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/design/presence', () => ({ onPresence: vi.fn().mockResolvedValue(null) }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { onPresence } from '@/lib/design/presence';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const call = () => GET(getRequest(`/api/design/sessions/${SESSION_ID}`), paramsOf({ id: SESSION_ID }));

function arrange() {
  sessionFind.mockResolvedValue(sessionRow());
  (prisma.task.findUnique as Mock).mockResolvedValue({ id: TASK_ID, title: 'Home page', description: 'Fix the hero', requirements: [] });
  (prisma.site.findUnique as Mock).mockResolvedValue({ name: 'VCDP' });
  (prisma.designPin.findMany as Mock).mockResolvedValue([pinRow()]);
  (prisma.designChange.findMany as Mock).mockResolvedValue([]);
  (prisma.designWorkerState.findUnique as Mock).mockResolvedValue({ last_heartbeat_at: new Date(), paused: false });
  (prisma.designEvent.findFirst as Mock).mockResolvedValue(null);
}
beforeEach(() => { vi.clearAllMocks(); arrange(); });

describe('GET /api/design/sessions/:id', () => {
  it('loads the workspace and calls the W2.7 presence hook as visible', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session).toMatchObject({ id: SESSION_ID, status: 'awaiting_input', branch: 'design/66666666' });
    expect(json.task).toMatchObject({ id: TASK_ID, title: 'Home page', description: 'Fix the hero' });
    expect(json.site).toEqual({ name: 'VCDP' });
    expect(json.pins).toHaveLength(1);
    expect(json.worker).toMatchObject({ online: true, paused: false });
    expect(findForbiddenKeys(json)).toEqual([]);
    expect(onPresence).toHaveBeenCalledWith(expect.objectContaining({ id: SESSION_ID }), true, expect.objectContaining({ role: 'designer' }));
  });
  it('attaches blast_radius from the latest lib_index event; null with no event', async () => {
    signIn(auth, userFind, 'designer');
    expect((await (await call()).json()).pins[0].blast_radius).toBeNull();
    (prisma.designEvent.findFirst as Mock).mockResolvedValue({ payload: { sha: 'abc1234', index: { hero: { pages: 3, sample: ['/', '/about/'] } } } });
    const json = await (await call()).json();
    expect(json.pins[0].blast_radius).toEqual({ pages: 3, sample: ['/', '/about/'] });
    expect((prisma.designEvent.findFirst as Mock).mock.calls[1][0]).toMatchObject({ where: { session_id: SESSION_ID, kind: 'lib_index' }, orderBy: { seq: 'desc' } });
    expect(findForbiddenKeys(json)).toEqual([]);
  });
  it('hides discarded pins', async () => {
    signIn(auth, userFind, 'designer');
    await call();
    expect((prisma.designPin.findMany as Mock).mock.calls[0][0].where.status).toEqual({ not: 'discarded' });
  });
  it('an unknown or malformed id is 404', async () => {
    signIn(auth, userFind, 'admin');
    sessionFind.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await GET(getRequest('/api/design/sessions/x'), paramsOf({ id: 'x' }))).status).toBe(404);
  });
  sessionRouteMatrix('session', { invoke: () => call(), requireAuth: auth, userFind, arrange, write: false });
});
