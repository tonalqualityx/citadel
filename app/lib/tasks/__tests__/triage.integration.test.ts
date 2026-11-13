// @vitest-environment node
/**
 * The `triage` task status against a real scratch Postgres: who may leave it, that nothing can claim it, that no
 * dependency path (reopen, complete, sweep, new blocker) ever moves it, and that contractors and clients never see it.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { patchTask, mayLeaveTriage, TRIAGE_EXIT_TEXT } from '@/lib/services/task-patch';
import { claimTask } from '@/lib/tasks/claims';
import { healBlockedTasks, reblockDependents, unblockEligibleDependents } from '@/lib/services/dependencies';
import { GET as listTasks } from '@/app/api/tasks/route';
import { GET as getTask } from '@/app/api/tasks/[id]/route';
import { POST as addDependency } from '@/app/api/tasks/[id]/dependencies/route';

const authMock = requireAuth as Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(!SCRATCH)('triage status (real database)', () => {
  const tag = `tri${Date.now()}`;
  const ids: string[] = [];
  let botId: string;
  let techId: string;
  let triage: string;
  let blocker: string;

  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
  const bot = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k1' });
  const workerLane = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k2', lane: 'citadel-worker', laneEnforced: true });
  const chatLane = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k3', lane: 'bast-chat', laneEnforced: true });
  const otherAdmin = (): AuthPayload => ({ userId: techId, role: 'admin', email: 'x@test', via: 'session' });
  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const mk = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, ...data } as never });
    ids.push(t.id);
    return t;
  };

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: MIKE_USER_ID },
      update: {},
      create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' },
    });
    botId = (await prisma.user.create({ data: { email: `bot-${tag}@example.test`, password_hash: 'x', name: 'Bot', role: 'pm' } })).id;
    techId = (await prisma.user.create({ data: { email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech', role: 'tech' } })).id;
  });
  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.task.updateMany({ where: { id: { in: ids } }, data: { claim_holder: null } });
    for (const id of ids) await prisma.task.update({ where: { id }, data: { blocked_by: { set: [] } } }).catch(() => {});
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: [botId, techId] } } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    const t = await mk('idea', { status: 'triage', assignee_id: techId });
    triage = t.id;
    blocker = (await mk('blocker', { status: 'not_started' })).id;
    await prisma.task.update({ where: { id: triage }, data: { blocked_by: { connect: { id: blocker } } } });
  });

  describe('who may leave triage', () => {
    it('mayLeaveTriage: only Mike signed in, or the enforced bast-chat lane key', () => {
      expect(mayLeaveTriage(mike())).toBe(true);
      expect(mayLeaveTriage(chatLane())).toBe(true);
      expect(mayLeaveTriage(bot())).toBe(false);
      expect(mayLeaveTriage(workerLane())).toBe(false);
      expect(mayLeaveTriage(otherAdmin())).toBe(false);
      expect(mayLeaveTriage({ ...chatLane(), laneEnforced: false })).toBe(false);
      expect(mayLeaveTriage({ ...mike(), via: 'api_key' })).toBe(false); // Mike's own API key is not Mike signed in
    });

    it('a worker/bot token cannot release or drop a triage task (403), the task is untouched', async () => {
      for (const actor of [bot(), workerLane(), otherAdmin()]) {
        for (const status of ['not_started', 'abandoned']) {
          await expect(patchTask({ actor, id: triage, body: { status } })).rejects.toMatchObject({ statusCode: 403, message: TRIAGE_EXIT_TEXT });
        }
        // the combined-body path too
        await expect(patchTask({ actor, id: triage, body: { status: 'not_started', priority: 2 } })).rejects.toMatchObject({ statusCode: 403 });
      }
      expect((await row(triage)).status).toBe('triage');
    });

    it('Mike signed in can release (to not_started) and drop (to abandoned)', async () => {
      const r = await patchTask({ actor: mike(), id: triage, body: { status: 'not_started' } });
      expect(r.ok).toBe(true);
      expect((await row(triage)).status).toBe('not_started');
      await prisma.task.update({ where: { id: triage }, data: { status: 'triage' } });
      expect((await patchTask({ actor: mike(), id: triage, body: { status: 'abandoned', priority: 2 } })).ok).toBe(true);
      expect((await row(triage)).status).toBe('abandoned');
    });

    it('the chat lane (its server path) can release', async () => {
      expect((await patchTask({ actor: chatLane(), id: triage, body: { status: 'not_started' } })).ok).toBe(true);
      expect((await row(triage)).status).toBe('not_started');
    });

    it('nothing else leaves triage, not even for Mike (no in_progress, blocked, review; done is the Close as done exit, owner only)', async () => {
      for (const status of ['in_progress', 'blocked', 'review']) {
        await expect(patchTask({ actor: mike(), id: triage, body: { status } })).rejects.toMatchObject({ statusCode: 400 });
      }
      expect((await row(triage)).status).toBe('triage');
    });

    it('anyone may move a not_started task into triage; it drops a claim and client visibility', async () => {
      const t = await mk('to file', { status: 'not_started', client_visible: true });
      const c = await claimTask({ taskId: t.id, holder: 'worker:w1' });
      expect(c.ok).toBe(true);
      const r = await patchTask({ actor: bot(), id: t.id, body: { status: 'triage' }, claimToken: c.ok ? c.claim.token : null });
      expect(r.ok).toBe(true);
      const after = await row(t.id);
      expect(after.status).toBe('triage');
      expect(after.client_visible).toBe(false);
      expect(after.lease_until).toBeNull();
      expect(after.claim_holder).toBeNull();
    });

    it('only not_started moves into triage (an in_progress task cannot)', async () => {
      const t = await mk('busy', { status: 'in_progress' });
      await expect(patchTask({ actor: bot(), id: t.id, body: { status: 'triage' } })).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('client visibility', () => {
    it('client_visible stays false while in triage, however it is set', async () => {
      await prisma.task.update({ where: { id: triage }, data: { client_visible: false } });
      await patchTask({ actor: mike(), id: triage, body: { client_visible: true, priority: 2 } });
      expect((await row(triage)).client_visible).toBe(false);
    });
  });

  describe('claims', () => {
    it('a triage task can never be claimed', async () => {
      const r = await claimTask({ taskId: triage, holder: 'worker:w1' });
      expect(r).toMatchObject({ ok: false, reason: 'triage' });
      expect((await row(triage)).claim_holder).toBeNull();
    });
  });

  describe('dependency leak', () => {
    it('stays in triage when its blocker is completed, reopened, and the sweep runs', async () => {
      await patchTask({ actor: mike(), id: blocker, body: { status: 'done' } });
      expect((await row(triage)).status).toBe('triage');
      await patchTask({ actor: mike(), id: blocker, body: { approved: true } });
      expect((await row(triage)).status).toBe('triage');
      await healBlockedTasks();
      expect((await row(triage)).status).toBe('triage');
      await patchTask({ actor: mike(), id: blocker, body: { status: 'in_progress' } }); // reopen
      expect((await row(triage)).status).toBe('triage');
      await healBlockedTasks();
      expect((await row(triage)).status).toBe('triage');
    });

    it('the service functions never touch it', async () => {
      await prisma.task.update({ where: { id: blocker }, data: { status: 'done', approved: true } });
      expect(await reblockDependents(blocker)).not.toContain(triage);
      expect(await unblockEligibleDependents(blocker)).not.toContain(triage);
      expect(await healBlockedTasks()).not.toContain(triage);
      expect((await row(triage)).status).toBe('triage');
    });

    it('a new unsatisfied blocker (PATCH connect, dependencies route) does not move it', async () => {
      const b2 = await mk('b2', { status: 'not_started' });
      await patchTask({ actor: mike(), id: triage, body: { blocked_by_ids: { connect: [b2.id] } } });
      expect((await row(triage)).status).toBe('triage');
      const b3 = await mk('b3', { status: 'not_started' });
      authMock.mockResolvedValue(mike());
      const res = await addDependency(new NextRequest(new URL('http://localhost/api/t'), { method: 'POST', body: JSON.stringify({ blocker_id: b3.id }) } as never), params(triage));
      expect(res.status).toBe(201);
      expect((await row(triage)).status).toBe('triage');
    });

    it('once released, the old behaviour is unchanged (a blocked task still unblocks on its blocker finishing)', async () => {
      const dep = await mk('dep', { status: 'blocked' });
      await prisma.task.update({ where: { id: dep.id }, data: { blocked_by: { connect: { id: blocker } } } });
      await prisma.task.update({ where: { id: blocker }, data: { status: 'done', approved: true } });
      expect(await healBlockedTasks()).toContain(dep.id);
      expect((await row(dep.id)).status).toBe('not_started');
    });
  });

  describe('who can see it', () => {
    it('a contractor (tech) never gets it in /api/tasks or by id', async () => {
      authMock.mockResolvedValue({ userId: techId, role: 'tech', email: 't@test', via: 'session' } as AuthPayload);
      const list = await listTasks(new NextRequest(new URL(`http://localhost/api/tasks?limit=100&search=${tag}`)));
      const body = await list.json();
      expect(body.tasks.map((t: { id: string }) => t.id)).not.toContain(triage);
      const one = await getTask(new NextRequest(new URL('http://localhost/api/t')), params(triage));
      expect(one.status).toBe(404);
    });

    it('Mike sees it when he asks for status=triage, and active_only leaves it out', async () => {
      authMock.mockResolvedValue(mike());
      const asked = await (await listTasks(new NextRequest(new URL(`http://localhost/api/tasks?limit=100&status=triage&search=${tag}`)))).json();
      expect(asked.tasks.map((t: { id: string }) => t.id)).toContain(triage);
      const active = await (await listTasks(new NextRequest(new URL(`http://localhost/api/tasks?limit=100&active_only=true&search=${tag}`)))).json();
      expect(active.tasks.map((t: { id: string }) => t.id)).not.toContain(triage);
    });

    it('POST /api/tasks with status triage files it in triage even with an unsatisfied blocker', async () => {
      const { POST } = await import('@/app/api/tasks/route');
      authMock.mockResolvedValue(bot());
      const res = await POST(new NextRequest(new URL('http://localhost/api/tasks'), { method: 'POST', body: JSON.stringify({ title: `${tag} filed`, status: 'triage', blocked_by_ids: [blocker] }) } as never));
      expect(res.status).toBe(201);
      const made = await res.json();
      ids.push(made.id);
      const r = await row(made.id);
      expect(r.status).toBe('triage');
      expect(r.client_visible).toBe(false);
    });
  });
});
