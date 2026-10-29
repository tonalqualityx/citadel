/** Scratch-database fixture for the session engine tests: a designer on a project whose eleventy site is enabled and served. */
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { designActorFrom, type DesignActor } from '../helpers';
import { cleanupDesign } from './cleanup';

export { SCRATCH };

export interface DesignFixture {
  tag: string;
  clientId: string;
  siteId: string;
  projectId: string;
  functionId: string;
  designer: DesignActor;
  admin: DesignActor;
  other: DesignActor;
  taskIds: string[];
  settingsExisted: boolean;
  workerExisted: boolean;
}

export async function seedDesign(tag: string): Promise<DesignFixture> {
  const mkUser = (role: 'designer' | 'admin', n: string) =>
    prisma.user.create({ data: { email: `dp-${tag}-${n}@example.test`, password_hash: 'x', name: `${n} ${tag}`, role } });
  const [d, a, o] = await Promise.all([mkUser('designer', 'd'), mkUser('admin', 'a'), mkUser('designer', 'o')]);
  const client = await prisma.client.create({ data: { name: `DP ${tag} Co`, type: 'direct', status: 'active' } });
  const site = await prisma.site.create({
    data: { name: `${tag} site`, url: `https://${tag}.example.test`, client_id: client.id, design_portal_enabled: true, site_type: 'eleventy' },
  });
  const project = await prisma.project.create({ data: { name: `${tag} project`, client_id: client.id, site_id: site.id, status: 'in_progress' } });
  const fn = await prisma.function.create({ data: { name: `dp-${tag}` } });
  await prisma.projectTeamAssignment.create({ data: { project_id: project.id, user_id: d.id, function_id: fn.id } });
  const settingsExisted = !!(await prisma.designPortalSettings.findUnique({ where: { id: 1 } }));
  await prisma.designPortalSettings.upsert({ where: { id: 1 }, update: { enabled: true }, create: { id: 1, enabled: true } });
  const w = await prisma.designWorkerState.findUnique({ where: { id: 1 } });
  await prisma.designWorkerState.upsert({
    where: { id: 1 },
    update: { configured_site_ids: [...(w?.configured_site_ids ?? []), site.id] },
    create: { id: 1, configured_site_ids: [site.id] },
  });
  const actor = (u: { id: string; email: string }, role: 'designer' | 'admin') => designActorFrom({ userId: u.id, email: u.email, role, via: 'session' });
  return {
    tag, clientId: client.id, siteId: site.id, projectId: project.id, functionId: fn.id,
    designer: actor(d, 'designer'), admin: actor(a, 'admin'), other: actor(o, 'designer'),
    taskIds: [], settingsExisted, workerExisted: !!w,
  };
}

export async function seedTask(f: DesignFixture, title = 'task'): Promise<string> {
  const t = await prisma.task.create({ data: { title: `${f.tag} ${title} ${crypto.randomUUID().slice(0, 6)}`, client_id: f.clientId, project_id: f.projectId, site_id: f.siteId, status: 'not_started' } });
  f.taskIds.push(t.id);
  return t.id;
}

export async function teardownDesign(f: DesignFixture): Promise<void> {
  const userIds = [f.designer.userId, f.admin.userId, f.other.userId];
  await cleanupDesign({ taskIds: f.taskIds, siteIds: [f.siteId], userIds });
  await prisma.task.deleteMany({ where: { id: { in: f.taskIds } } });
  await prisma.projectTeamAssignment.deleteMany({ where: { project_id: f.projectId } });
  await prisma.function.deleteMany({ where: { id: f.functionId } });
  await prisma.project.deleteMany({ where: { id: f.projectId } });
  await prisma.site.deleteMany({ where: { id: f.siteId } });
  await prisma.client.deleteMany({ where: { id: f.clientId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const w = await prisma.designWorkerState.findUnique({ where: { id: 1 } });
  if (w) {
    if (!f.workerExisted) await prisma.designWorkerState.delete({ where: { id: 1 } });
    else await prisma.designWorkerState.update({ where: { id: 1 }, data: { configured_site_ids: w.configured_site_ids.filter((s) => s !== f.siteId) } });
  }
  if (!f.settingsExisted) await prisma.designPortalSettings.deleteMany({ where: { id: 1 } });
}
