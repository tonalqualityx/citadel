/** Scratch-database fixtures for the v2 track engine tests: a portal-path site with the full recipe chain of design tasks. */
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { DesignFixture } from './fixtures';

export interface TrackWorld {
  siteId: string;
  projectId: string;
  /** recipe tasks by short name: provision, research, wireframe, art, home, refine, rest, review, launch */
  t: Record<'provision' | 'research' | 'wireframe' | 'art' | 'home' | 'refine' | 'rest' | 'review' | 'launch', string>;
}

/**
 * A fresh site (design_path portal, bast_enabled, portal enabled, served by the box) and project with the designer
 * assigned, plus the v2 recipe tasks wired like the wizard wires them (SPEC 7.1): tags and `blocked_by` edges.
 */
export async function seedWorld(f: DesignFixture, label: string, opts: { orderingOnly?: boolean; tags?: boolean } = {}): Promise<TrackWorld> {
  const site = await prisma.site.create({
    data: {
      name: `${f.tag} ${label} site`, url: `https://${f.tag}-${label}.example.test`, client_id: f.clientId, design_portal_enabled: true,
      site_type: 'eleventy', design_path: 'portal', bast_enabled: true,
    },
  });
  const project = await prisma.project.create({
    data: { name: `${f.tag} ${label}`, client_id: f.clientId, site_id: site.id, status: 'in_progress', dependencies_ordering_only: opts.orderingOnly ?? false },
  });
  await prisma.projectTeamAssignment.create({ data: { project_id: project.id, user_id: f.designer.userId, function_id: f.functionId } }).catch(() => undefined);
  const w = await prisma.designWorkerState.findUnique({ where: { id: 1 } });
  await prisma.designWorkerState.update({ where: { id: 1 }, data: { configured_site_ids: [...(w?.configured_site_ids ?? []), site.id] } });
  const mk = async (name: string, tags: string[], status: 'not_started' | 'blocked', blockers: string[] = []) => {
    const data: Prisma.TaskUncheckedCreateInput & { blocked_by?: Prisma.TaskCreateInput['blocked_by'] } = {
      title: `${f.tag} ${label} ${name} ${crypto.randomUUID().slice(0, 6)}`, client_id: f.clientId, project_id: project.id, site_id: site.id,
      status, tags: opts.tags === false ? [] : tags,
    };
    const t = await prisma.task.create({ data: { ...data, ...(blockers.length ? { blocked_by: { connect: blockers.map((id) => ({ id })) } } : {}) } });
    f.taskIds.push(t.id);
    return t.id;
  };
  const provision = await mk('provision', ['design-job:provision', 'design-runner'], 'not_started');
  const research = await mk('research', ['design-job:research', 'design-runner'], 'not_started');
  const wireframe = await mk('wireframe', ['design-job:wireframe', 'design-runner'], 'blocked', [provision]);
  const art = await mk('art direction', ['design-stage:art_direction'], 'blocked', [research, wireframe]);
  const home = await mk('home build', ['design-job:home_build', 'design-runner'], 'blocked', [art]);
  const refine = await mk('refine', ['design-stage:refine'], 'blocked', [home]);
  const rest = await mk('rest build', ['design-job:rest_build', 'design-runner'], 'blocked', [refine]);
  const review = await mk('review', ['design-stage:review'], 'blocked', [rest]);
  const launch = await mk('launch readiness', ['design-job:launch_readiness', 'design-runner'], 'blocked', [review]);
  return { siteId: site.id, projectId: project.id, t: { provision, research, wireframe, art, home, refine, rest, review, launch } };
}

export async function teardownWorlds(f: DesignFixture, worlds: TrackWorld[]): Promise<void> {
  const { cleanupDesign } = await import('./cleanup');
  const siteIds = worlds.map((w) => w.siteId);
  await cleanupDesign({ siteIds });
  const tracks = await prisma.designTrack.findMany({ where: { site_id: { in: siteIds } }, select: { id: true } });
  if (tracks.length) await prisma.designTrack.deleteMany({ where: { id: { in: tracks.map((t) => t.id) } } });
  await prisma.task.deleteMany({ where: { project_id: { in: worlds.map((w) => w.projectId) } } });
  await prisma.projectTeamAssignment.deleteMany({ where: { project_id: { in: worlds.map((w) => w.projectId) } } });
  await prisma.project.deleteMany({ where: { id: { in: worlds.map((w) => w.projectId) } } });
  const ws = await prisma.designWorkerState.findUnique({ where: { id: 1 } });
  if (ws) await prisma.designWorkerState.update({ where: { id: 1 }, data: { configured_site_ids: ws.configured_site_ids.filter((s) => !siteIds.includes(s)) } });
  await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
  void f;
}
