import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getClaim } from '@/lib/tasks/claims';
import { createOrGetSession, transitionSession } from '../sessions';
import { loadSessionFor } from '../access';
import { closeSessionsForUnassignedDesigner, UNASSIGNED_CLOSE_TEXT } from '../offboarding';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';

// W8.2 H2: taking a designer off a project closes her live design sessions on it.
describe.skipIf(!SCRATCH)('offboarding a designer from a project (real database)', () => {
  let f: DesignFixture;
  const unassign = () => prisma.projectTeamAssignment.deleteMany({ where: { project_id: f.projectId, user_id: f.designer.userId } });
  const reassign = () => prisma.projectTeamAssignment.create({ data: { project_id: f.projectId, user_id: f.designer.userId, function_id: f.functionId } });
  const idleSession = async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    await transitionSession(session.id, 'awaiting_input', 'worker');
    return { session, taskId };
  };

  beforeAll(async () => {
    f = await seedDesign(`off${Date.now()}`);
  });
  afterAll(async () => {
    await teardownDesign(f);
    await prisma.$disconnect();
  });

  it('her idle session is abandoned: status event, intent expired, close command, claim released; she gets 404, an admin does not', async () => {
    const { session, taskId } = await idleSession();
    const intent = await prisma.designPublish.create({
      data: {
        session_id: session.id, site_id: f.siteId, task_id: taskId, actor_id: f.designer.userId, actor_role: 'designer', publish_mode: 'per_site',
        main_role: 'production', site_designer_publish: true, status: 'awaiting_confirmation', confirmation_token_hash: 'f'.repeat(64),
        confirmation_expires_at: new Date(Date.now() + 600_000),
      },
    });
    expect((await getClaim(taskId))?.live).toBe(true);

    await unassign();
    try {
      const r = await closeSessionsForUnassignedDesigner(f.projectId, f.designer.userId, { byUserId: f.admin.userId });
      expect(r).toEqual({ closed: [session.id], left_to_worker: [] });

      const after = await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.status).toBe('abandoned');
      expect(after.closed_at).not.toBeNull();
      expect((await getClaim(taskId))?.live).toBe(false);
      const ev = await prisma.designEvent.findFirstOrThrow({ where: { session_id: session.id, role: 'system', kind: 'status' }, orderBy: { seq: 'desc' } });
      expect(ev.payload).toMatchObject({ text: UNASSIGNED_CLOSE_TEXT, reason: 'designer_unassigned' });
      expect(await prisma.designPublish.findUniqueOrThrow({ where: { id: intent.id } })).toMatchObject({ status: 'expired', confirmation_token_hash: null });
      expect(await prisma.designCommand.findFirst({ where: { session_id: session.id, verb: 'close', status: 'pending' } })).toMatchObject({
        created_by_id: f.admin.userId,
        payload: { reason: 'designer_unassigned' },
      });

      await expect(loadSessionFor(f.designer, session.id)).rejects.toMatchObject({ statusCode: 404 });
      expect((await loadSessionFor(f.admin, session.id, { mode: 'write' })).id).toBe(session.id);
    } finally {
      await reassign();
    }
  });

  it('a running turn (active) is left to the daemon: close command queued, status untouched, still 404 for her', async () => {
    const { session } = await idleSession();
    await transitionSession(session.id, 'active', 'worker');
    await unassign();
    try {
      const r = await closeSessionsForUnassignedDesigner(f.projectId, f.designer.userId, { byUserId: f.admin.userId });
      expect(r).toMatchObject({ left_to_worker: expect.arrayContaining([session.id]) });
      expect((await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('active');
      expect(await prisma.designCommand.count({ where: { session_id: session.id, verb: 'close' } })).toBe(1);
      await expect(loadSessionFor(f.designer, session.id)).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      await reassign();
      await transitionSession(session.id, 'awaiting_input', 'worker');
    }
  });

  it('still on the project through another function: nothing happens', async () => {
    const { session } = await idleSession();
    const fn2 = await prisma.function.create({ data: { name: `dp-${f.tag}-second` } });
    try {
      await prisma.projectTeamAssignment.create({ data: { project_id: f.projectId, user_id: f.designer.userId, function_id: fn2.id } });
      await prisma.projectTeamAssignment.deleteMany({ where: { project_id: f.projectId, user_id: f.designer.userId, function_id: f.functionId } });
      expect(await closeSessionsForUnassignedDesigner(f.projectId, f.designer.userId, { byUserId: f.admin.userId })).toEqual({ closed: [], left_to_worker: [] });
      expect((await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('awaiting_input');
      expect((await loadSessionFor(f.designer, session.id)).id).toBe(session.id);
    } finally {
      await prisma.projectTeamAssignment.deleteMany({ where: { function_id: fn2.id } });
      await prisma.function.delete({ where: { id: fn2.id } });
      await reassign();
    }
  });

  it("an admin's own session on the project is never touched (admins do not depend on the team)", async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.admin, taskId);
    expect(await closeSessionsForUnassignedDesigner(f.projectId, f.admin.userId, { byUserId: f.admin.userId })).toEqual({ closed: [], left_to_worker: [] });
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('pending');
  });
});
