import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/work/ask-closure', () => ({ closeAsksForTask: vi.fn(async () => ({})) }));
vi.mock('@/lib/db/prisma', () => {
  const m = () => ({ findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), count: vi.fn() });
  const prisma: Record<string, unknown> = {
    charter: m(), retainerMonth: m(), retainerMonthItem: m(), task: m(), timeEntry: m(),
  };
  prisma.$transaction = (cb: (tx: unknown) => unknown) => cb(prisma);
  return { prisma };
});

import { prisma } from '@/lib/db/prisma';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { addItem, charterMonths, confirmMonth, draftMonth, listMonths, monthUsage, removeItem, runRetainerMonthCycle, updateItem, type CharterWithRows } from '../service';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const CH = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';

const charter = (o: Record<string, unknown> = {}) =>
  ({
    id: CH, name: 'Kava retainer', client_id: 'cl', status: 'active', is_deleted: false, billing_period: 'monthly', budget_hours: 10,
    client: { id: 'cl', name: 'Kava Bars', retainer_hours: null },
    scheduled_tasks: [{ id: 'rw1', is_active: true, kind: 'citadel_task', title: null, sop: { title: 'Monthly report', energy_estimate: 3, mystery_factor: 'none', battery_impact: 'energizing', estimated_minutes: null } }],
    ...o,
  }) as unknown as CharterWithRows;

beforeEach(() => {
  vi.resetAllMocks();
  p.retainerMonth.findUnique.mockResolvedValue(null);
  p.retainerMonth.findMany.mockResolvedValue([]);
  p.retainerMonth.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data }));
  p.retainerMonth.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data }));
  p.task.findMany.mockResolvedValue([]);
  p.task.create.mockResolvedValue({ id: 'pt1' });
  p.task.updateMany.mockResolvedValue({ count: 1 });
  p.charter.count.mockResolvedValue(1);
  p.charter.findMany.mockResolvedValue([]);
});

describe('draftMonth', () => {
  it('drafts a planning month with items and one planning task for Mike', async () => {
    const r = await draftMonth(charter(), '2026-12', { planningTask: true });
    expect(r.created).toBe(true);
    expect(r.planningTask).toBe(true);
    expect(p.retainerMonth.create.mock.calls[0][0].data).toMatchObject({ charter_id: CH, month: '2026-12', hours_allotted: 10, state: 'planning' });
    const items = p.retainerMonthItem.createMany.mock.calls[0][0].data;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Monthly report', estimate_min_low: 60, estimate_min_high: 60, recurring_work_id: 'rw1', retainer_month_id: 'm1' });
    const t = p.task.create.mock.calls[0][0].data;
    expect(t).toMatchObject({ title: 'Kava Bars: plan December 2026 retainer work', assignee_id: MIKE_USER_ID, client_id: 'cl', charter_id: CH });
    expect(t.due_date).toEqual(new Date(2026, 11, 1));
    expect(t.description).toContain('Finalized by: a step Mike takes.');
    expect(p.retainerMonth.update.mock.calls[0][0].data).toEqual({ planning_task_id: 'pt1' });
  });

  it('carries forward last month\'s undone work: an open task, and named work that never got a task', async () => {
    p.retainerMonth.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'nov',
      items: [
        { title: 'Open item', estimate_min_low: 30, estimate_min_high: 60, recurring_work_id: null, task_id: 't1', task: { id: 't1', status: 'in_progress', is_deleted: false } },
        { title: 'Done item', estimate_min_low: 30, estimate_min_high: 60, recurring_work_id: null, task_id: 't2', task: { id: 't2', status: 'done', is_deleted: false } },
        { title: 'Named, no task', estimate_min_low: 60, estimate_min_high: 90, recurring_work_id: null, task_id: null, task: null },
        { title: 'Monthly report', estimate_min_low: 60, estimate_min_high: 60, recurring_work_id: 'rw1', task_id: null, task: null },
      ],
    });
    await draftMonth(charter(), '2026-12', { planningTask: false });
    const titles = p.retainerMonthItem.createMany.mock.calls[0][0].data.map((i: { title: string }) => i.title);
    expect(titles.sort()).toEqual(['Monthly report', 'Named, no task', 'Open item'].sort());
  });

  it('is idempotent through the unique key', async () => {
    p.retainerMonth.findUnique.mockResolvedValue({ id: 'old' });
    const r = await draftMonth(charter(), '2026-12', { planningTask: true });
    expect(r.created).toBe(false);
    expect(p.retainerMonth.create).not.toHaveBeenCalled();
    expect(p.task.create).not.toHaveBeenCalled();
  });

  it('falls back to the client hours when the charter has none', async () => {
    await draftMonth(charter({ budget_hours: null, client: { id: 'cl', name: 'K', retainer_hours: 6 } }), '2026-12', { planningTask: false });
    expect(p.retainerMonth.create.mock.calls[0][0].data.hours_allotted).toBe(6);
  });

  it('a backfilled month is created planned, "used the draft", with no planning task', async () => {
    const now = new Date(2026, 10, 9);
    const r = await draftMonth(charter(), '2026-11', { planningTask: true, usedTheDraft: true, now });
    expect(r.planningTask).toBe(false);
    expect(p.task.create).not.toHaveBeenCalled();
    expect(p.retainerMonth.create.mock.calls[0][0].data).toMatchObject({ state: 'planned', note: 'used the draft', planned_at: now });
  });
});

