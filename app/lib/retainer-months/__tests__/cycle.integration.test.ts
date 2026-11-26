// @vitest-environment node
/**
 * Retainer months against a real, migrated Postgres. Skipped unless DATABASE_URL names a scratch database:
 *
 *   DATABASE_URL=postgresql://.../citadel_scratch npx vitest run lib/retainer-months/__tests__/cycle.integration
 *
 * One monthly charter with a recurring row, an open retainer task due next month and logged time: the cycle on the
 * 26th backfills this month (planned, no task) and drafts next month with Mike's planning task; usage counts the
 * charter's time and lists work outside the plan; confirming closes the planning task; the next cycle closes the month.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const url = process.env.DATABASE_URL ?? '';
const d = url.includes('scratch') ? describe : describe.skip;

d('retainer month cycle against Postgres', () => {
  // Imported lazily so the prisma client is built only when the suite runs.
  let db: typeof import('@/lib/db/prisma').prisma;
  let svc: typeof import('../service');
  const tag = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  let createdMike = false;

  beforeAll(async () => {
    db = (await import('@/lib/db/prisma')).prisma;
    svc = await import('../service');
    if (!(await db.user.findUnique({ where: { id: MIKE_USER_ID } }))) {
      await db.user.create({ data: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
      createdMike = true;
    }
    const client = await db.client.create({ data: { name: `Retainer client ${tag}`, retainer_hours: 10 } });
    const charter = await db.charter.create({
      data: { name: `Retainer ${tag}`, client_id: client.id, billing_period: 'monthly', start_date: new Date('2026-01-01'), created_by_id: MIKE_USER_ID },
    });
    await db.recurringWork.create({ data: { charter_id: charter.id, title: `Monthly report ${tag}`, kind: 'citadel_task', cadence: 'monthly', is_active: true } as never });
    const due = await db.task.create({ data: { title: `Plugin updates ${tag}`, client_id: client.id, charter_id: charter.id, status: 'not_started', due_date: new Date(2026, 11, 10) } as never });
    const loose = await db.task.create({ data: { title: `Menu photo swap ${tag}`, client_id: client.id, is_retainer_work: true, status: 'done' } as never });
    await db.timeEntry.create({ data: { user_id: MIKE_USER_ID, task_id: loose.id, started_at: new Date(2026, 10, 20, 10), duration: 90 } as never });
    Object.assign(ids, { client: client.id, charter: charter.id, due: due.id, loose: loose.id });
  });

  afterAll(async () => {
    if (!db) return;
    await db.retainerMonth.deleteMany({ where: { charter_id: ids.charter } });
    await db.timeEntry.deleteMany({ where: { task_id: { in: [ids.loose, ids.due] } } });
    await db.task.deleteMany({ where: { client_id: ids.client } });
    await db.recurringWork.deleteMany({ where: { charter_id: ids.charter } });
    await db.charter.deleteMany({ where: { id: ids.charter } });
    await db.client.deleteMany({ where: { id: ids.client } });
    if (createdMike) await db.user.deleteMany({ where: { id: MIKE_USER_ID } });
    await db.$disconnect();
  });

  it('backfills this month, drafts next month with a planning task, counts usage, confirms and closes', async () => {
    const s1 = await svc.runRetainerMonthCycle(new Date(2026, 10, 26, 1, 20));
    expect(s1.errors).toEqual([]);

    const nov = await db.retainerMonth.findUniqueOrThrow({ where: { charter_id_month: { charter_id: ids.charter, month: '2026-11' } }, include: { items: true } });
    expect(nov.state).toBe('planned');
    expect(nov.note).toBe('used the draft');
    expect(nov.planning_task_id).toBeNull();
    expect(Number(nov.hours_allotted)).toBe(10);

    const dec = await db.retainerMonth.findUniqueOrThrow({ where: { charter_id_month: { charter_id: ids.charter, month: '2026-12' } }, include: { items: true } });
    expect(dec.state).toBe('planning');
    expect(dec.items.map((i) => i.title).sort()).toEqual([`Monthly report ${tag}`, `Plugin updates ${tag}`].sort());
    const task = await db.task.findUniqueOrThrow({ where: { id: dec.planning_task_id! } });
    expect(task.assignee_id).toBe(MIKE_USER_ID);
    expect(task.charter_id).toBe(ids.charter);
    expect(task.description).toContain('10 h of retainer time');
    expect(task.description).toContain('Finalized by: a step Mike takes.');

    // Second run the same day changes nothing.
    const again = await svc.runRetainerMonthCycle(new Date(2026, 10, 26, 2, 0));
    expect(again).toMatchObject({ drafted: 0, planningTasks: 0, errors: [] });

    const usage = await svc.monthUsage(await svc.loadMonth(nov.id));
    expect(usage.used_minutes).toBe(90);
    expect(usage.outside_minutes).toBe(90);

    const listed = await svc.listMonths('2026-11');
    expect(listed.retainers.some((r) => r.charter_id === ids.charter)).toBe(true);

    await svc.confirmMonth(dec.id, MIKE_USER_ID);
    expect((await db.task.findUniqueOrThrow({ where: { id: dec.planning_task_id! } })).status).toBe('done');

    const s3 = await svc.runRetainerMonthCycle(new Date(2026, 11, 2, 1, 20));
    expect(s3.errors).toEqual([]);
    const closed = await db.retainerMonth.findUniqueOrThrow({ where: { id: nov.id } });
    expect(closed.state).toBe('closed');
    expect(closed.used_minutes).toBe(90);
  });
});
