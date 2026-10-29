/**
 * Designer Portal e2e fixture (W6.8): seeds and tears down ONE tagged world in the isolated gate database.
 *
 * Safety: refuses to run unless PW_DATABASE_URL names a database ending in _gate, _e2e or _test (never the
 * scratch DB, never a dev DB). Everything it creates is tagged and removed by teardown; the two singleton rows
 * (DesignPortalSettings, DesignWorkerState) are restored to what they were.
 *
 * The world: admin (the seeded admin@indelible.agency), designer A and B, the design-worker service user with an
 * enforced lane key, one client, three eleventy sites (A client preview, B production, C client preview), three
 * projects (A's project on site A, B's project on site B, A's second project on site C) and four tasks.
 */
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateApiKey } from '../../../lib/auth/api-keys';

export const PASSWORD = 'password123';
export const ADMIN_EMAIL = 'admin@indelible.agency';
export const WORKER_EMAIL = 'designer-worker@indelible.bot';
/** The sha the fixture preview serves in its design-preview-sha meta and the worker reports as preview_sha. */
export const BASE_SHA = 'c0ffee0000000000000000000000000000000001';
export const NEXT_SHA = 'c0ffee0000000000000000000000000000000002';

export interface DesignWorld {
  tag: string;
  prisma: PrismaClient;
  adminId: string;
  designerA: { id: string; email: string };
  designerB: { id: string; email: string };
  workerKey: string;
  clientId: string;
  siteA: { id: string; name: string };
  siteB: { id: string; name: string };
  siteC: { id: string; name: string };
  projectA: { id: string; name: string };
  projectB: { id: string; name: string };
  projectC: { id: string; name: string };
  tasks: { a1: Task; a2: Task; b1: Task; c1: Task };
  siteMainRoles: Record<string, string>;
  siteLiveUrls: Record<string, string>;
  /** What was there before (restored by teardown). */
  before: { settings: Record<string, unknown> | null; workerState: Record<string, unknown> | null; workerUserCreated: boolean };
}

export interface Task {
  id: string;
  title: string;
}

function requireGateUrl(): string {
  const url = process.env.PW_DATABASE_URL;
  if (!url) throw new Error('PW_DATABASE_URL is required for the Designer Portal e2e (the isolated gate database)');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/_(gate|e2e|test)$/.test(name) || /scratch/i.test(name)) {
    throw new Error(`Refusing to seed database "${name}": the design e2e only runs against a *_gate, *_e2e or *_test database`);
  }
  return url;
}

export function connect(): PrismaClient {
  return new PrismaClient({ datasourceUrl: requireGateUrl(), log: ['error'] });
}