describe('runRetainerMonthCycle', () => {
  beforeEach(() => {
    p.charter.findMany.mockResolvedValue([charter()]);
  });

  it('on the 24th drafts nothing ahead and closes nothing', async () => {
    p.retainerMonth.findMany.mockResolvedValue([{ id: 'cur', month: '2026-11', state: 'planned' }]);
    const s = await runRetainerMonthCycle(new Date(2026, 10, 24, 1, 20));
    expect(s).toEqual({ drafted: 0, planningTasks: 0, autoPlanned: 0, closed: 0, errors: [] });
  });

  it('on the 25th drafts next month with a planning task', async () => {
    p.retainerMonth.findMany.mockResolvedValue([{ id: 'cur', month: '2026-11', state: 'planned' }]);
    const s = await runRetainerMonthCycle(new Date(2026, 10, 25, 1, 20));
    expect(s).toMatchObject({ drafted: 1, planningTasks: 1, errors: [] });
    expect(p.retainerMonth.create.mock.calls[0][0].data.month).toBe('2026-12');
  });

  it('on the 1st drafts a missing current month with a planning task', async () => {
    const s = await runRetainerMonthCycle(new Date(2026, 11, 1, 1, 20));
    expect(s).toMatchObject({ drafted: 1, planningTasks: 1 });
    expect(p.retainerMonth.create.mock.calls[0][0].data).toMatchObject({ month: '2026-12', state: 'planning' });
  });

  it('after the 1st a missing current month is backfilled as planned with no planning task', async () => {
    const s = await runRetainerMonthCycle(new Date(2026, 10, 9, 1, 20));
    expect(s).toMatchObject({ drafted: 1, planningTasks: 0 });
    expect(p.task.create).not.toHaveBeenCalled();
    expect(p.retainerMonth.create.mock.calls[0][0].data).toMatchObject({ month: '2026-11', state: 'planned', note: 'used the draft' });
  });

  it('after the 1st a current month still in planning becomes planned, no person', async () => {
    p.retainerMonth.findMany.mockImplementation(async (a: { where: { charter_id?: string } }) =>
      a.where.charter_id ? [{ id: 'cur', month: '2026-12', state: 'planning' }] : []);
    const now = new Date(2026, 11, 2, 1, 20);
    const s = await runRetainerMonthCycle(now);
    expect(s.autoPlanned).toBe(1);
    expect(p.retainerMonth.update).toHaveBeenCalledWith({ where: { id: 'cur' }, data: { state: 'planned', planned_at: now, planned_by_id: null, note: 'used the draft' } });
  });

  it('auto-planning a month closes its open planning task', async () => {
    p.retainerMonth.findMany.mockImplementation(async (a: { where: { charter_id?: string } }) =>
      a.where.charter_id ? [{ id: 'cur', month: '2026-12', state: 'planning', planning_task_id: 'pt9' }] : []);
    const now = new Date(2026, 11, 2, 1, 20);
    await runRetainerMonthCycle(now);
    expect(p.task.updateMany).toHaveBeenCalledWith({
      where: { id: 'pt9', status: { notIn: ['done', 'abandoned'] } },
      data: { status: 'done', completed_at: now },
    });
  });

  it('closes earlier months with their numbers frozen', async () => {
    p.retainerMonth.findMany.mockImplementation(async (a: { where: { month?: unknown; charter_id?: string } }) =>
      a.where.charter_id
        ? [{ id: 'cur', month: '2026-12', state: 'planned' }]
        : [{ id: 'old', month: '2026-11', state: 'planned', charter_id: CH, planning_task_id: null, items: [], charter: { name: 'Kava', client_id: 'cl' } }]);
    p.timeEntry.findMany.mockResolvedValue([{ duration: 90, task: { id: 't', title: 'T', charter_id: CH, is_retainer_work: false } }]);
    const s = await runRetainerMonthCycle(new Date(2026, 11, 2, 1, 20));
    expect(s.closed).toBe(1);
    expect(p.retainerMonth.update).toHaveBeenCalledWith({ where: { id: 'old' }, data: { state: 'closed', used_minutes: 90, outside_minutes: 90 } });
  });

  it('one charter failing does not stop the others', async () => {
    p.charter.findMany.mockResolvedValue([charter({ id: 'bad', name: 'Bad' }), charter()]);
    p.retainerMonth.findMany.mockImplementation(async (a: { where: { charter_id?: string } }) => {
      if (a.where.charter_id === 'bad') throw new Error('db down');
      return [];
    });
    const s = await runRetainerMonthCycle(new Date(2026, 11, 1, 1, 20));
    expect(s.errors).toEqual(['Bad: db down']);
    expect(s.drafted).toBe(1);
  });
});

