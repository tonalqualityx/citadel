// @vitest-environment node
/** "Overdue by others" and the day-before notice, against a real scratch Postgres. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { loadOverdueByOthers } from '@/lib/home/overdue-others';
import { runTaskDueNotices } from '@/lib/services/task-due-notice';
import { makeFixture, type Fx } from './fixture';

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-11-13T15:00:00Z'); // 10:00 in New York

describe.skipIf(!SCRATCH)('Overdue by others (real database)', () => {
  let fx: Fx;
  let sabeen: string;
  let lisa: string;
  let live: string;
  let queue: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    fx = await makeFixture('ovd');
    sabeen = await fx.mkStaff('Sabeen');
    lisa = await fx.mkStaff('Lisa', 'tech');
    live = await fx.mkProject('Live', { status: 'in_progress' });
    queue = await fx.mkProject('Queued', { status: 'queue' });
    const other = await fx.mkProject('Review', { status: 'review' });
    const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
    const mk = async (key: string, extra: Record<string, unknown>) => (ids[key] = await fx.mkTask(key, { status: 'not_started', ...extra }));
    await mk('five-days-sabeen', { assignee_id: sabeen, project_id: live, due_date: ago(5) });
    await mk('three-days-sabeen-review', { assignee_id: sabeen, project_id: other, due_date: ago(3) });
    await mk('two-days-lisa-noproject', { assignee_id: lisa, due_date: ago(2) });
    await mk('one-day-late-not-yet', { assignee_id: lisa, project_id: live, due_date: new Date(NOW.getTime() - DAY - 60_000), status: 'in_progress' });
    await mk('within-grace', { assignee_id: sabeen, project_id: live, due_date: new Date(NOW.getTime() - DAY + 60_000) });
    await mk('mike-own', { assignee_id: MIKE_USER_ID, project_id: live, due_date: ago(9) });
    await mk('bast-own', { assignee_id: BOT_USER_IDS[0], project_id: live, due_date: ago(9) });
    await mk('unassigned', { project_id: live, due_date: ago(9) });
    await mk('done', { assignee_id: sabeen, project_id: live, due_date: ago(9), status: 'done' });
    await mk('abandoned', { assignee_id: sabeen, project_id: live, due_date: ago(9), status: 'abandoned' });
    await mk('triage', { assignee_id: sabeen, due_date: ago(9), status: 'triage' });
    await mk('queued-project', { assignee_id: sabeen, project_id: queue, due_date: ago(9) });
    await mk('future', { assignee_id: sabeen, project_id: live, due_date: new Date(NOW.getTime() + DAY) });
    await mk('no-due', { assignee_id: sabeen, project_id: live });
  });
  afterAll(async () => {
    await fx.cleanup();
    await prisma.$disconnect();
  });

  it('lists open tasks of other people two or more calendar days past their due day on live projects or none, furthest first', async () => {
    const out = await loadOverdueByOthers(prisma, MIKE_USER_ID, NOW);
    expect(out).not.toBeNull();
    const mine = out!.rows.filter((r) => r.title.startsWith(fx.tag));
    expect(mine.map((r) => r.title.replace(`${fx.tag} `, ''))).toEqual(['five-days-sabeen', 'three-days-sabeen-review', 'two-days-lisa-noproject']);
    expect(mine.map((r) => r.days_past)).toEqual([5, 3, 2]);
    expect(mine[0]).toMatchObject({ who: 'Sabeen', project_name: `${fx.tag} Live`, href: `/tasks/${ids['five-days-sabeen']}` });
    expect(mine[2]).toMatchObject({ who: 'Lisa', project_name: null, project_id: null });
  });

  it('leaves out Mike, bots, nobody, done, abandoned, Triage, a project that is not live, the one-day grace and future or undated work', async () => {
    const out = await loadOverdueByOthers(prisma, MIKE_USER_ID, NOW);
    const titles = out!.rows.map((r) => r.title);
    for (const k of ['one-day-late-not-yet', 'within-grace', 'mike-own', 'bast-own', 'unassigned', 'done', 'abandoned', 'triage', 'queued-project', 'future', 'no-due']) {
      expect(titles.some((t) => t === `${fx.tag} ${k}`), k).toBe(false);
    }
    expect(out!.count).toBeGreaterThanOrEqual(3);
  });

  it('gives nobody but the owner anything', async () => {
    expect(await loadOverdueByOthers(prisma, sabeen, NOW)).toBeNull();
    expect(await loadOverdueByOthers(prisma, lisa, NOW)).toBeNull();
    expect(await loadOverdueByOthers(prisma, BOT_USER_IDS[0], NOW)).toBeNull();
  });

  it('creates no notification', async () => {
    const before = await prisma.notification.count();
    await loadOverdueByOthers(prisma, MIKE_USER_ID, NOW);
    expect(await prisma.notification.count()).toBe(before);
  });
});

describe.skipIf(!SCRATCH)('Day-before notice (real database)', () => {
  let fx: Fx;
  let sabeen: string;
  let proj: string;
  let queued: string;
  const NOTICE_NOW = new Date('2026-11-13T15:00:00Z'); // Friday 10:00 in New York
  const tomorrowNoon = new Date('2026-11-14T17:00:00Z'); // Saturday 12:00 in New York

  const noticesFor = (taskId: string) => prisma.notification.count({ where: { entity_id: taskId, type: 'task_due_soon' } });

  beforeAll(async () => {
    fx = await makeFixture('due');
    sabeen = await fx.mkStaff('Sabeen');
    proj = await fx.mkProject('Live', { status: 'in_progress' });
    queued = await fx.mkProject('Queued', { status: 'queue' });
  });
  afterAll(async () => {
    await fx.cleanup();
    await prisma.$disconnect();
  });

  it('tells the assignee once, one day before the due date, and never twice for the same due date', async () => {
    const t = await fx.mkTask('Due tomorrow', { status: 'in_progress', assignee_id: sabeen, project_id: proj, due_date: tomorrowNoon });
    const first = await runTaskDueNotices(NOTICE_NOW);
    expect(first.notificationsSent).toBeGreaterThanOrEqual(1);
    expect(await noticesFor(t)).toBe(1);
    const note = await prisma.notification.findFirstOrThrow({ where: { entity_id: t, type: 'task_due_soon' } });
    expect(note.user_id).toBe(sabeen);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).due_notice_for?.getTime()).toBe(tomorrowNoon.getTime());
    // hourly runs, a run later the same day, and two at once: still one
    await runTaskDueNotices(NOTICE_NOW);
    await runTaskDueNotices(new Date(NOTICE_NOW.getTime() + 6 * 3600 * 1000));
    await Promise.all([runTaskDueNotices(NOTICE_NOW), runTaskDueNotices(NOTICE_NOW)]);
    expect(await noticesFor(t)).toBe(1);
  });

  it('announces a moved due date again, once, for the new date', async () => {
    const t = await fx.mkTask('Moved', { status: 'not_started', assignee_id: sabeen, due_date: tomorrowNoon });
    await runTaskDueNotices(NOTICE_NOW);
    expect(await noticesFor(t)).toBe(1);
    await prisma.task.update({ where: { id: t }, data: { due_date: new Date('2026-11-20T17:00:00Z') } });
    await runTaskDueNotices(NOTICE_NOW);
    expect(await noticesFor(t)).toBe(1);
    const later = new Date('2026-11-19T15:00:00Z');
    await runTaskDueNotices(later);
    await runTaskDueNotices(later);
    expect(await noticesFor(t)).toBe(2);
  });

  it('is not early or late: two days out and today and yesterday get nothing', async () => {
    const two = await fx.mkTask('Two days', { status: 'not_started', assignee_id: sabeen, due_date: new Date('2026-11-15T17:00:00Z') });
    const today = await fx.mkTask('Today', { status: 'not_started', assignee_id: sabeen, due_date: new Date('2026-11-13T21:00:00Z') });
    const past = await fx.mkTask('Past', { status: 'not_started', assignee_id: sabeen, due_date: new Date('2026-11-12T17:00:00Z') });
    await runTaskDueNotices(NOTICE_NOW);
    for (const t of [two, today, past]) expect(await noticesFor(t)).toBe(0);
  });

  it('never tells Mike, a bot, nobody, a Triage task, a finished task, or a task on a project that is not live', async () => {
    const skip: string[] = [];
    skip.push(await fx.mkTask('Mike', { status: 'not_started', assignee_id: MIKE_USER_ID, due_date: tomorrowNoon }));
    skip.push(await fx.mkTask('Bast', { status: 'not_started', assignee_id: BOT_USER_IDS[0], due_date: tomorrowNoon }));
    skip.push(await fx.mkTask('Nobody', { status: 'not_started', due_date: tomorrowNoon }));
    skip.push(await fx.mkTask('Triage', { status: 'triage', assignee_id: sabeen, due_date: tomorrowNoon }));
    skip.push(await fx.mkTask('Done', { status: 'done', assignee_id: sabeen, due_date: tomorrowNoon }));
    skip.push(await fx.mkTask('Abandoned', { status: 'abandoned', assignee_id: sabeen, due_date: tomorrowNoon }));
    skip.push(await fx.mkTask('Queued', { status: 'not_started', assignee_id: sabeen, project_id: queued, due_date: tomorrowNoon }));
    await runTaskDueNotices(NOTICE_NOW);
    for (const t of skip) expect(await noticesFor(t)).toBe(0);
  });

  it('uses the assignee\'s own day: a due date that is tomorrow in New York but not in Auckland', async () => {
    const t = await fx.mkTask('Zone', { status: 'not_started', assignee_id: sabeen, due_date: new Date('2026-11-14T10:00:00Z') }); // Saturday 05:00 in New York, Saturday 23:00 in Auckland
    await prisma.userPreference.upsert({ where: { user_id: sabeen }, update: { timezone: 'Pacific/Auckland' }, create: { user_id: sabeen, timezone: 'Pacific/Auckland' } });
    await runTaskDueNotices(NOTICE_NOW); // in Auckland it is already Saturday 04:00, so tomorrow is Sunday and the due date is today
    expect(await noticesFor(t)).toBe(0);
    await prisma.userPreference.delete({ where: { user_id: sabeen } });
    await runTaskDueNotices(NOTICE_NOW);
    expect(await noticesFor(t)).toBe(1);
  });
});

// The task form, the arc board and the peek drawer store the picked day as MIDNIGHT UTC. That value is a calendar day, never an instant to be
// moved into a zone (New York would read 2026-11-14T00:00Z as the evening of the 13th).
describe.skipIf(!SCRATCH)('Due dates are calendar days (midnight UTC), read against today in the user\'s own zone', () => {
  let fx: Fx;
  let sabeen: string;
  let proj: string;
  const NY = 'America/New_York';
  const AKL = 'Pacific/Auckland';
  const noticesFor = (taskId: string) => prisma.notification.count({ where: { entity_id: taskId, type: 'task_due_soon' } });
  const setZone = (zone: string | null) =>
    zone
      ? prisma.userPreference.upsert({ where: { user_id: sabeen }, update: { timezone: zone }, create: { user_id: sabeen, timezone: zone } })
      : prisma.userPreference.deleteMany({ where: { user_id: sabeen } });

  beforeAll(async () => {
    fx = await makeFixture('cal');
    sabeen = await fx.mkStaff('Sabeen');
    proj = await fx.mkProject('Live', { status: 'in_progress' });
  });
  afterAll(async () => {
    await setZone(null);
    await fx.cleanup();
    await prisma.$disconnect();
  });

  describe('day-before notice', () => {
    it('New York: due Saturday the 14th (stored 2026-11-14T00:00Z) is announced on Friday the 13th, not on Thursday', async () => {
      const t = await fx.mkTask('NY sat', { status: 'not_started', assignee_id: sabeen, project_id: proj, due_date: new Date('2026-11-14T00:00:00Z') });
      await setZone(NY);
      await runTaskDueNotices(new Date('2026-11-13T04:59:00Z')); // Thursday 23:59 in New York
      expect(await noticesFor(t)).toBe(0);
      await runTaskDueNotices(new Date('2026-11-13T05:00:00Z')); // Friday 00:00 in New York
      expect(await noticesFor(t)).toBe(1);
    });

    it('a zone ahead of UTC (Auckland): the same due day is announced when Auckland\'s Friday begins, not an hour before', async () => {
      const t = await fx.mkTask('AKL sat', { status: 'not_started', assignee_id: sabeen, project_id: proj, due_date: new Date('2026-11-21T00:00:00Z') });
      await setZone(AKL);
      await runTaskDueNotices(new Date('2026-11-19T10:59:00Z')); // Thursday 23:59 in Auckland
      expect(await noticesFor(t)).toBe(0);
      await runTaskDueNotices(new Date('2026-11-19T11:00:00Z')); // Friday 00:00 in Auckland
      expect(await noticesFor(t)).toBe(1);
    });

    it('a due date with a real time of day is an instant, read in the zone', async () => {
      const t = await fx.mkTask('Instant', { status: 'not_started', assignee_id: sabeen, project_id: proj, due_date: new Date('2026-11-24T03:30:00Z') }); // Monday 22:30 in New York on the 23rd
      await setZone(NY);
      await runTaskDueNotices(new Date('2026-11-22T14:00:00Z')); // Sunday the 22nd in New York: tomorrow is the 23rd
      expect(await noticesFor(t)).toBe(1);
    });
  });

  describe('overdue by others', () => {
    const MIKE = MIKE_USER_ID;
    const titles = async (now: Date, zone: string) => (await loadOverdueByOthers(prisma, MIKE, now, zone))!.rows.map((r) => r.title.replace(`${fx.tag} `, ''));

    it('New York: due the 11th it is not listed on the 11th or 12th, and appears when the 13th begins (one full day late)', async () => {
      await fx.mkTask('due-nov-11', { status: 'not_started', assignee_id: sabeen, project_id: proj, due_date: new Date('2026-11-11T00:00:00Z') });
      expect(await titles(new Date('2026-11-12T04:59:00Z'), NY)).not.toContain('due-nov-11'); // 11th, 23:59 in New York: the due day
      expect(await titles(new Date('2026-11-13T04:59:00Z'), NY)).not.toContain('due-nov-11'); // 12th, 23:59: one day after, still not
      const out = await loadOverdueByOthers(prisma, MIKE, new Date('2026-11-13T05:00:00Z'), NY); // 13th, 00:00
      const row = out!.rows.find((r) => r.title === `${fx.tag} due-nov-11`);
      expect(row?.days_past).toBe(2);
    });

    it('a zone ahead of UTC (Auckland): appears when Auckland\'s 13th begins, not an hour before', async () => {
      await fx.mkTask('due-nov-11-akl', { status: 'not_started', assignee_id: sabeen, project_id: proj, due_date: new Date('2026-11-11T00:00:00Z') });
      expect(await titles(new Date('2026-11-12T10:59:00Z'), AKL)).not.toContain('due-nov-11-akl'); // 12th, 23:59 in Auckland
      expect(await titles(new Date('2026-11-12T11:00:00Z'), AKL)).toContain('due-nov-11-akl'); // 13th, 00:00 in Auckland
    });
  });
});
