// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { anyUser, cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';
import { claimTask } from '@/lib/tasks/claims';
import { PATCH } from '../route';
import { POST as stagedPOST } from '../staged/route';
import type { Mock } from 'vitest';

const authMock = requireAuth as Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body: unknown, token?: string) =>
  new NextRequest(new URL('http://localhost/api/t'), { method, body: JSON.stringify(body), headers: token ? { 'x-claim-token': token } : {} } as never);
const patch = (id: string, body: unknown, token?: string) => PATCH(request('PATCH', body, token), params(id));

// Fleet item 3: the claim check on the PATCH and staged routes against a real database, mode on enforce.
describe.skipIf(!SCRATCH)('task claims on PATCH (real database)', () => {
  const tag = `cp${Date.now()}`;
  let a: Seeded;
  let userId: string;
  let priorMode: string | undefined;
  const api = () => authMock.mockResolvedValue({ userId, role: 'pm', email: 'k@test', via: 'api_key', apiKeyId: 'k1' });
  const session = () => authMock.mockResolvedValue({ userId, role: 'pm', email: 'p@test', via: 'session' });
  const row = () => prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });

  beforeAll(async () => {
    userId = (await anyUser()).id;
    a = await seedClient(tag);
    priorMode = (await prisma.appSettings.findUnique({ where: { id: 'singleton' } }))?.task_claims_mode;
    await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: { task_claims_mode: 'enforce' }, create: { id: 'singleton', task_claims_mode: 'enforce' } });
  });
  afterAll(async () => {
    await prisma.appSettings.update({ where: { id: 'singleton' }, data: { task_claims_mode: priorMode ?? 'warn' } });
    await prisma.activityLog.deleteMany({ where: { entity_id: a.taskId } });
    await cleanup([a]);
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.task.update({ where: { id: a.taskId }, data: { status: 'not_started', claim_holder: null, claim_token: null, claimed_at: null, lease_until: null } });
    await prisma.activityLog.deleteMany({ where: { entity_id: a.taskId } });
    api();
  });

  it('no lease: a plain PATCH to in_progress works as before', async () => {
    expect((await patch(a.taskId, { status: 'in_progress' })).status).toBe(200);
  });

  it('a live lease: an API key without the token gets 409 claim_lost, with the token it passes', async () => {
    const c = await claimTask({ taskId: a.taskId, holder: 'worker:w1' });
    if (!c.ok) throw new Error('claim');
    const denied = await patch(a.taskId, { status: 'in_progress' });
    expect(denied.status).toBe(409);
    expect((await denied.json()).code).toBe('claim_lost');
    expect((await row()).status).toBe('not_started');
    expect((await patch(a.taskId, { status: 'in_progress' }, c.claim.token)).status).toBe(200);
    expect((await row()).claim_holder).toBe('worker:w1');
  });

  it('a mixed body that carries a status is checked too', async () => {
    await claimTask({ taskId: a.taskId, holder: 'worker:w1' });
    const denied = await patch(a.taskId, { status: 'review', title: 'New title' });
    expect(denied.status).toBe(409);
    expect((await row()).title).not.toBe('New title');
  });

  it('a person on a browser session moves it anyway: the lease is cleared in the same write and a line is logged', async () => {
    const c = await claimTask({ taskId: a.taskId, holder: 'worker:w1' });
    if (!c.ok) throw new Error('claim');
    session();
    expect((await patch(a.taskId, { status: 'in_progress' })).status).toBe(200);
    const t = await row();
    expect(t.status).toBe('in_progress');
    expect([t.claim_holder, t.claim_token, t.lease_until]).toEqual([null, null, null]);
    const log = await prisma.activityLog.findFirst({ where: { entity_id: a.taskId, action: 'claim_override' } });
    expect(JSON.stringify(log?.changes)).toContain('while worker:w1 held it; claim released.');
  });

  it('a tech on a browser session also wins over a bot lease', async () => {
    await claimTask({ taskId: a.taskId, holder: 'worker:w1' });
    authMock.mockResolvedValue({ userId, role: 'tech', email: 't@test', via: 'session' });
    // checkTaskAccess lets a tech see the task only as assignee.
    await prisma.task.update({ where: { id: a.taskId }, data: { assignee_id: userId } });
    expect((await patch(a.taskId, { status: 'in_progress' })).status).toBe(200);
    expect((await row()).lease_until).toBeNull();
    await prisma.task.update({ where: { id: a.taskId }, data: { assignee_id: null } });
  });

  it('a rejected body writes no override line and keeps the lease', async () => {
    await claimTask({ taskId: a.taskId, holder: 'worker:w1' });
    session();
    expect((await patch(a.taskId, { status: 'in_progress', title: '' })).status).toBe(400);
    expect((await row()).claim_holder).toBe('worker:w1');
    expect(await prisma.activityLog.count({ where: { entity_id: a.taskId, action: 'claim_override' } })).toBe(0);
  });

  it('staged: no token is refused while a lease is live; the lease holder passes', async () => {
    const c = await claimTask({ taskId: a.taskId, holder: 'worker:w1' });
    if (!c.ok) throw new Error('claim');
    const call = (token?: string) => stagedPOST(request('POST', { preview_url: 'https://p.example.test/x' }, token), params(a.taskId));
    expect((await call()).status).toBe(409);
    expect((await call(c.claim.token)).status).toBe(200);
  });
});
