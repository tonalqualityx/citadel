// @vitest-environment node
/**
 * Slice 2c against a real Postgres: the nightly keeper's Arc writes, each behind its own switch in home_keeper_settings.
 * It checks what the keeper wrote and, as important, everything it did not write: with no settings row nothing outside
 * the home rows changes, each switch does only its own writes, Sabeen's task and the arc holding it never change, and
 * every kind of write can be undone.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433 (it writes rows, and removes only the rows it made).
 * Run on a clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s2c npx vitest run lib/home/__tests__/slice2c.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { runHomeAct, runHomeUndo } from '../act';
import { runKeeper } from '../keeper/run';
import { taskKey } from '../item-key';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

const URL = process.env.DATABASE_URL ?? '';
const SCRATCH = /localhost:55433/.test(URL);
const TZ = 'America/New_York';
const night = (n: number) => new Date(`2026-11-${String(11 + n).padStart(2, '0')}T07:35:00Z`);
const dayOf = (n: number) => `2026-11-${String(11 + n).padStart(2, '0')}`;
const iso = (s: string) => new Date(s);
const BANNED = /\b(priority|priorities|overdue)\b/i;
const DASH = /[‒-―−]|\s-{1,2}\s/;

describe.skipIf(!SCRATCH)('Slice 2c: the keeper arc writes (real database)', () => {
  const tag = `s2c-${Date.now()}`;
  const ownerId = randomUUID();
  const sabeenId = randomUUID();
  const userIds = [ownerId, sabeenId];
  let madeBast = false;
  const taskIds: string[] = [];
  const arcIds: string[] = [];
  const clientIds: string[] = [];
  const t: Record<string, string> = {};
  const a: Record<string, string> = {};
  let rowanId = '';

  const mkTask = async (label: string, assignee: string | null, over: Record<string, unknown> = {}) => {
    const row = await prisma.task.create({
      data: { title: label, assignee_id: assignee, created_by_id: ownerId, status: 'not_started', needs_review: false, tags: [tag], created_at: iso('2026-10-05T14:00:00Z'), ...over },
    });
    taskIds.push(row.id);
    t[label] = row.id;
    return row;
  };
  const mkArc = async (label: string, over: Record<string, unknown> = {}) => {
    const row = await prisma.arc.create({ data: { name: `${label} (${tag})`, ...over } });
    arcIds.push(row.id);
    a[label] = row.id;
    return row;
  };
  const backdate = async (arcId: string, tasks: string[], at: string) => {
    await prisma.$executeRaw`UPDATE arcs SET updated_at = ${iso(at)} WHERE id = ${arcId}::uuid`;
    for (const id of tasks) await prisma.$executeRaw`UPDATE tasks SET updated_at = ${iso(at)} WHERE id = ${id}::uuid`;
  };
  const arcRow = (id: string) => prisma.arc.findUniqueOrThrow({ where: { id } });
  const taskRow = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const setSwitches = (data: { arcs_create?: boolean; arcs_close?: boolean; arcs_link_tasks?: boolean }) =>
    prisma.homeKeeperSettings.upsert({ where: { user_id: ownerId }, update: data, create: { user_id: ownerId, ...data } });

  async function taskSnapshot(ids: string[]) {
    const rows = await prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, arc_id: true, updated_at: true, status: true, assignee_id: true } });
    return rows.map((r) => ({ id: r.id, arc_id: r.arc_id, updated_at: r.updated_at.getTime(), status: r.status, assignee_id: r.assignee_id })).sort((x, y) => x.id.localeCompare(y.id));
  }
  async function arcSnapshot(ids: string[]) {
    const rows = await prisma.arc.findMany({ where: { id: { in: ids } } });
    return rows.map((r) => ({ id: r.id, name: r.name, closed_at: r.closed_at?.getTime() ?? null, updated_at: r.updated_at.getTime() })).sort((x, y) => x.id.localeCompare(y.id));
  }
  const keeperActions = (kinds?: string[]) =>
    prisma.homeAction.findMany({ where: { user_id: ownerId, source: 'keeper', ...(kinds ? { action: { in: kinds } } : {}) }, orderBy: { created_at: 'asc' } });
  const arcActionKinds = ['keeper_arc_create', 'keeper_arc_close', 'keeper_arc_link'];

  let sabeenSnapshot: Awaited<ReturnType<typeof taskSnapshot>>;
  let sabeenArcSnapshot: Awaited<ReturnType<typeof arcSnapshot>>;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner S2C', role: 'admin' },
        { id: sabeenId, email: `sabeen-${tag}@example.test`, password_hash: 'x', name: 'Sabeen S2C', role: 'tech' },
      ],
    });
    if (!(await prisma.user.findUnique({ where: { id: BAST_USER_ID } }))) {
      await prisma.user.create({ data: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast S2C', role: 'tech' } });
      madeBast = true;
    }
    await prisma.userPreference.createMany({ data: [{ user_id: ownerId, home_view: 'home', timezone: TZ }, { user_id: sabeenId, home_view: 'overlook', timezone: TZ }] });

    const rowan = await prisma.client.create({ data: { name: `Rowan Pottery ${tag}`, status: 'active' as never } });
    rowanId = rowan.id;
    clientIds.push(rowan.id);
    // A client group with no arc: three of his open tasks (one with a real outside date so it leads the day),
    // one of Sabeen's and one Bast stopped on (neither may ever be linked).
    await mkTask('Rowan one', ownerId, { client_id: rowan.id, hard_due_at: iso('2026-11-14T00:00:00Z'), hard_due_source: 'show date' });
    await mkTask('Rowan two', ownerId, { client_id: rowan.id });
    await mkTask('Rowan three', ownerId, { client_id: rowan.id });
    await mkTask('Rowan Sabeen', sabeenId, { client_id: rowan.id });
    await mkTask('Rowan bot', BAST_USER_ID, { client_id: rowan.id, tags: [tag, 'needs-mike'] });

    // Arcs to close: all done, stale (40 days), and one holding Sabeen's open task (stale too, so only her task protects it).
    await mkArc('All done arc');
    await mkTask('Done one', ownerId, { arc_id: a['All done arc'], status: 'done', completed_at: iso('2026-11-08T12:00:00Z') });
    await mkTask('Done two', ownerId, { arc_id: a['All done arc'], status: 'done', completed_at: iso('2026-11-09T12:00:00Z') });
    await backdate(a['All done arc'], [t['Done one'], t['Done two']], '2026-11-01T12:00:00Z');

    await mkArc('Stale arc');
    await mkTask('Stale one', ownerId, { arc_id: a['Stale arc'] });
    await mkTask('Stale two', ownerId, { arc_id: a['Stale arc'] });
    await backdate(a['Stale arc'], [t['Stale one'], t['Stale two']], '2026-09-20T12:00:00Z');

    await mkArc('Sabeen arc');
    await mkTask('Sabeen step', sabeenId, { arc_id: a['Sabeen arc'] });
    await mkTask('Sabeen arc mine', ownerId, { arc_id: a['Sabeen arc'] });
    await mkTask('Sabeen arc done', ownerId, { arc_id: a['Sabeen arc'], status: 'done' });
    await backdate(a['Sabeen arc'], [t['Sabeen step'], t['Sabeen arc mine'], t['Sabeen arc done']], '2026-09-20T12:00:00Z');

    // A fresh arc (touched yesterday, open task): not stale, not done.
    await mkArc('Fresh arc');
    await mkTask('Fresh one', ownerId, { arc_id: a['Fresh arc'] });

    // The arc that is today's arc on night 3: all done, so it would be the first to close if it were not today's.
    await mkArc("Today's arc");
    await mkTask('Todays one', ownerId, { arc_id: a["Today's arc"], status: 'done' });
    await backdate(a["Today's arc"], [t['Todays one']], '2026-10-01T12:00:00Z');
    await prisma.homeDay.create({
      data: { user_id: ownerId, date: new Date(`${dayOf(3)}T00:00:00Z`), group_key: `arc:${a["Today's arc"]}`, group_label: "Today's arc", arc_id: a["Today's arc"], step_item_keys: [], quick_item_keys: [] },
    });

    sabeenSnapshot = await taskSnapshot([t['Sabeen step'], t['Rowan Sabeen']]);
    sabeenArcSnapshot = await arcSnapshot([a['Sabeen arc']]);
  });

  afterAll(async () => {
    // Only what this file made. Arcs it made itself (the keeper's) are found by name; tasks are un-linked by deleting them.
    const keeperMade = await prisma.arc.findMany({ where: { description: "Made by the home screen's nightly sort.", client_id: { in: clientIds } }, select: { id: true } });
    const allArcs = [...arcIds, ...keeperMade.map((x) => x.id)];
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.arc.deleteMany({ where: { id: { in: allArcs } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: madeBast ? [...userIds, BAST_USER_ID] : userIds } } });
    await prisma.$disconnect();
  });

  it('no settings row: the dry run lists what it would make and close, under its own key, and writes nothing', async () => {
    const before = { arcs: await prisma.arc.count(), tasks: await taskSnapshot(taskIds), arcSnap: await arcSnapshot(arcIds), actions: await prisma.homeAction.count(), runs: await prisma.homeKeeperRun.count() };
    const r = await runKeeper(prisma, ownerId, night(0), { dryRun: true });
    expect(r.arcs?.switches).toEqual({ arcs_create: false, arcs_close: false, arcs_link_tasks: false });
    const make = r.arcs!.would_make;
    expect(make).toHaveLength(1);
    expect(make[0].name).toBe(`Rowan Pottery ${tag}`);
    expect(make[0].client_id).toBe(rowanId);
    expect(make[0].project_id).toBeNull();
    expect(make[0].group_key).toBe(`client:${rowanId}`);
    expect(new Set(make[0].task_ids)).toEqual(new Set([t['Rowan one'], t['Rowan two'], t['Rowan three']]));
    expect(make[0].line).toBe(`Made the arc Rowan Pottery ${tag} with 3 of your tasks.`);
    const close = r.arcs!.would_close.filter((c) => arcIds.includes(c.arc_id));
    expect(close.map((c) => [c.arc_id, c.reason]).sort()).toEqual(
      [
        [a['All done arc'], 'all_done'],
        [a["Today's arc"], 'all_done'], // night 0 has no day row for it, so it is closable here
        [a['Stale arc'], 'stale'],
      ].sort(),
    );
    expect(close.find((c) => c.arc_id === a['All done arc'])?.line).toBe(`Closed the arc All done arc (${tag}): every step is done.`);
    expect(close.find((c) => c.arc_id === a['Stale arc'])?.line).toBe(`Closed the arc Stale arc (${tag}): the 2 tasks left are still tracked.`);
    expect(close.some((c) => c.arc_id === a['Sabeen arc'])).toBe(false);
    expect(close.some((c) => c.arc_id === a['Fresh arc'])).toBe(false);
    // The plan itself is the 2a plan, unchanged in shape.
    expect(Object.keys(r.plan!).sort()).toEqual(['counts', 'date', 'dates', 'lines', 'owner_id', 'stagger']);
    expect(r.arcs_written).toBeUndefined();
    expect(r.action_ids).toEqual([]);
    expect({ arcs: await prisma.arc.count(), tasks: await taskSnapshot(taskIds), arcSnap: await arcSnapshot(arcIds), actions: await prisma.homeAction.count(), runs: await prisma.homeKeeperRun.count() }).toEqual(before);
  });

  it('no settings row: the real run writes no Arc row and no Task row, and writes no arc counts or lines', async () => {
    expect(await prisma.homeKeeperSettings.count({ where: { user_id: ownerId } })).toBe(0);
    const arcsBefore = await prisma.arc.count();
    const tasksBefore = await taskSnapshot(taskIds);
    const arcSnapBefore = await arcSnapshot(arcIds);
    const r = await runKeeper(prisma, ownerId, night(0), { dryRun: false });
    expect(r.already_ran).toBeUndefined();
    expect(r.arcs_written).toBeUndefined();
    expect(r.arcs).toBeUndefined();
    expect(await prisma.arc.count()).toBe(arcsBefore);
    expect(await taskSnapshot(taskIds)).toEqual(tasksBefore);
    expect(await arcSnapshot(arcIds)).toEqual(arcSnapBefore);
    expect(await keeperActions(arcActionKinds)).toHaveLength(0);
    const run = await prisma.homeKeeperRun.findFirstOrThrow({ where: { user_id: ownerId } });
    expect(Object.keys(run.counts as object).sort()).toEqual(['dates_read', 'dates_set_aside', 'skipped_changed', 'stagger']);
  });

  it('a settings row with every switch false does the same', async () => {
    await setSwitches({ arcs_create: false, arcs_close: false, arcs_link_tasks: false });
    const arcsBefore = await prisma.arc.count();
    const tasksBefore = await taskSnapshot(taskIds);
    const r = await runKeeper(prisma, ownerId, night(1), { dryRun: false });
    expect(r.already_ran).toBeUndefined();
    expect(r.arcs_written).toBeUndefined();
    expect(await prisma.arc.count()).toBe(arcsBefore);
    expect(await taskSnapshot(taskIds)).toEqual(tasksBefore);
    expect(await keeperActions(arcActionKinds)).toHaveLength(0);
  });

  let createActionId = '';
  let madeArcId = '';

  it('arcs_create alone: makes one arc for the day group, links his three open tasks, and nothing else', async () => {
    await setSwitches({ arcs_create: true, arcs_close: false, arcs_link_tasks: false });
    const arcsBefore = await prisma.arc.count();
    const mineBefore = await arcSnapshot(arcIds);
    const untouched = Object.values(t).filter((id) => ![t['Rowan one'], t['Rowan two'], t['Rowan three']].includes(id));
    const untouchedBefore = await taskSnapshot(untouched);
    const r = await runKeeper(prisma, ownerId, night(2), { dryRun: false });
    expect(r.arcs_written?.switches).toEqual({ arcs_create: true, arcs_close: false, arcs_link_tasks: false });
    expect(r.arcs_written?.made).toHaveLength(1);
    expect(r.arcs_written?.closed).toEqual([]);
    expect(await prisma.arc.count()).toBe(arcsBefore + 1);
    const made = await prisma.arc.findFirstOrThrow({ where: { client_id: rowanId } });
    madeArcId = made.id;
    expect(made.name).toBe(`Rowan Pottery ${tag}`);
    expect(made.description).toBe("Made by the home screen's nightly sort.");
    expect(made.project_id).toBeNull();
    expect(made.closed_at).toBeNull();
    for (const k of ['Rowan one', 'Rowan two', 'Rowan three']) expect((await taskRow(t[k])).arc_id).toBe(made.id);
    // Never Sabeen's task, never the bot task, nothing else, no existing arc changed, nothing closed.
    expect((await taskRow(t['Rowan Sabeen'])).arc_id).toBeNull();
    expect((await taskRow(t['Rowan bot'])).arc_id).toBeNull();
    expect(await taskSnapshot(untouched)).toEqual(untouchedBefore);
    expect(await arcSnapshot(arcIds)).toEqual(mineBefore);
    const acts = await keeperActions(arcActionKinds);
    expect(acts.map((x) => x.action)).toEqual(['keeper_arc_create']);
    const act = acts[0];
    createActionId = act.id;
    expect(act.undo_until!.getTime() - night(2).getTime()).toBe(72 * 3600 * 1000);
    const after = act.after as { line: string; details: string[] };
    expect(after.line).toBe(`Made the arc Rowan Pottery ${tag} with 3 of your tasks.`);
    expect(after.details).toHaveLength(3);
    expect(BANNED.test(after.line) || DASH.test(after.line)).toBe(false);
    const run = await prisma.homeKeeperRun.findFirstOrThrow({ where: { user_id: ownerId, date: new Date(dayOf(2)) } });
    expect(run.counts).toMatchObject({ arcs_made: 1, arcs_closed: 0 });
  });

  it('with the arc made, a later night makes no second arc for that client', async () => {
    const arcsBefore = await prisma.arc.count();
    const dry = await runKeeper(prisma, ownerId, night(2), { dryRun: true });
    expect(dry.arcs!.would_make).toEqual([]);
    const r = await runKeeper(prisma, ownerId, night(3), { dryRun: false });
    expect(r.arcs_written?.made).toEqual([]);
    expect(await prisma.arc.count()).toBe(arcsBefore);
    // Switch for closing was off: nothing closed, even today's arc and the stale ones.
    for (const id of arcIds) expect((await arcRow(id)).closed_at).toBeNull();
  });

  it('Undo of the create closes the arc and unlinks only tasks still pointing at it; nothing is deleted', async () => {
    // He moved one task to another arc since: that one stays where he put it.
    await prisma.task.update({ where: { id: t['Rowan three'] }, data: { arc_id: a['Fresh arc'] } });
    const arcsBefore = await prisma.arc.count();
    const r = await runHomeUndo(prisma, ownerId, createActionId, night(3));
    expect(r.ok).toBe(true);
    expect(await prisma.arc.count()).toBe(arcsBefore);
    expect((await arcRow(madeArcId)).closed_at).not.toBeNull();
    expect((await taskRow(t['Rowan one'])).arc_id).toBeNull();
    expect((await taskRow(t['Rowan two'])).arc_id).toBeNull();
    expect((await taskRow(t['Rowan three'])).arc_id).toBe(a['Fresh arc']);
    await expect(runHomeUndo(prisma, ownerId, createActionId, night(3))).rejects.toMatchObject({ code: 'undo_used' });
    // Put the fixture back for the later checks.
    await prisma.task.update({ where: { id: t['Rowan three'] }, data: { arc_id: null } });
  });

  it('after the Undo the keeper does not make that arc again for 30 days', async () => {
    const arcsBefore = await prisma.arc.count();
    const dry = await runKeeper(prisma, ownerId, night(4), { dryRun: true });
    expect(dry.arcs!.would_make).toEqual([]);
    const r = await runKeeper(prisma, ownerId, night(4), { dryRun: false });
    expect(r.arcs_written?.made).toEqual([]);
    expect(await prisma.arc.count()).toBe(arcsBefore);
  });

  let closedActionIds: string[] = [];

  it('arcs_close alone: closes the done and stale arcs, never today\'s arc, never the arc holding Sabeen\'s open task, makes no arc', async () => {
    await setSwitches({ arcs_create: false, arcs_close: true, arcs_link_tasks: false });
    const arcsBefore = await prisma.arc.count();
    const tasksBefore = await taskSnapshot(taskIds);
    const r = await runKeeper(prisma, ownerId, night(5), { dryRun: false });
    expect(r.arcs_written?.switches).toEqual({ arcs_create: false, arcs_close: true, arcs_link_tasks: false });
    expect(r.arcs_written?.made).toEqual([]);
    const closedIds = r.arcs_written!.closed.map((c) => c.arc_id);
    expect(closedIds).toContain(a['All done arc']);
    expect(closedIds).toContain(a['Stale arc']);
    expect(closedIds).not.toContain(a['Sabeen arc']);
    expect(closedIds).not.toContain(a['Fresh arc']);
    expect(await prisma.arc.count()).toBe(arcsBefore);
    // Today's arc has no home row on night 5, so it closes here; the guard is tested on night 7 below.
    expect((await arcRow(a['All done arc'])).closed_at?.getTime()).toBe(night(5).getTime());
    expect((await arcRow(a['Stale arc'])).closed_at?.getTime()).toBe(night(5).getTime());
    expect((await arcRow(a['Sabeen arc'])).closed_at).toBeNull();
    expect((await arcRow(a['Fresh arc'])).closed_at).toBeNull();
    // No task row changed (closing an arc does not touch its tasks).
    expect(await taskSnapshot(taskIds)).toEqual(tasksBefore);
    const acts = await keeperActions(['keeper_arc_close']);
    expect(acts.length).toBe(r.arcs_written!.closed.length);
    closedActionIds = acts.map((x) => x.id);
    const lines = acts.map((x) => (x.after as { line: string }).line);
    expect(lines).toContain(`Closed the arc All done arc (${tag}): every step is done.`);
    expect(lines).toContain(`Closed the arc Stale arc (${tag}): the 2 tasks left are still tracked.`);
    for (const l of lines) expect(BANNED.test(l) || DASH.test(l)).toBe(false);
    expect(await keeperActions(['keeper_arc_create'])).toHaveLength(1); // only the one from night 2
  });

  it('Undo of a close reopens the arc only while closed_at is what the keeper wrote', async () => {
    const acts = await keeperActions(['keeper_arc_close']);
    const idFor = (arcId: string) => acts.find((x) => ((x.before as { arcs: { arc_id: string }[] }).arcs[0].arc_id === arcId))!.id;
    // The stale arc: closed again by hand at another time since, so Undo leaves it closed.
    await prisma.arc.update({ where: { id: a['Stale arc'] }, data: { closed_at: iso('2026-11-30T12:00:00Z') } });
    await runHomeUndo(prisma, ownerId, idFor(a['Stale arc']), night(5));
    expect((await arcRow(a['Stale arc'])).closed_at?.toISOString()).toBe('2026-11-30T12:00:00.000Z');
    // The done arc: untouched since, so Undo reopens it.
    await runHomeUndo(prisma, ownerId, idFor(a['All done arc']), night(5));
    expect((await arcRow(a['All done arc'])).closed_at).toBeNull();
    for (const id of closedActionIds) expect(id).toBeTruthy();
  });

  it('after the Undo the keeper does not close that arc again for 30 days', async () => {
    const r = await runKeeper(prisma, ownerId, night(6), { dryRun: false });
    expect(r.arcs_written!.closed.map((c) => c.arc_id)).not.toContain(a['All done arc']);
    expect((await arcRow(a['All done arc'])).closed_at).toBeNull();
  });

  it("never closes today's home_day arc, and closes at most 5 a night", async () => {
    // Reopen the two arcs night 5 closed (raw SQL, with their old updated_at), so they are eligible again.
    await prisma.$executeRaw`UPDATE arcs SET closed_at = NULL, updated_at = ${iso('2026-09-20T12:00:00Z')} WHERE id = ${a["Today's arc"]}::uuid`;
    await mkArc('Stale late');
    await mkTask('Stale late one', ownerId, { arc_id: a['Stale late'] });
    await backdate(a['Stale late'], [t['Stale late one']], '2026-09-20T12:00:00Z');
    for (let i = 1; i <= 6; i++) {
      await mkArc(`Extra done ${i}`);
      await mkTask(`Extra task ${i}`, ownerId, { arc_id: a[`Extra done ${i}`], status: 'done' });
      await backdate(a[`Extra done ${i}`], [t[`Extra task ${i}`]], `2026-10-0${i}T12:00:00Z`);
    }
    // Night 3's home row names Today's arc; run a night whose date has one too.
    await prisma.homeDay.create({
      data: { user_id: ownerId, date: new Date(`${dayOf(7)}T00:00:00Z`), group_key: `arc:${a["Today's arc"]}`, group_label: "Today's arc", arc_id: a["Today's arc"], step_item_keys: [], quick_item_keys: [] },
    });
    const before = await arcSnapshot([a["Today's arc"], a['Sabeen arc'], a['Fresh arc']]);
    const r = await runKeeper(prisma, ownerId, night(7), { dryRun: false });
    const closedIds = r.arcs_written!.closed.map((c) => c.arc_id);
    expect(closedIds).toHaveLength(5);
    expect(closedIds).not.toContain(a["Today's arc"]);
    expect(closedIds).not.toContain(a['Sabeen arc']);
    expect(await arcSnapshot([a["Today's arc"], a['Sabeen arc'], a['Fresh arc']])).toEqual(before);
    // Done arcs close before stale ones: the stale arc waits for the next night.
    expect(closedIds).not.toContain(a['Stale late']);
    const next = await runKeeper(prisma, ownerId, night(8), { dryRun: false });
    const nextIds = next.arcs_written!.closed.map((c) => c.arc_id);
    expect(nextIds).toContain(a['Stale late']);
    expect(nextIds).toContain(a["Today's arc"]); // no longer today's arc on night 8
    expect(nextIds).not.toContain(a['Stale arc']); // its close was undone: held for 30 days
    expect(nextIds).toHaveLength(3);
  });

  it("Sabeen's task and the arc holding it never changed in any run", async () => {
    expect(await taskSnapshot([t['Sabeen step'], t['Rowan Sabeen']])).toEqual(sabeenSnapshot);
    expect(await arcSnapshot([a['Sabeen arc']])).toEqual(sabeenArcSnapshot);
    expect((await taskRow(t['Rowan bot'])).arc_id).toBeNull();
  });

  describe('arcs_link_tasks (his add and remove on the day arc)', () => {
    const date = dayOf(12);
    const opts = { now: night(12), timezone: TZ, date };
    let linkArc = '';
    const act = (action: 'arc_add' | 'arc_remove', label: string) =>
      runHomeAct(prisma, ownerId, { action, item_key: taskKey(t[label]), group_key: `arc:${linkArc}`, ...(action === 'arc_add' ? { origin: 'in_view' as const } : {}) } as never, opts);

    beforeAll(async () => {
      await mkArc('Link arc');
      linkArc = a['Link arc'];
      await mkArc('Other arc');
      await mkTask('Link add', ownerId);
      await mkTask('Link add two', ownerId);
      await mkTask('Link add Sabeen', sabeenId);
      await mkTask('Link add elsewhere', ownerId, { arc_id: a['Other arc'] });
      await mkTask('Link add bot', BAST_USER_ID, { tags: [tag, 'needs-mike'] });
      await mkTask('Link remove', ownerId, { arc_id: linkArc });
      await mkTask('Link remove elsewhere', ownerId, { arc_id: a['Other arc'] });
      await prisma.homeDay.create({
        data: {
          user_id: ownerId,
          date: new Date(`${date}T00:00:00Z`),
          group_key: `arc:${linkArc}`,
          group_label: 'Link arc',
          arc_id: linkArc,
          step_item_keys: [taskKey(t['Link remove']), taskKey(t['Link remove elsewhere'])],
          quick_item_keys: [],
        },
      });
    });

    it('switch off (no link): his edits change only home rows', async () => {
      await setSwitches({ arcs_create: false, arcs_close: false, arcs_link_tasks: false });
      const before = await taskSnapshot([t['Link add'], t['Link remove'], t['Link remove elsewhere']]);
      await act('arc_add', 'Link add');
      await act('arc_remove', 'Link remove');
      expect(await taskSnapshot([t['Link add'], t['Link remove'], t['Link remove elsewhere']])).toEqual(before);
      // Put the day back for the next tests.
      await prisma.homeDay.update({ where: { user_id_date: { user_id: ownerId, date: new Date(`${date}T00:00:00Z`) } }, data: { step_item_keys: [taskKey(t['Link remove']), taskKey(t['Link remove elsewhere'])] } });
      await prisma.homeItemState.deleteMany({ where: { user_id: ownerId, item_key: { in: [taskKey(t['Link add']), taskKey(t['Link remove'])] } } });
    });

    it('switch on: add links his own task with no arc; others are never linked', async () => {
      await setSwitches({ arcs_link_tasks: true });
      const sabeenBefore = await taskSnapshot([t['Link add Sabeen'], t['Link add elsewhere'], t['Link add bot']]);
      await act('arc_add', 'Link add');
      expect((await taskRow(t['Link add'])).arc_id).toBe(linkArc);
      await act('arc_add', 'Link add Sabeen');
      await act('arc_add', 'Link add elsewhere');
      await act('arc_add', 'Link add bot');
      expect(await taskSnapshot([t['Link add Sabeen'], t['Link add elsewhere'], t['Link add bot']])).toEqual(sabeenBefore);
    });

    it('switch on: remove unlinks only a task still on that arc', async () => {
      await act('arc_remove', 'Link remove');
      expect((await taskRow(t['Link remove'])).arc_id).toBeNull();
      const elsewhere = await taskSnapshot([t['Link remove elsewhere']]);
      await act('arc_remove', 'Link remove elsewhere');
      expect(await taskSnapshot([t['Link remove elsewhere']])).toEqual(elsewhere);
    });

    it('Undo of an add and of a remove put arc_id back, compare-and-set', async () => {
      const rows = await prisma.homeAction.findMany({ where: { user_id: ownerId, action: { in: ['arc_add', 'arc_remove'] } }, orderBy: { created_at: 'asc' } });
      const withLink = rows.filter((r) => ((r.before as { arcs?: unknown[] }).arcs ?? []).length > 0);
      expect(withLink).toHaveLength(2);
      const addRow = withLink.find((r) => r.action === 'arc_add')!;
      const removeRow = withLink.find((r) => r.action === 'arc_remove')!;
      // The add: he moved the task to another arc since, so Undo leaves it there.
      await prisma.task.update({ where: { id: t['Link add'] }, data: { arc_id: a['Other arc'] } });
      await runHomeUndo(prisma, ownerId, addRow.id, night(12));
      expect((await taskRow(t['Link add'])).arc_id).toBe(a['Other arc']);
      // The remove: still null, so Undo puts it back on the arc.
      await runHomeUndo(prisma, ownerId, removeRow.id, night(12));
      expect((await taskRow(t['Link remove'])).arc_id).toBe(linkArc);
    });

    it('Undo of an add puts a task that still points at the arc back to no arc', async () => {
      await act('arc_add', 'Link add two');
      expect((await taskRow(t['Link add two'])).arc_id).toBe(linkArc);
      const row = (await prisma.homeAction.findMany({ where: { user_id: ownerId, action: 'arc_add', undone_at: null }, orderBy: { created_at: 'desc' } })).find((r) => ((r.before as { arcs?: unknown[] }).arcs ?? []).length > 0)!;
      await runHomeUndo(prisma, ownerId, row.id, night(12));
      expect((await taskRow(t['Link add two'])).arc_id).toBeNull();
    });

    it("Sabeen's task still never changed", async () => {
      expect(await taskSnapshot([t['Sabeen step'], t['Rowan Sabeen']])).toEqual(sabeenSnapshot);
      expect((await taskRow(t['Link add Sabeen'])).arc_id).toBeNull();
    });
  });
});