describe('confirmMonth', () => {
  it('plans the month and marks an open planning task done', async () => {
    p.retainerMonth.findUnique.mockResolvedValue({ id: 'm1', state: 'planning', planning_task_id: 'pt1' });
    const now = new Date();
    await confirmMonth('m1', ME, now);
    expect(p.retainerMonth.update.mock.calls[0][0].data).toMatchObject({ state: 'planned', planned_at: now, planned_by_id: ME });
    expect(p.task.updateMany).toHaveBeenCalledWith({ where: { id: 'pt1', status: { notIn: ['done', 'abandoned'] } }, data: { status: 'done', completed_at: now } });
  });
  it('refuses a closed month', async () => {
    p.retainerMonth.findUnique.mockResolvedValue({ id: 'm1', state: 'closed' });
    await expect(confirmMonth('m1', ME)).rejects.toMatchObject({ statusCode: 409 });
    expect(p.retainerMonth.update).not.toHaveBeenCalled();
  });
});

describe('items', () => {
  it('adds an item at the end, refuses low > high, refuses a closed month', async () => {
    p.retainerMonth.findUnique.mockResolvedValue({ id: 'm1', state: 'planning', items: [{ position: 0 }, { position: 1 }] });
    p.retainerMonthItem.create.mockImplementation(async ({ data }: { data: object }) => data);
    expect(await addItem('m1', { title: 'Blog', estimate_min_low: 60, estimate_min_high: 90 })).toMatchObject({ position: 2 });
    await expect(addItem('m1', { title: 'Blog', estimate_min_low: 90, estimate_min_high: 60 })).rejects.toMatchObject({ statusCode: 400 });
    p.retainerMonth.findUnique.mockResolvedValue({ id: 'm1', state: 'closed', items: [] });
    await expect(addItem('m1', { title: 'Blog', estimate_min_low: 1, estimate_min_high: 2 })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('update and remove check the month and the closed state', async () => {
    p.retainerMonthItem.findUnique.mockResolvedValue({ id: 'i1', retainer_month_id: 'm1', estimate_min_low: 30, estimate_min_high: 60, retainer_month: { state: 'planned' } });
    p.retainerMonthItem.update.mockResolvedValue({ id: 'i1' });
    await updateItem('m1', 'i1', { estimate_min_high: 90 });
    await expect(updateItem('m1', 'i1', { estimate_min_low: 100 })).rejects.toMatchObject({ statusCode: 400 });
    await removeItem('m1', 'i1');
    expect(p.retainerMonthItem.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
    await expect(removeItem('other', 'i1')).rejects.toMatchObject({ statusCode: 404 });
    p.retainerMonthItem.findUnique.mockResolvedValue({ id: 'i1', retainer_month_id: 'm1', estimate_min_low: 1, estimate_min_high: 2, retainer_month: { state: 'closed' } });
    await expect(removeItem('m1', 'i1')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('monthUsage', () => {
  const month = (o: Record<string, unknown> = {}) =>
    ({ id: 'm1', charter_id: CH, month: '2026-11', state: 'planned', planning_task_id: null, used_minutes: null, outside_minutes: null, items: [{ id: 'i1', task_id: 'a' }], charter: { client_id: 'cl' }, ...o }) as never;
  const rows = [
    { duration: 60, task: { id: 'a', title: 'A', charter_id: CH, is_retainer_work: true } },
    { duration: 30, task: { id: 'b', title: 'B', charter_id: null, is_retainer_work: true } },
  ];
  it('counts the no-charter retainer time with one monthly charter and lists outside work', async () => {
    p.charter.count.mockResolvedValue(1);
    p.timeEntry.findMany.mockResolvedValue(rows);
    const u = await monthUsage(month());
    expect(u).toMatchObject({ used_minutes: 90, outside_minutes: 30, unassigned_minutes: 0, item_minutes: { i1: 60 } });
    expect(u.outside).toEqual([{ id: 'b', title: 'B', minutes: 30 }]);
  });
  it('with two monthly charters the no-charter time is returned as unassigned', async () => {
    p.charter.count.mockResolvedValue(2);
    p.timeEntry.findMany.mockResolvedValue(rows);
    expect(await monthUsage(month())).toMatchObject({ used_minutes: 60, outside_minutes: 0, unassigned_minutes: 30 });
  });
  it('a closed month returns its frozen numbers', async () => {
    p.charter.count.mockResolvedValue(1);
    p.timeEntry.findMany.mockResolvedValue(rows);
    expect(await monthUsage(month({ state: 'closed', used_minutes: 500, outside_minutes: 120 }))).toMatchObject({ used_minutes: 500, outside_minutes: 120, frozen: true });
  });
});

describe('upcoming', () => {
  const row = (month: string, state: string) => ({
    id: `m-${month}`, charter_id: CH, month, state, hours_allotted: 10, planning_task_id: null, planned_at: null, planned_by_id: null, note: null,
    used_minutes: null, outside_minutes: null, created_at: new Date(2026, 10, 25), items: [],
    charter: { name: 'Kava retainer', client_id: 'cl', client: { name: 'Kava Bars' } },
  });
  beforeEach(() => {
    p.timeEntry.findMany.mockResolvedValue([]);
  });

  it('charterMonths returns next month as upcoming when its row exists', async () => {
    p.retainerMonth.findMany.mockResolvedValue([row('2026-12', 'planning'), row('2026-11', 'planned')]);
    const r = await charterMonths(CH, new Date(2026, 10, 26));
    expect(r.current?.month).toBe('2026-11');
    expect(r.upcoming).toMatchObject({ month: '2026-12', state: 'planning', created_at: new Date(2026, 10, 25).toISOString() });
    expect(r.past).toEqual([]);
  });

  it('charterMonths upcoming is null before next month is drafted', async () => {
    p.retainerMonth.findMany.mockResolvedValue([row('2026-11', 'planned')]);
    expect((await charterMonths(CH, new Date(2026, 10, 20))).upcoming).toBeNull();
  });

  it('listMonths returns the following month rows as upcoming', async () => {
    p.retainerMonth.findMany.mockImplementation(async (a: { where: { month: string } }) =>
      a.where.month === '2026-11' ? [row('2026-11', 'planned')] : [row('2026-12', 'planning')]);
    const r = await listMonths('2026-11');
    expect(r.retainers.map((x) => x.month)).toEqual(['2026-11']);
    expect(r.upcoming.map((x) => [x.month, x.state])).toEqual([['2026-12', 'planning']]);
  });
});
