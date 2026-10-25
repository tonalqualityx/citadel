// @vitest-environment node
/**
 * The Herba shape against a real, migrated Postgres: a charter with three done tasks, a client with
 * open tasks that hang off no project, a retainer project, and projects/tasks/tags the brief
 * excludes. Skipped unless WAIT_INTEGRATION_DATABASE_URL is set (throwaway database only).
 *
 *   WAIT_INTEGRATION_DATABASE_URL=postgresql://... npx vitest run lib/engagement/brief.integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { scopeWhere, OPEN_TASK_STATUSES } from './brief';
import { prismaStallStore, detectStalls } from '@/lib/waits/stalls';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { runSweep } from '@/lib/waits/sweeper';

const url = process.env.WAIT_INTEGRATION_DATABASE_URL;
const d = url ? describe : describe.skip;

d('engagement scope and stalls against Postgres', () => {
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const longAgo = new Date(Date.now() - 60 * 86_400_000);

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    const user = await db.user.create({ data: { email: `eng-${tag}@example.test`, password_hash: 'x', name: 'Eng Int', role: 'admin' } });
    const client = await db.client.create({ data: { name: `Herba shaped ${tag}` } });
    const charter = await db.charter.create({
      data: { name: `Retainer ${tag}`, client_id: client.id, billing_period: 'monthly', start_date: new Date('2026-01-01'), created_by_id: user.id },
    });
    const retainer = await db.project.create({ data: { name: `Retainer work ${tag}`, client_id: client.id, is_retainer: true } });
    const ordinary = await db.project.create({ data: { name: `Ordinary project ${tag}`, client_id: client.id } });
    const excluded = await db.project.create({ data: { name: `Directory ${tag}`, client_id: client.id, is_retainer: true } });
    Object.assign(ids, { user: user.id, client: client.id, charter: charter.id, retainer: retainer.id, ordinary: ordinary.id, excluded: excluded.id });
    const mk = async (key: string, data: Record<string, unknown>) => {
      const t = await db.task.create({ data: { title: `${key} ${tag}`, client_id: client.id, created_at: longAgo, ...data } as never });
      ids[key] = t.id;
    };
    for (const n of [1, 2, 3]) await mk(`charter-done-${n}`, { charter_id: charter.id, status: 'done' });
    await mk('charter-open', { charter_id: charter.id, status: 'not_started' });
    await mk('loose-1', { status: 'not_started' });
    await mk('loose-2', { status: 'in_progress', started_at: longAgo });
    await mk('loose-tagged', { status: 'not_started', tags: ['kava-bar-directory'] });
    await mk('loose-excluded-id', { status: 'not_started' });
    await mk('retainer-1', { project_id: retainer.id, status: 'review', client_approved_at: longAgo });
    await mk('ordinary-1', { project_id: ordinary.id, status: 'not_started' });
    await mk('excluded-project-1', { project_id: excluded.id, status: 'not_started' });
    await mk('abandoned-loose', { status: 'abandoned' });
    await db.engagementBrief.create({
      data: {
        client_id: client.id,
        charter_id: charter.id,
        label: `Herba ${tag}`,
        owner_mode: 'live',
        scope: {
          include_client_tasks_without_project: true,
          include_retainer_projects: true,
          exclude: { project_ids: [excluded.id], task_ids: [ids['loose-excluded-id']], tags: ['kava-bar-directory'] },
        },
        stall_rules: { not_started_bd: 5, in_progress_bd: 5, review_approved_bd: 2 },
      },
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('resolves the open tasks: charter + no-project client tasks + retainer projects, minus exclusions', async () => {
    const brief = await db.engagementBrief.findUniqueOrThrow({ where: { charter_id: ids.charter } });
    const where = scopeWhere(brief)!;
    const rows = await db.task.findMany({ where: { AND: [where, { status: { in: [...OPEN_TASK_STATUSES] } }] }, select: { id: true } });
    const got = new Set(rows.map((r) => r.id));
    const want = ['charter-open', 'loose-1', 'loose-2', 'retainer-1'].map((k) => ids[k]);
    expect([...got].sort()).toEqual(want.sort());
    // The excluded ones, the ordinary project and the done charter tasks are not there.
    for (const k of ['loose-tagged', 'loose-excluded-id', 'ordinary-1', 'excluded-project-1', 'charter-done-1', 'abandoned-loose']) {
      expect(got.has(ids[k])).toBe(false);
    }
  });

  it('detects stalls: dry sweep writes nothing, live sweep opens waits once and notifies', async () => {
    const owner = prismaOwnerLookups(db as unknown as Parameters<typeof prismaOwnerLookups>[0]);
    const deps = (dry: boolean) => ({ store: prismaSweepStore(db), owner, switchIsOn: async () => false, stalls: prismaStallStore(db), dry });
    const waitsBefore = await db.wait.count({ where: { template_key: 'engagement.stalled', client_id: ids.client } });
    const dryRun = await runSweep(deps(true), { dryRun: true });
    expect(dryRun.stalls!.findings.filter((f) => [ids['charter-open'], ids['loose-1'], ids['loose-2'], ids['retainer-1']].includes(f.task_id)).length).toBe(4);
    expect(await db.wait.count({ where: { template_key: 'engagement.stalled', client_id: ids.client } })).toBe(waitsBefore);

    await runSweep(deps(false));
    const opened = await db.wait.findMany({ where: { template_key: 'engagement.stalled', client_id: ids.client } });
    expect(opened.map((w) => w.task_id).sort()).toEqual(['charter-open', 'loose-1', 'loose-2', 'retainer-1'].map((k) => ids[k]).sort());
    // The same pass fired each one: rung 1 landed (owner falls to Mike here, which is visibility only).
    await runSweep(deps(false));
    expect(await db.wait.count({ where: { template_key: 'engagement.stalled', client_id: ids.client } })).toBe(opened.length);
    const again = await detectStalls(new Date(), {}, { store: prismaSweepStore(db), stalls: prismaStallStore(db) });
    expect(again.findings.filter((f) => f.brief_id && opened.some((w) => w.task_id === f.task_id))).toHaveLength(0);
  });

  it('writes one in-app Notification per rung for engagement.stalled, to a real user', async () => {
    const { buildWaitData } = await import('@/lib/waits/templates');
    const store = prismaSweepStore(db);
    const { wait } = await store.insertIdempotent(
      buildWaitData({ template_key: 'engagement.stalled', subject: `notify ${tag}`, started_at: longAgo, due_at: longAgo, owner_user_id: ids.user, client_id: ids.client, idempotency_key: `notify:${tag}` })
    );
    const owner = prismaOwnerLookups(db as unknown as Parameters<typeof prismaOwnerLookups>[0]);
    await runSweep({ store, owner, switchIsOn: async () => false });
    await runSweep({ store, owner, switchIsOn: async () => false }); // same day: the rung is not due again
    const rows = await db.notification.findMany({ where: { entity_type: 'wait', entity_id: wait.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: ids.user, type: 'system_alert', email_sent: false, slack_sent: false });
  });
});
