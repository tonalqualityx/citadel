import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { buildInbox } from '../worker-inbox';
import { claimCommand, completeCommand } from '../commands';
import { onClientFolderChanged, onProjectFolderChanged, queueDriveCommand, resolveProjectFolder, shareForAssignedDesigner, unshareForUnassignedDesigner } from '../drive-share';
import { closeSessionsForUnassignedDesigner } from '../offboarding';
import { SCRATCH, seedDesign, teardownDesign, type DesignFixture } from './fixtures';

describe.skipIf(!SCRATCH)('automatic Drive sharing commands (real database)', () => {
  let f: DesignFixture;
  let email: string;
  const cmds = (verb?: string) =>
    prisma.designCommand
      .findMany({ where: { session_id: null, ...(verb ? { verb: verb as never } : {}), payload: { path: ['email'], equals: email } }, orderBy: { created_at: 'asc' } })
      .then((rows) => rows.filter((r) => r.status === 'pending'));
  const reset = async () => {
    await prisma.designCommand.deleteMany({ where: { session_id: null, payload: { path: ['email'], equals: email } } });
    await prisma.projectTeamAssignment.deleteMany({ where: { project_id: f.projectId } });
    await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: null } });
    await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: null } });
  };
  const assign = (userId = f.designer.userId) => prisma.projectTeamAssignment.create({ data: { project_id: f.projectId, user_id: userId, function_id: f.functionId } });

  beforeAll(async () => {
    f = await seedDesign(`ds${Date.now()}`);
    email = `dp-${f.tag}-d@example.test`;
  });
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await prisma.projectTeamAssignment.deleteMany({ where: { project_id: f.projectId } });
    await teardownDesign(f);
    await prisma.$disconnect();
  });

  it('assigning a designer queues one share with the full payload when a folder resolves; none without', async () => {
    expect(await shareForAssignedDesigner(f.projectId, f.designer.userId, f.admin.userId)).toBe(0);
    await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: 'client-folder' } });
    expect(await resolveProjectFolder(f.projectId)).toBe('client-folder');
    await shareForAssignedDesigner(f.projectId, f.designer.userId, f.admin.userId);
    await shareForAssignedDesigner(f.projectId, f.designer.userId, f.admin.userId); // idempotent
    const rows = await cmds('share_drive_folder');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ folder_id: 'client-folder', email, role: 'writer' });
    expect(rows[0].session_id).toBeNull();
    // the project override wins; admins are never shared
    await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: 'proj-folder' } });
    expect(await shareForAssignedDesigner(f.projectId, f.admin.userId, f.admin.userId)).toBe(0);
  });

  it('the inbox delivers session-less commands first with the full payload; claim and complete work', async () => {
    const { command } = await queueDriveCommand({ verb: 'share_drive_folder', folderId: 'inbox-folder', email, createdById: f.admin.userId });
    const box = await buildInbox({ max: 200 });
    const hit = box.commands.find((c) => c.id === command.id);
    expect(hit).toMatchObject({ session_id: null, verb: 'share_drive_folder', payload: { folder_id: 'inbox-folder', email, role: 'writer' } });
    expect((await claimCommand(command.id)).status).toBe('claimed');
    expect((await completeCommand(command.id, { status: 'done', result: { ok: true } })).status).toBe('done');
  });

  it('setting a project folder shares it with each assigned designer; changing it unshares the old and shares the new; clearing unshares', async () => {
    await assign();
    await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: 'p1' } });
    await onProjectFolderChanged(f.projectId, null, f.admin.userId);
    expect((await cmds('share_drive_folder')).map((c) => (c.payload as { folder_id: string }).folder_id)).toEqual(['p1']);

    await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: 'p2' } });
    await onProjectFolderChanged(f.projectId, 'p1', f.admin.userId);
    expect((await cmds('unshare_drive_folder')).map((c) => (c.payload as { folder_id: string }).folder_id)).toEqual(['p1']);
    expect((await cmds('share_drive_folder')).map((c) => (c.payload as { folder_id: string }).folder_id)).toEqual(['p1', 'p2']);

    await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: null } });
    await onProjectFolderChanged(f.projectId, 'p2', f.admin.userId);
    expect((await cmds('unshare_drive_folder')).map((c) => (c.payload as { folder_id: string }).folder_id)).toEqual(['p1', 'p2']);
  });

  it('a client folder change reaches designers on projects without an override, and skips overridden ones', async () => {
    await assign();
    await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: 'c1' } });
    await onClientFolderChanged(f.clientId, null, 'c1', f.admin.userId);
    expect((await cmds('share_drive_folder')).map((c) => (c.payload as { folder_id: string }).folder_id)).toEqual(['c1']);
    await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: 'own' } });
    await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: 'c2' } });
    await onClientFolderChanged(f.clientId, 'c1', 'c2', f.admin.userId);
    expect(await cmds('share_drive_folder')).toHaveLength(1);
    expect(await cmds('unshare_drive_folder')).toHaveLength(0);
  });

  it('unassigning queues one unshare through the offboarding path, unless another project still uses the folder', async () => {
    await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: 'shared' } });
    await assign();
    const other = await prisma.project.create({ data: { name: `${f.tag} second`, client_id: f.clientId, status: 'in_progress' } });
    const fn2 = await prisma.function.create({ data: { name: `dp2-${f.tag}` } });
    await prisma.projectTeamAssignment.create({ data: { project_id: other.id, user_id: f.designer.userId, function_id: fn2.id } });
    try {
      await prisma.projectTeamAssignment.deleteMany({ where: { project_id: f.projectId } });
      await closeSessionsForUnassignedDesigner(f.projectId, f.designer.userId, { byUserId: f.admin.userId });
      expect(await cmds('unshare_drive_folder')).toHaveLength(0); // still on the second project, same client folder

      await prisma.projectTeamAssignment.deleteMany({ where: { project_id: other.id } });
      await closeSessionsForUnassignedDesigner(other.id, f.designer.userId, { byUserId: f.admin.userId });
      await unshareForUnassignedDesigner(other.id, f.designer.userId, f.admin.userId); // idempotent
      const rows = await cmds('unshare_drive_folder');
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ folder_id: 'shared', email, role: 'writer' });
    } finally {
      await prisma.projectTeamAssignment.deleteMany({ where: { project_id: other.id } });
      await prisma.project.delete({ where: { id: other.id } });
      await prisma.function.delete({ where: { id: fn2.id } });
    }
  });
});
