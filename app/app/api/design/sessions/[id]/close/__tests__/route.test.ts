import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { jsonRequest, paramsOf, signIn, sessionRow, sessionRouteMatrix, SESSION_ID, DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, projectTeamAssignment: { findFirst: vi.fn(async () => ({ id: 'pta-1' })), findMany: vi.fn(async () => [{ project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) }, designSession: { findUnique: vi.fn() }, designWorkerState: { findUnique: vi.fn() } } }));
vi.mock('@/lib/design/commands', async (orig) => ({ ...(await orig<typeof import('@/lib/design/commands')>()), createCommand: vi.fn() }));
vi.mock('@/lib/design/sessions', async (orig) => ({ ...(await orig<typeof import('@/lib/design/sessions')>()), closeSession: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createCommand } from '@/lib/design/commands';
import { closeSession } from '@/lib/design/sessions';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const workerFind = prisma.designWorkerState.findUnique as Mock;
const cmd = createCommand as Mock;
const closeMock = closeSession as Mock;
const call = (body: unknown = {}, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/close`, 'POST', body, headers), paramsOf({ id: SESSION_ID }));
const arrange = () => {
  sessionFind.mockResolvedValue(sessionRow());
  workerFind.mockResolvedValue({ last_heartbeat_at: new Date(), paused: false });
  cmd.mockResolvedValue({ command: { id: 'c1' }, created: true });
};
beforeEach(() => { vi.clearAllMocks(); arrange(); });

describe('POST /api/design/sessions/:id/close', () => {
  it('writes DesignCommand(close) with the reason and leaves the close to the online daemon', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call({ reason: 'done for today' });
    expect(res.status).toBe(200);
    expect(cmd).toHaveBeenCalledWith({ sessionId: SESSION_ID, verb: 'close', payload: { reason: 'done for today' }, createdById: DESIGNER_ID });
    expect(closeMock).not.toHaveBeenCalled();
    expect((await res.json()).session.status).toBe('awaiting_input');
  });
  it('with the daemon offline, closes through closeSession so the designer is not stuck', async () => {
    signIn(auth, userFind, 'designer');
    workerFind.mockResolvedValue({ last_heartbeat_at: new Date(Date.now() - 10 * 60_000), paused: false });
    closeMock.mockResolvedValue(sessionRow({ status: 'abandoned', closed_at: new Date() }));
    const res = await call();
    expect(closeMock).toHaveBeenCalledWith(SESSION_ID);
    expect((await res.json()).session.status).toBe('abandoned');
  });
  it('an active turn is never force-closed by the server (the daemon interrupts it)', async () => {
    signIn(auth, userFind, 'designer');
    sessionFind.mockResolvedValue(sessionRow({ status: 'active' }));
    workerFind.mockResolvedValue(null);
    expect((await call()).status).toBe(200);
    expect(closeMock).not.toHaveBeenCalled();
  });
  it('is refused while publishing (409); a terminal session just answers', async () => {
    signIn(auth, userFind, 'designer');
    sessionFind.mockResolvedValue(sessionRow({ status: 'publishing' }));
    expect((await call()).status).toBe(409);
    expect(cmd).not.toHaveBeenCalled();
    sessionFind.mockResolvedValue(sessionRow({ status: 'closed' }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(cmd).not.toHaveBeenCalled();
  });
  it('zod: reason over 500 is 400; 413 over the cap', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call({ reason: 'x'.repeat(501) })).status).toBe(400);
    expect((await call(JSON.stringify({ pad: 'x'.repeat(5000) }))).status).toBe(413);
  });
  sessionRouteMatrix('close', { invoke: (h) => call({}, h), requireAuth: auth, userFind, assignmentFind: prisma.projectTeamAssignment.findFirst as Mock, arrange, write: true });
});