export async function seedWorld(tag: string): Promise<DesignWorld> {
  const prisma = connect();
  const hash = await bcrypt.hash(PASSWORD, 10);

  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) throw new Error(`${ADMIN_EMAIL} is missing from the gate database (seed it first)`);

  const mkDesigner = (n: string) =>
    prisma.user.create({ data: { email: `dpe2e-${tag}-${n}@example.test`, password_hash: hash, name: `Designer ${n.toUpperCase()} ${tag}`, role: 'designer', is_active: true } });
  const [designerA, designerB] = [await mkDesigner('a'), await mkDesigner('b')];

  // The daemon's service user and an enforced lane key. Reuse the user when it exists; teardown only deletes what it made.
  let worker = await prisma.user.findUnique({ where: { email: WORKER_EMAIL } });
  const workerUserCreated = !worker;
  if (!worker) {
    worker = await prisma.user.create({ data: { email: WORKER_EMAIL, password_hash: hash, name: 'Designer Worker', role: 'pm', is_active: true } });
  }
  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  await prisma.apiKey.create({
    data: { user_id: worker.id, name: `dpe2e ${tag}`, key_hash: keyHash, key_prefix: keyPrefix, scopes: ['lane:design-worker', 'scope-mode:enforce'] },
  });

  const client = await prisma.client.create({ data: { name: `DPE2E ${tag} Co`, type: 'direct', status: 'active' } });
  const mkSite = (n: string) =>
    prisma.site.create({
      data: { name: `DPE2E ${tag} ${n}`, url: `https://${n.toLowerCase()}-${tag}.example.test`, client_id: client.id, design_portal_enabled: true, site_type: 'eleventy' },
    });
  const [siteA, siteB, siteC] = [await mkSite('Alpha'), await mkSite('Beta'), await mkSite('Gamma')];

  const fn = await prisma.function.create({ data: { name: `dpe2e-${tag}` } });
  const mkProject = async (n: string, siteId: string, designerId: string) => {
    const p = await prisma.project.create({ data: { name: `DPE2E ${tag} ${n} project`, client_id: client.id, site_id: siteId, status: 'in_progress' } });
    await prisma.projectTeamAssignment.create({ data: { project_id: p.id, user_id: designerId, function_id: fn.id } });
    return p;
  };
  const projectA = await mkProject('Alpha', siteA.id, designerA.id);
  const projectB = await mkProject('Beta', siteB.id, designerB.id);
  const projectC = await mkProject('Gamma', siteC.id, designerA.id);

  const mkTask = (title: string, project: { id: string }, site: { id: string }) =>
    prisma.task.create({ data: { title: `${title} ${tag}`, client_id: client.id, project_id: project.id, site_id: site.id, status: 'not_started' } });
  const [a1, a2, b1, c1] = [
    await mkTask('Update the state card', projectA, siteA),
    await mkTask('Tidy the footer', projectA, siteA),
    await mkTask('Rework the Beta hero', projectB, siteB),
    await mkTask('Gamma header spacing', projectC, siteC),
  ];

  // Singletons: remember, then set what the specs need.
  const settingsBefore = await prisma.designPortalSettings.findUnique({ where: { id: 1 } });
  const workerBefore = await prisma.designWorkerState.findUnique({ where: { id: 1 } });
  await prisma.designPortalSettings.upsert({
    where: { id: 1 },
    update: { enabled: true, designer_publish_mode: 'per_site', owner_user_id: admin.id },
    create: { id: 1, enabled: true, designer_publish_mode: 'per_site', owner_user_id: admin.id },
  });
  const siteMainRoles = { [siteA.id]: 'client_preview', [siteB.id]: 'production', [siteC.id]: 'client_preview' };
  const siteLiveUrls = {
    [siteA.id]: `https://alpha-${tag}.example.test`,
    [siteB.id]: `https://beta-${tag}.example.test`,
    [siteC.id]: `https://gamma-${tag}.example.test`,
  };
  const configured = [siteA.id, siteB.id, siteC.id];
  await prisma.designWorkerState.upsert({
    where: { id: 1 },
    update: { configured_site_ids: configured, site_main_roles: siteMainRoles, site_live_urls: siteLiveUrls, paused: false },
    create: { id: 1, configured_site_ids: configured, site_main_roles: siteMainRoles, site_live_urls: siteLiveUrls },
  });

  const t = (x: { id: string; title: string }): Task => ({ id: x.id, title: x.title });
  return {
    tag, prisma, adminId: admin.id,
    designerA: { id: designerA.id, email: designerA.email }, designerB: { id: designerB.id, email: designerB.email },
    workerKey: rawKey, clientId: client.id,
    siteA: { id: siteA.id, name: siteA.name }, siteB: { id: siteB.id, name: siteB.name }, siteC: { id: siteC.id, name: siteC.name },
    projectA: { id: projectA.id, name: projectA.name }, projectB: { id: projectB.id, name: projectB.name }, projectC: { id: projectC.id, name: projectC.name },
    tasks: { a1: t(a1), a2: t(a2), b1: t(b1), c1: t(c1) },
    siteMainRoles, siteLiveUrls,
    before: {
      settings: settingsBefore as unknown as Record<string, unknown> | null,
      workerState: workerBefore as unknown as Record<string, unknown> | null,
      workerUserCreated,
    },
  };
}

