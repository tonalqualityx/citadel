// @vitest-environment node
/**
 * Slice 7c against a real Postgres: effort, unknowns and drain guesses from his own time-entry history, written by the
 * nightly learn step to his home_item_state rows only and shown on his screen. Skips unless DATABASE_URL names the
 * scratch Postgres on localhost:55433. It makes its own users, SOPs, tasks and time entries and removes only those. Run
 * on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s7c_it npx vitest run lib/home/__tests__/slice7c.integration.test.ts
 *
 * Auth is the only mock. The loaders, the selection, the run, the stores and the route are real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const auth = vi.hoisted(() => ({ who: null as null | { userId: string; role: string; email: string; via: string } }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => auth.who),
}));

import { prisma } from '@/lib/db/prisma';
import { GET as getHome } from '@/app/api/home/route';
import { runLearn } from '../learn/run';
import { taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
/** A Tuesday, 10:00 Eastern (EST). */
const TUE = new Date('2026-12-01T15:00:00Z');
const WED = new Date('2026-12-02T15:00:00Z');

interface Found {
  key: string;
  title: string;
  effort: string;
  minutes: number;
  opened?: { effort_basis?: string | null };
}

describe.skipIf(!SCRATCH)('Slice 7c: time guesses (real database)', () => {
  const tag = `s7c-${Date.now()}`;
  const adminId = randomUUID();
  const otherId = randomUUID();
  const ids = [adminId, otherId];
  const sopA = randomUUID();
  const sopB = randomUUID();
  const sopC = randomUUID();
  const clientId = randomUUID();
  const taskIds: string[] = [];
  const at = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 15, 0, 0));
  const t = (title: string, over: Record<string, unknown> = {}) =>
    prisma.task.create({
      data: { title, status: 'not_started', tags: [], assignee_id: adminId, created_by_id: null, client_id: clientId, promised_to: 'The client', created_at: new Date('2026-11-24T14:00:00Z'), ...over },
    });
  const entry = (userId: string, taskId: string, minutes: number, n: number) =>
    prisma.timeEntry.create({
      data: { user_id: userId, task_id: taskId, started_at: at(n), ended_at: new Date(at(n).getTime() + minutes * 60_000), duration: minutes, is_running: false },
    });
  const done = async (owner: string, sop: string, title: string) => {
    const row = await prisma.task.create({
      data: { title, status: 'done', tags: [], assignee_id: owner, created_by_id: null, sop_id: sop, completed_at: new Date('2026-10-20T15:00:00Z') },
    });
    taskIds.push(row.id);
    return row.id;
  };
  let o1 = '';
  let o2 = '';
  let o3 = '';
  let o4 = '';
  let otherOpen = '';

  async function taskRows() {
    return JSON.stringify(await prisma.task.findMany({ orderBy: { id: 'asc' } }));
  }
  async function screen(): Promise<Found[]> {
    auth.who = { userId: adminId, role: 'admin', email: `${adminId}@example.test`, via: 'session' };
    const res = await getHome();
    expect(res.status).toBe(200);
    const found: Found[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.key === 'string' && typeof o.title === 'string' && typeof o.effort === 'string') found.push(o as unknown as Found);
        Object.values(o).forEach(walk);
      }
    };
    walk(await res.json());
    return found;
  }
  const byTitle = (items: Found[], title: string) => items.find((i) => i.title === title);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 7c', role: 'admin' },
        { id: otherId, email: `other-${tag}@example.test`, password_hash: 'x', name: 'Other 7c', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: 'America/New_York' },
        { user_id: otherId, home_view: 'home', timezone: 'America/New_York' },
      ],
    });
    await prisma.client.create({ data: { id: clientId, name: `Client 7c ${tag}`, status: 'active' } });
    await prisma.sop.createMany({
      data: [
        { id: sopA, title: `SOP A ${tag}` },
        { id: sopB, title: `SOP B ${tag}` },
        { id: sopC, title: `SOP C ${tag}` },
      ],
    });

    // SOP A: three of his done tasks qualify (counted 20, 30, 40). The noise around them must be ignored: a 1 minute and
    // a 2 minute timer, and a 3,169 minute timer left running. A fourth done task has only noise and does not count.
    const a1 = await done(adminId, sopA, `A1 ${tag}`);
    const a2 = await done(adminId, sopA, `A2 ${tag}`);
    const a3 = await done(adminId, sopA, `A3 ${tag}`);
    const a4 = await done(adminId, sopA, `A4 ${tag}`);
    await entry(adminId, a1, 20, 1);
    await entry(adminId, a1, 1, 2);
    await entry(adminId, a1, 3169, 3);
    await entry(adminId, a2, 30, 4);
    await entry(adminId, a2, 2, 5);
    await entry(adminId, a3, 40, 6);
    await entry(adminId, a4, 1, 7);
    await entry(adminId, a4, 2, 8);

    // SOP B: only two of his done tasks qualify, and the other user has three that must not count for him.
    const b1 = await done(adminId, sopB, `B1 ${tag}`);
    const b2 = await done(adminId, sopB, `B2 ${tag}`);
    await entry(adminId, b1, 25, 9);
    await entry(adminId, b2, 35, 10);
    for (const [i, m] of [50, 60, 70].entries()) {
      const x = await done(otherId, sopB, `OB${i} ${tag}`);
      await entry(otherId, x, m, 11 + i);
    }

    // SOP C: three done tasks of his, but one of his entries sits at 481 minutes and another at 2, so two qualify.
    const c1 = await done(adminId, sopC, `C1 ${tag}`);
    const c2 = await done(adminId, sopC, `C2 ${tag}`);
    const c3 = await done(adminId, sopC, `C3 ${tag}`);
    await entry(adminId, c1, 15, 20);
    await entry(adminId, c2, 481, 21);
    await entry(adminId, c3, 25, 22);

    o1 = (await t(`Open on SOP A ${tag}`, { sop_id: sopA })).id;
    o2 = (await t(`Estimated on SOP A ${tag}`, { sop_id: sopA, estimated_minutes: 15 })).id;
    o3 = (await t(`Call Gene about the quote ${tag}`)).id;
    o4 = (await t(`Open on SOP B ${tag}`, { sop_id: sopB, description: 'Do the usual.' })).id;
    otherOpen = (await t(`Other user open ${tag}`, { sop_id: sopA, assignee_id: otherId })).id;
    taskIds.push(o1, o2, o3, o4, otherOpen);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TUE);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.homeMeasure.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.timeEntry.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.sop.deleteMany({ where: { id: { in: [sopA, sopB, sopC] } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  let before = '';
  let beforeOtherStates = 0;

  it('before the nightly step: no guess words, no basis lines, no guess rows', async () => {
    before = await taskRows();
    beforeOtherStates = await prisma.homeItemState.count({ where: { user_id: otherId } });
    const items = await screen();
    for (const title of [`Open on SOP A ${tag}`, `Call Gene about the quote ${tag}`]) {
      const it = byTitle(items, title);
      expect(it, title).toBeTruthy();
      expect(it?.effort).toBe('About 30 minutes');
      expect(it?.opened?.effort_basis).toBeUndefined();
    }
    expect(await prisma.homeItemState.count({ where: { user_id: adminId, effort_source: { not: null } } })).toBe(0);
  });

  it('the nightly step gives a history guess with its n, and ignores the noise entries', async () => {
    const res = await runLearn(prisma, adminId, TUE, { dryRun: false });
    expect(res.guesses).toMatchObject({ considered: 4 });
    const row = await prisma.homeItemState.findFirst({ where: { user_id: adminId, item_key: taskKey(o1) } });
    expect(row).toMatchObject({ effort_minutes: 30, effort_source: 'history', effort_basis_n: 3, unknowns: 'none', drain: null });
    expect(row?.guessed_at).toBeTruthy();
  });

  it('a history that needs the other user, or only two tasks, or an entry over 480 minutes, is not enough', async () => {
    const b = await prisma.homeItemState.findFirst({ where: { user_id: adminId, item_key: taskKey(o4) } });
    expect(b).toMatchObject({ effort_minutes: 30, effort_source: 'kind', effort_basis_n: null });
  });

  it('a kind guess with a call and some unknowns', async () => {
    const row = await prisma.homeItemState.findFirst({ where: { user_id: adminId, item_key: taskKey(o3) } });
    expect(row).toMatchObject({ effort_minutes: 30, effort_source: 'kind', unknowns: 'some', drain: 'call' });
  });

  it('a task with estimated_minutes gets no minutes guess', async () => {
    const row = await prisma.homeItemState.findFirst({ where: { user_id: adminId, item_key: taskKey(o2) } });
    expect(row?.effort_minutes).toBeNull();
    expect(row?.effort_source).toBeNull();
  });

  it('his screen shows the guesses, says where each came from, and shows no line for a set time', async () => {
    const items = await screen();
    const one = byTitle(items, `Open on SOP A ${tag}`);
    expect(one?.minutes).toBe(30);
    expect(one?.effort).toBe('About 30 minutes');
    expect(one?.opened?.effort_basis).toBe('Time guess: from 3 similar finished tasks.');
    const set = byTitle(items, `Estimated on SOP A ${tag}`);
    expect(set?.minutes).toBe(15);
    expect(set?.effort).toBe('About 15 minutes');
    expect(set?.opened?.effort_basis).toBeUndefined();
    const call = byTitle(items, `Call Gene about the quote ${tag}`);
    expect(call?.effort).toBe('About 30 minutes, some unknowns, a call');
    expect(call?.opened?.effort_basis).toBe('Time guess: from the kind of work.');
    const kind = byTitle(items, `Open on SOP B ${tag}`);
    expect(kind?.effort).toBe('About 30 minutes');
    expect(kind?.opened?.effort_basis).toBe('Time guess: from the kind of work.');
  });

  it('no Task row changed', async () => {
    expect(await taskRows()).toBe(before);
  });

  it('the other user is untouched: no rows, and his open task on the same SOP has no guess', async () => {
    expect(await prisma.homeItemState.count({ where: { user_id: otherId } })).toBe(beforeOtherStates);
    expect(await prisma.homeItemState.findFirst({ where: { user_id: otherId, item_key: taskKey(otherOpen) } })).toBeNull();
  });

  it('a person who sets an estimate later wins at once, even before the next night', async () => {
    await prisma.task.update({ where: { id: o1 }, data: { estimated_minutes: 12 } });
    const items = await screen();
    const one = byTitle(items, `Open on SOP A ${tag}`);
    expect(one?.minutes).toBe(12);
    expect(one?.opened?.effort_basis).toBeUndefined();
    // The next night clears the stored guess for it.
    await runLearn(prisma, adminId, WED, { dryRun: false });
    const row = await prisma.homeItemState.findFirst({ where: { user_id: adminId, item_key: taskKey(o1) } });
    expect(row?.effort_minutes).toBeNull();
    expect(row?.effort_source).toBeNull();
    expect((await prisma.task.findUnique({ where: { id: o1 } }))?.estimated_minutes).toBe(12);
  });
});
