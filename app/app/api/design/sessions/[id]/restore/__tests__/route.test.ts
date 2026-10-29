import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { jsonRequest, paramsOf, signIn, sessionRow, sessionRouteMatrix, SESSION_ID, DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, projectTeamAssignment: { findFirst: vi.fn(async () => ({ id: 'pta-1' })), findMany: vi.fn(async () => [{ project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) }, designSession: { findUnique: vi.fn() }, designChange: { findFirst: vi.fn() } } }));
vi.mock('@/lib/design/commands', async (orig) => ({ ...(await orig<typeof import('@/lib/design/commands')>()), createCommand: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createCommand } from '@/lib/design/commands';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const changeFind = prisma.designChange.findFirst as Mock;
const cmd = createCommand as Mock;
const SHA = 'a1b2c3d4e5f6a7b8';
const call = (body: unknown, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/restore`, 'POST', body, headers), paramsOf({ id: SESSION_ID }));
const arrange = () => { sessionFind.mockResolvedValue(sessionRow()); changeFind.mockResolvedValue({ id: 'ch1' }); cmd.mockResolvedValue({ command: { id: 'c9' }, created: true }); };
beforeEach(() => { vi.clearAllMocks(); arrange(); });

describe('POST /api/design/sessions/:id/restore', () => {
  it("writes DesignCommand(restore) for a change commit of this session, scoped to the session", async () => {
    signIn(auth, userFind, 'designer');
    const res = await call({ to_sha: SHA });
    expect(res.status).toBe(202);
    expect(changeFind.mock.calls[0][0].where).toMatchObject({ session_id: SESSION_ID });
    expect(cmd.mock.calls[0][0]).toEqual({ sessionId: SESSION_ID, verb: 'restore', payload: { to_sha: SHA }, createdById: DESIGNER_ID });
  });
  it("accepts the session's base_sha without a change row", async () => {
    signIn(auth, userFind, 'designer');
    changeFind.mockResolvedValue(null);
    expect((await call({ to_sha: 'BA5E1111' })).status).toBe(202);
    expect(cmd.mock.calls[0][0].payload).toEqual({ to_sha: 'ba5e1111' });
  });
  it("a sha that is not this session's is 400 and writes nothing", async () => {
    signIn(auth, userFind, 'designer');
    changeFind.mockResolvedValue(null);
    expect((await call({ to_sha: SHA })).status).toBe(400);
    expect(cmd).not.toHaveBeenCalled();
  });
  it('409 while publishing and on a closed session', async () => {
    signIn(auth, userFind, 'designer');
    sessionFind.mockResolvedValue(sessionRow({ status: 'publishing' }));
    expect((await call({ to_sha: SHA })).status).toBe(409);
    sessionFind.mockResolvedValue(sessionRow({ status: 'closed' }));
    expect((await call({ to_sha: SHA })).status).toBe(409);
  });
  it('zod: missing, non-hex, too short, too long are 400; 413 over the cap', async () => {
    signIn(auth, userFind, 'designer');
    for (const b of [{}, { to_sha: 'zzzzzzzz' }, { to_sha: 'abc' }, { to_sha: 'a'.repeat(65) }, { to_sha: 'HEAD' }]) expect((await call(b)).status).toBe(400);
    expect((await call(JSON.stringify({ to_sha: SHA, pad: 'x'.repeat(5000) }))).status).toBe(413);
  });
  sessionRouteMatrix('restore', { invoke: (h) => call({ to_sha: SHA }, h), requireAuth: auth, userFind, assignmentFind: prisma.projectTeamAssignment.findFirst as Mock, arrange, write: true });
});
