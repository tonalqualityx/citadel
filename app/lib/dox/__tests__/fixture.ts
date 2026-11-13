/** Shared seed helpers for the Dox integration tests (a real scratch Postgres). Everything is tagged and removed by `cleanup`. */
import { prisma } from '@/lib/db/prisma';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import type { AuthPayload } from '@/lib/auth/middleware';

export const BOT_ID = BOT_USER_IDS[0];
export const dox = (): AuthPayload => ({ userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'kd', lane: 'dox', laneEnforced: true });
export const mikeSession = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
export const chatLane = (): AuthPayload => ({ userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'kc', lane: 'bast-chat', laneEnforced: true });
export const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

export interface Fx {
  tag: string;
  clientId: string;
  staffIds: string[];
  projectIds: string[];
  taskIds: string[];
  mkProject(name: string, extra?: Record<string, unknown>): Promise<string>;
  mkTask(title: string, extra?: Record<string, unknown>): Promise<string>;
  mkStaff(name: string, role?: 'pm' | 'admin' | 'tech'): Promise<string>;
  /** Make sure the project has a brief, and start a LIVE pass on it (Dox's "I am working on this project now" record; a dry pass writes nothing). Pass {mode: 'dry'} in extra for a dry one. Returns the pass id. */
  openPass(projectId: string, lane?: string | null, extra?: Record<string, unknown>): Promise<string>;
  /** Start a card pass (live unless {mode: 'dry'}) on a released card with no project. Returns the pass id. */
  openCardPass(taskId: string, lane?: string | null, extra?: Record<string, unknown>): Promise<string>;
  cleanup(): Promise<void>;
}

export async function makeFixture(prefix: string): Promise<Fx> {
  const tag = `${prefix}${Date.now()}`;
  await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
  await prisma.user.upsert({ where: { id: BOT_ID }, update: {}, create: { id: BOT_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
  const clientId = (await prisma.client.create({ data: { name: `${tag} Co`, type: 'direct', status: 'active' } })).id;
  const fx: Fx = {
    tag,
    clientId,
    staffIds: [],
    projectIds: [],
    taskIds: [],
    async mkProject(name, extra = {}) {
      const p = await prisma.project.create({ data: { name: `${tag} ${name}`, client_id: clientId, status: 'ready', ...extra } as never });
      fx.projectIds.push(p.id);
      return p.id;
    },
    async mkTask(title, extra = {}) {
      const t = await prisma.task.create({ data: { title: `${tag} ${title}`, ...extra } as never });
      fx.taskIds.push(t.id);
      return t.id;
    },
    async mkStaff(name, role = 'pm') {
      const u = await prisma.user.create({ data: { email: `${name.toLowerCase()}-${tag}@example.test`, password_hash: 'x', name, role } });
      fx.staffIds.push(u.id);
      return u.id;
    },
    async openPass(projectId, lane = 'dox', extra = {}) {
      const brief = (await prisma.engagementBrief.findUnique({ where: { project_id: projectId } })) ?? (await prisma.engagementBrief.create({ data: { project_id: projectId, label: `${tag} brief`, cadence: 'auto', owner_mode: 'dry', allowed_actions: [] } }));
      const pass = await prisma.engagementPass.create({ data: { brief_id: brief.id, mode: 'live', lane, ...extra } as never });
      return pass.id;
    },
    async openCardPass(taskId, lane = 'dox', extra = {}) {
      const pass = await prisma.engagementPass.create({ data: { brief_id: null, task_id: taskId, mode: 'live', kind: 'setup', lane, ...extra } as never });
      return pass.id;
    },
    async cleanup() {
      await prisma.engagementPass.deleteMany({ where: { task_id: { in: fx.taskIds } } });
      await prisma.notification.deleteMany({ where: { entity_id: { in: fx.taskIds } } });
      await prisma.notification.deleteMany({ where: { user_id: { in: fx.staffIds } } });
      const briefs = await prisma.engagementBrief.findMany({ where: { project_id: { in: fx.projectIds } }, select: { id: true } });
      await prisma.engagementPass.deleteMany({ where: { brief_id: { in: briefs.map((b) => b.id) } } });
      await prisma.engagementBrief.deleteMany({ where: { project_id: { in: fx.projectIds } } });
      await prisma.wait.deleteMany({ where: { OR: [{ project_id: { in: fx.projectIds } }, { task_id: { in: fx.taskIds } }] } });
      await prisma.activityLog.deleteMany({ where: { entity_id: { in: [...fx.taskIds, ...fx.projectIds] } } });
      await prisma.task.deleteMany({ where: { project_id: { in: fx.projectIds } } });
      await prisma.task.deleteMany({ where: { id: { in: fx.taskIds } } });
      await prisma.project.deleteMany({ where: { id: { in: fx.projectIds } } });
      await prisma.client.deleteMany({ where: { id: clientId } });
      await prisma.user.deleteMany({ where: { id: { in: fx.staffIds } } });
    },
  };
  return fx;
}
