// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { syncEngineRows } from '@/lib/recurring-work/engine-sync';

describe.skipIf(!SCRATCH)('engine rows sync (real database)', () => {
  const tag = crypto.randomBytes(3).toString('hex');
  const startedAt = new Date();
  const ids = { client: '', siteA: '', siteB: '', sop: '', planA: '', planB: '', schedule: '' };

  const rowsFor = (sourceIds: string[]) =>
    prisma.recurringWork.findMany({ where: { kind: 'engine', source_id: { in: sourceIds } }, orderBy: { created_at: 'asc' } });

  beforeAll(async () => {
    // the plan rows are owned by Bast, and owner_id is a foreign key to users
    await prisma.user.upsert({
      where: { id: BAST_USER_ID },
      update: {},
      create: { id: BAST_USER_ID, email: `bast-engine-${tag}@example.test`, password_hash: 'x', name: 'Bast' },
    });
    ids.client = (await prisma.client.create({ data: { name: `Engine Client ${tag}` } })).id;
    ids.sop = (await prisma.sop.create({ data: { title: `Engine SOP ${tag}` } })).id;
    ids.planA = (await prisma.maintenancePlan.create({ data: { name: `Plan A ${tag}`, rate: 99, frequency: 'monthly', sops: { create: { sop_id: ids.sop } } } })).id;
    // plan B has no SOPs: Citadel makes no tasks for it, but its upkeep still repeats, so it still gets a row
    ids.planB = (await prisma.maintenancePlan.create({ data: { name: `Plan B ${tag}`, rate: 199, frequency: 'quarterly' } })).id;
    ids.siteA = (await prisma.site.create({ data: { name: `Site A ${tag}`, client_id: ids.client, maintenance_plan_id: ids.planA } })).id;
    ids.siteB = (await prisma.site.create({ data: { name: `Site B ${tag}`, client_id: ids.client, maintenance_plan_id: ids.planA } })).id;
    ids.schedule = (
      await prisma.troubadorSchedule.create({
        data: { name: `Blog ${tag}`, client_id: ids.client, site_id: ids.siteA, publish_per_week: 2, start_date: new Date() },
      })
    ).id;
  });

  afterAll(async () => {
    // the sync is a full reconcile, so it may also have made rows for other scratch data during this run
    await prisma.recurringWork.deleteMany({ where: { kind: 'engine', created_at: { gte: startedAt } } });
    if (ids.schedule) await prisma.troubadorSchedule.deleteMany({ where: { id: ids.schedule } });
    await prisma.site.deleteMany({ where: { id: { in: [ids.siteA, ids.siteB].filter(Boolean) } } });
    await prisma.maintenancePlan.deleteMany({ where: { id: { in: [ids.planA, ids.planB].filter(Boolean) } } });
    if (ids.sop) await prisma.sop.deleteMany({ where: { id: ids.sop } });
    if (ids.client) await prisma.client.deleteMany({ where: { id: ids.client } });
  });

  it('creates one row per schedule and ONE row per plan, however many sites are on it', async () => {
    await syncEngineRows();
    const rows = await rowsFor([ids.schedule, ids.planA, ids.planB]);
    expect(rows).toHaveLength(3);
    const blog = rows.find((r) => r.source_kind === 'troubador_schedule');
    expect(blog).toMatchObject({ title: `Blog ${tag}`, client_id: ids.client, site_id: ids.siteA, schedule_text: '2 posts a week', is_active: true, paused_on_purpose: false, is_plumbing: false });
    const a = rows.find((r) => r.source_id === ids.planA);
    expect(a).toMatchObject({
      kind: 'engine', source_kind: 'maintenance_plan', title: `Plan A ${tag} maintenance`, client_id: null, site_id: null, owner_id: BAST_USER_ID,
      group_label: 'Client sites', schedule_text: 'monthly', is_active: true, paused_on_purpose: false,
    });
    expect(a?.produces).toBe(`a maintenance task each month for each of the 2 sites on Plan A ${tag}`);
    // plan B has no SOPs and no sites, and still has its row
    const b = rows.find((r) => r.source_id === ids.planB);
    expect(b).toMatchObject({ is_active: true, schedule_text: 'quarterly', client_id: null, site_id: null });
    expect(b?.produces).toBe(`a maintenance task each quarter for each site on Plan B ${tag}, none on it yet`);
  });

  it('a second sync with nothing changed creates nothing', async () => {
    const before = await rowsFor([ids.schedule, ids.planA, ids.planB]);
    await syncEngineRows();
    const after = await rowsFor([ids.schedule, ids.planA, ids.planB]);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => r.updated_at.getTime())).toEqual(before.map((r) => r.updated_at.getTime()));
  });

  it('pausing, ending and moving a site keep the rows in step, and deactivating a plan deletes nothing', async () => {
    await prisma.troubadorSchedule.update({ where: { id: ids.schedule }, data: { status: 'paused' } });
    await prisma.site.update({ where: { id: ids.siteB }, data: { maintenance_plan_id: ids.planB } });
    await syncEngineRows();
    let blog = (await rowsFor([ids.schedule]))[0];
    expect(blog).toMatchObject({ is_active: true, paused_on_purpose: true });
    const planA = await rowsFor([ids.planA]);
    const planB = await rowsFor([ids.planB]);
    expect(planA).toHaveLength(1);
    expect(planA[0].produces).toContain('the 1 site on');
    expect(planB).toHaveLength(1);
    expect(planB[0].produces).toContain('the 1 site on');

    await prisma.troubadorSchedule.update({ where: { id: ids.schedule }, data: { status: 'ended' } });
    await prisma.maintenancePlan.update({ where: { id: ids.planA }, data: { is_active: false } });
    await syncEngineRows();
    blog = (await rowsFor([ids.schedule]))[0];
    expect(blog.is_active).toBe(false);
    const planAOff = await rowsFor([ids.planA]);
    expect(planAOff).toHaveLength(1);
    expect(planAOff[0].is_active).toBe(false);

    await prisma.troubadorSchedule.update({ where: { id: ids.schedule }, data: { status: 'active' } });
    await prisma.maintenancePlan.update({ where: { id: ids.planA }, data: { is_active: true } });
    await syncEngineRows();
    const back = await rowsFor([ids.schedule, ids.planA]);
    expect(back).toHaveLength(2);
    expect(back.every((r) => r.is_active)).toBe(true);
  });

  it('two syncs at once never make the same row twice', async () => {
    await prisma.recurringWork.deleteMany({ where: { kind: 'engine', source_id: { in: [ids.planA, ids.planB] } } });
    await Promise.all([syncEngineRows(), syncEngineRows()]);
    expect(await rowsFor([ids.planA])).toHaveLength(1);
    expect(await rowsFor([ids.planB])).toHaveLength(1);
  });
});
