import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getClaim } from '@/lib/tasks/claims';
import { createOrGetSession, transitionSession, closeSession } from '../sessions';
import { designClaimHolder, task8 } from '../helpers';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';

describe.skipIf(!SCRATCH)('session engine (real database)', () => {
  let f: DesignFixture;
  beforeAll(async () => {
    f = await seedDesign(`se${Date.now()}`);
  });
  afterAll(async () => {
    await teardownDesign(f);
    await prisma.$disconnect();
  });

  it('two concurrent creates make one session, branch and alias from task8, claim live', async () => {
    const taskId = await seedTask(f);
    const [a, b] = await Promise.all([createOrGetSession(f.designer, taskId), createOrGetSession(f.designer, taskId)]);
    expect(a.session.id).toBe(b.session.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(await prisma.designSession.count({ where: { task_id: taskId } })).toBe(1);
    expect(a.session.branch).toBe(`design/${task8(taskId)}`);
    expect(a.session.preview_alias).toBe(`design-${task8(taskId)}`);
    expect(a.session.status).toBe('pending');
    const claim = await getClaim(taskId);
    expect(claim?.live).toBe(true);
    expect(claim?.holder).toBe(designClaimHolder(taskId));
  });

  it('10 concurrent creates still make one', async () => {
    const taskId = await seedTask(f);
    const rs = await Promise.all(Array.from({ length: 10 }, () => createOrGetSession(f.designer, taskId)));
    expect(new Set(rs.map((r) => r.session.id)).size).toBe(1);
    expect(rs.filter((r) => r.created)).toHaveLength(1);
  });

  it('another designer gets 409 session_owned; an admin may open it', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    await expect(createOrGetSession(f.other, taskId)).rejects.toMatchObject({ statusCode: 409, code: 'session_owned' });
    const adm = await createOrGetSession(f.admin, taskId);
    expect(adm.session.id).toBe(session.id);
    expect(adm.created).toBe(false);
  });

  it('a designer not on the project gets 404; kill switch off gives 409 portal_disabled', async () => {
    const taskId = await seedTask(f);
    await expect(createOrGetSession(f.other, taskId)).rejects.toMatchObject({ statusCode: 404 });
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { enabled: false } });
    try {
      await expect(createOrGetSession(f.designer, taskId)).rejects.toMatchObject({ code: 'portal_disabled' });
    } finally {
      await prisma.designPortalSettings.update({ where: { id: 1 }, data: { enabled: true } });
    }
  });

  it('a site the box does not serve is 409 site_not_available', async () => {
    const taskId = await seedTask(f);
    const w = await prisma.designWorkerState.findUniqueOrThrow({ where: { id: 1 } });
    await prisma.designWorkerState.update({ where: { id: 1 }, data: { configured_site_ids: w.configured_site_ids.filter((s) => s !== f.siteId) } });
    try {
      await expect(createOrGetSession(f.designer, taskId)).rejects.toMatchObject({ code: 'site_not_available' });
    } finally {
      await prisma.designWorkerState.update({ where: { id: 1 }, data: { configured_site_ids: w.configured_site_ids } });
    }
  });

  it('illegal transitions throw and leave the row alone; legal ones move it', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    await expect(transitionSession(session.id, 'active', 'worker')).rejects.toMatchObject({ code: 'illegal_transition' });
    await expect(transitionSession(session.id, 'awaiting_input', 'server')).rejects.toMatchObject({ code: 'illegal_transition' });
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('pending');
    expect((await transitionSession(session.id, 'awaiting_input', 'worker')).status).toBe('awaiting_input');
    expect((await transitionSession(session.id, 'active', 'worker')).status).toBe('active');
  });

  it('concurrent identical moves: exactly one wins', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    const rs = await Promise.allSettled([transitionSession(session.id, 'awaiting_input', 'worker'), transitionSession(session.id, 'awaiting_input', 'worker')]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('close releases the claim, abandoned without a publish; a new session may follow', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    await transitionSession(session.id, 'awaiting_input', 'worker');
    expect((await getClaim(taskId))?.live).toBe(true);
    const closed = await closeSession(session.id);
    expect(closed.status).toBe('abandoned');
    expect(closed.closed_at).not.toBeNull();
    expect((await getClaim(taskId))?.live).toBe(false);
    await expect(transitionSession(session.id, 'awaiting_input', 'worker')).rejects.toMatchObject({ code: 'illegal_transition' });
    const again = await createOrGetSession(f.designer, taskId);
    expect(again.created).toBe(true);
    expect(again.session.id).not.toBe(session.id);
  });

  it('close with a successful publish is closed', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    await transitionSession(session.id, 'awaiting_input', 'worker');
    await prisma.designPublish.create({
      data: { session_id: session.id, site_id: f.siteId, task_id: taskId, actor_id: f.designer.userId, actor_role: 'designer', publish_mode: 'per_site', main_role: 'client_preview', site_designer_publish: true, status: 'published' },
    });
    expect((await closeSession(session.id)).status).toBe('closed');
  });
});