/** Removes everything seedWorld created (and everything the specs made on those tasks), restores the singletons. */
export async function teardownWorld(w: DesignWorld): Promise<void> {
  const { prisma } = w;
  const siteIds = [w.siteA.id, w.siteB.id, w.siteC.id];
  const projectIds = [w.projectA.id, w.projectB.id, w.projectC.id];
  const userIds = [w.designerA.id, w.designerB.id];

  // Follow-up tasks the portal filed in our projects, plus the seeded ones.
  const taskIds = (await prisma.task.findMany({ where: { project_id: { in: projectIds } }, select: { id: true } })).map((x) => x.id);

  const sessions = (await prisma.designSession.findMany({ where: { OR: [{ site_id: { in: siteIds } }, { task_id: { in: taskIds } }] }, select: { id: true } })).map((s) => s.id);
  const bySession = { session_id: { in: sessions } };
  await prisma.designEvent.deleteMany({ where: bySession });
  await prisma.designPin.deleteMany({ where: bySession });
  await prisma.designChange.deleteMany({ where: bySession });
  await prisma.designCommand.deleteMany({ where: bySession });
  // Sessions point at their last publish and the timer entry; clear those before the rows go.
  await prisma.designSession.updateMany({ where: { id: { in: sessions } }, data: { last_publish_id: null, timer_entry_id: null, diff_asset_id: null } });
  await prisma.designPublish.deleteMany({ where: bySession });
  await prisma.designAsset.deleteMany({ where: bySession });
  await prisma.designBudget.deleteMany({ where: { user_id: { in: userIds } } });
  await prisma.designSession.deleteMany({ where: { id: { in: sessions } } });

  await prisma.timeEntry.deleteMany({ where: { task_id: { in: taskIds } } });
  await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
  await prisma.notification.deleteMany({ where: { OR: [{ user_id: { in: [...userIds, w.adminId] }, created_at: { gte: new Date(Date.now() - 6 * 3600_000) }, type: { in: ['design_published', 'design_rolled_back', 'design_publish_requested'] as never } }] } }).catch(() => undefined);
  await deleteTaskDeps(prisma, taskIds);
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.projectTeamAssignment.deleteMany({ where: { project_id: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.function.deleteMany({ where: { name: `dpe2e-${w.tag}` } });
  await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
  await prisma.client.deleteMany({ where: { id: w.clientId } });
  await prisma.apiKey.deleteMany({ where: { name: `dpe2e ${w.tag}` } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (w.before.workerUserCreated) await prisma.user.deleteMany({ where: { email: WORKER_EMAIL } }).catch(() => undefined);

  // Singletons back to what they were.
  if (w.before.settings) {
    const { id: _id, updated_at: _u, ...rest } = w.before.settings as Record<string, unknown>;
    void _id; void _u;
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: rest as never });
  } else {
    await prisma.designPortalSettings.deleteMany({ where: { id: 1 } });
  }
  if (w.before.workerState) {
    const { id: _id, ...rest } = w.before.workerState as Record<string, unknown>;
    void _id;
    await prisma.designWorkerState.update({ where: { id: 1 }, data: rest as never });
  } else {
    await prisma.designWorkerState.deleteMany({ where: { id: 1 } });
  }
  await prisma.$disconnect();
}

/** Rows that point at a task without cascading (receipts, activity). Best effort: absent tables are skipped. */
async function deleteTaskDeps(prisma: PrismaClient, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  const p = prisma as unknown as Record<string, { deleteMany?: (a: unknown) => Promise<unknown> } | undefined>;
  for (const model of ['taskReceipt', 'taskClaimEvent']) {
    await p[model]?.deleteMany?.({ where: { task_id: { in: taskIds } } }).catch(() => undefined);
  }
}

export function newTag(): string {
  return crypto.randomBytes(3).toString('hex');
}

/** A 1x1 PNG, enough for the asset route's magic-byte check. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
