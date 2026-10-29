import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { jsonRequest, paramsOf, signIn, sessionRow, sessionRouteMatrix, SESSION_ID, DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, designSession: { findUnique: vi.fn() } } }));
vi.mock('@/lib/design/commands', async (orig) => ({ ...(await orig<typeof import('@/lib/design/commands')>()), createCommand: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createCommand } from '@/lib/design/commands';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const cmd = createCommand as Mock;
const call = (body: unknown = {}, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/client-files/refresh`, 'POST', body, headers), paramsOf({ id: SESSION_ID }));
const arrange = () => { sessionFind.mockResolvedValue(sessionRow({ status: 'active' })); cmd.mockResolvedValue({ command: { id: 'c1' }, created: true }); };
beforeEach(() => { vi.clearAllMocks(); arrange(); });

describe('POST /api/design/sessions/:id/client-files/refresh', () => {
  it('the owner writes DesignCommand(refresh_client_files) and gets 202', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call();
    expect(res.status).toBe(202);
    expect(cmd).toHaveBeenCalledWith({ sessionId: SESSION_ID, verb: 'refresh_client_files', createdById: DESIGNER_ID });
    expect(await res.json()).toEqual({ command_id: 'c1', created: true });
  });
  it('a repeat while one is pending returns the same command, still 202', async () => {
    signIn(auth, userFind, 'designer');
    cmd.mockResolvedValue({ command: { id: 'c1' }, created: false });
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ command_id: 'c1', created: false });
  });
  it('an admin may refresh any session; a closed session is 409; a big body is 413', async () => {
    signIn(auth, userFind, 'admin');
    expect((await call()).status).toBe(202);
    expect((await call(JSON.stringify({ pad: 'x'.repeat(5000) }))).status).toBe(413);
    sessionFind.mockResolvedValue(sessionRow({ status: 'closed' }));
    expect((await call()).status).toBe(409);
  });
  sessionRouteMatrix('client-files refresh', { invoke: (h) => call({}, h), requireAuth: auth, userFind, arrange, write: true });
});
