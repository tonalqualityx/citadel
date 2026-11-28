// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { syncEngineRows } from '@/lib/recurring-work/engine-sync';

describe.skipIf(!SCRATCH)('engine rows sync (real database)', () => {
  const tag = crypto.randomBytes(3).toString('hex');
  const startedAt = new Date();
  const ids = { client: '', siteA: '', siteB: '', sop: '', planA: '', planB: '', schedule: '' };

  const rowsFor = (sourceIds: string[]) =>
    prisma.recurringWork.findMany({ where: { kind: 'engine', source_id: { in: sourceIds } }, orderBy: { created_at: 'asc' } });

  beforeAll(async () => {
    ids.client = (await prisma.client.create({ data: { name: `Engine Client ${tag}` } })).id;
    ids.sop = (await prisma.sop.create({ data: { title: `Engine SOP ${tag}` } })).id;
    ids.planA = (await prisma.maintenancePlan.create({ data: { name: `Plan A ${tag}`, rate: 99, frequency: 'monthly', sops: { create: { sop_id: ids.sop } } } })).id;
    // plan B has no SOPs: Citadel makes no tasks for it, but its upkeep still repeats, so it still gets rows
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

  it('creates one row per schedule and one per site on a plan, under the client', async () => {
    await syncEngineRows();
    const rows = await rowsFor([ids.schedule, ids.planA]);
    expect(rows).toHaveLength(3);
    const blog = rows.find((r) => r.source_kind === 'troubador_schedule');
    expect(blog).toMatchObject({ title: `Blog ${tag}`, client_id: ids.client, site_id: ids.siteA, schedule_text: '2 posts a week', is_active: true, paused_on_purpose: false, is_plumbing: false });
    const maint = rows.filter((r) => r.source_kind === 'maintenance_plan');
    expect(maint.map((r) => r.site_id).sort()).toEqual([ids.siteA, ids.siteB].sort());
    expect(maint.every((r) => r.client_id === ids.client && r.schedule_text === 'monthly' && r.is_active)).toBe(true);
  });

  it('a second sync with nothing changed creates nothing', async () => {
    const before = await rowsFor([ids.schedule, ids.planA]);
    await syncEngineRows();
    const after = await rowsFor([ids.schedule, ids.planA]);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => r.updated_at.getTime())).toEqual(before.map((r) => r.updated_at.getTime()));
  });

  it('pausing, ending and switching plans keep the rows in step and delete nothing', async () => {
    await prisma.troubadorSchedule.update({ where: { id: ids.schedule }, data: { status: 'paused' } });
    await prisma.site.update({ where: { id: ids.siteB }, data: { maintenance_plan_id: ids.planB } });
    await syncEngineRows();
    let blog = (await rowsFor([ids.schedule]))[0];
    expect(blog).toMatchObject({ is_active: true, paused_on_purpose: true });
    const oldB = (await rowsFor([ids.planA])).find((r) => r.site_id === ids.siteB);
    expect(oldB?.is_active).toBe(false);
    const newB = (await rowsFor([ids.planB])).find((r) => r.site_id === ids.siteB);
    expect(newB).toMatchObject({ is_active: true, schedule_text: 'quarterly', client_id: ids.client });

    await prisma.troubadorSchedule.update({ where: { id: ids.schedule }, data: { status: 'ended' } });
    await syncEngineRows();
    blog = (await rowsFor([ids.schedule]))[0];
    expect(blog.is_active).toBe(false);

    await prisma.troubadorSchedule.update({ where: { id: ids.schedule }, data: { status: 'active' } });
    await syncEngineRows();
    const back = await rowsFor([ids.schedule]);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ is_active: true, paused_on_purpose: false });
  });

  it('two syncs at once never make the same row twice', async () => {
    await prisma.site.update({ where: { id: ids.siteA }, data: { maintenance_plan_id: ids.planB } });
    await Promise.all([syncEngineRows(), syncEngineRows()]);
    const rows = (await rowsFor([ids.planB])).filter((r) => r.site_id === ids.siteA);
    expect(rows).toHaveLength(1);
  });
});
