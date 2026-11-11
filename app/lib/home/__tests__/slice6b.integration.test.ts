// @vitest-environment node
/**
 * Slice 6b against a real Postgres: the Slack lines to Mike. Tracking always, lines only with the switch on and the
 * "slack" cap, first sight, quiet hours, the second line after 4 working hours, "acted" stopping it, the lifeline once a
 * day, ack, the one more offer of an unacknowledged line, and the proof that other users and every shared record stay put.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It seeds its own users, asks and tasks and
 * removes only those. Run on its own clean database (other slices' files count global rows):
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s6b_it npx vitest run lib/home/__tests__/slice6b.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { runHomeAct, zonedDateString } from '../act';
import { applyWatch, watchBodySchema, watchPlan } from '../emergency/store';
import { ackLines, ackBodySchema } from '../emergency/slack-store';
import { DASHBOARD_URL } from '../emergency/watch';
import { crisisKey, taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** November 2026 on his wall clock (Eastern standard time, UTC-5). Tuesday is the 10th. */
const at = (d: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, d, h + 5, mi));

describe.skipIf(!SCRATCH)('Slice 6b: Slack lines to Mike (real database)', () => {
  const tag = `s6b-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const ids = [adminId, techId, overlookAdminId];
  const askIds: string[] = [];
  const taskIds: string[] = [];

  const ask = async (subject: string, now: Date) => {
    const row = await prisma.emailAsk.create({
      data: {
        message_id: `${tag}-${askIds.length}`,
        thread_id: `${tag}-th-${askIds.length}`,
        account: `owner-${tag}@example.test`,
        from_name: 'Sender',
        from_email: `boss${askIds.length}@${tag}-client.example`,
        subject,
        queue: 'do',
        severity: 'internal',
        is_urgent: true,
        state: 'open',
        deep_link: `https://mail.example.test/${tag}/${askIds.length}`,
        received_at: new Date(now.getTime() - 3 * HOUR),
      },
    });
    askIds.push(row.id);
    return row;
  };
  const handle = (id: string) => prisma.emailAsk.update({ where: { id }, data: { state: 'handled' } });
  const body = (b: unknown) => watchBodySchema.parse(b);
  /** One home-watch POST as the machine sends it. */
  const post = (now: Date, caps: string[] | null = ['slack']) => applyWatch(prisma, adminId, body({ kuma: null, checks: [], ...(caps ? { caps } : {}) }), now);
  const setSwitch = (on: boolean) =>
    prisma.homeKeeperSettings.upsert({ where: { user_id: adminId }, create: { user_id: adminId, emergency_slack: on }, update: { emergency_slack: on } });
  const rowOf = (key: string) => prisma.homeEmergencyWatch.findUniqueOrThrow({ where: { user_id_item_key: { user_id: adminId, item_key: key } } });
  const act = (now: Date, req: Parameters<typeof runHomeAct>[2]) => runHomeAct(prisma, adminId, req, { now, timezone: TZ, date: zonedDateString(now, TZ) });

  const shared = async () =>
    JSON.stringify({
      tasks: await prisma.task.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, tags: true, updated_at: true } }),
      asks: await prisma.emailAsk.findMany({ orderBy: { id: 'asc' }, select: { id: true, state: true, updated_at: true } }),
      counts: [await prisma.task.count(), await prisma.emailAsk.count(), await prisma.notification.count(), await prisma.emailOutbox.count()],
    });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 6b', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 6b', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 6b', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: TZ },
      ],
    });
  });

  afterAll(async () => {
    await prisma.homeEmergencyWatch.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeKeeperSettings.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.emailAsk.deleteMany({ where: { id: { in: askIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  describe('switch off, then on without the cap', () => {
    let a: Awaited<ReturnType<typeof ask>>;
    it('switch off: the item is tracked and no line comes back', async () => {
      a = await ask('Server is on fire', at(10, 10));
      const res = await post(at(10, 10));
      expect(res.lines).toEqual([]);
      const row = await rowOf(crisisKey(a.id));
      expect(row.first_seen_at.toISOString()).toBe(at(10, 10).toISOString());
      expect(row.slack_first_claims).toBe(0);
      expect(row.slack_first_claimed_at).toBeNull();
    });

    it('a POST from the old script (no caps) with the switch on returns no lines and claims nothing', async () => {
      await setSwitch(true);
      const res = await post(at(10, 10, 2), null);
      expect(res.lines).toEqual([]);
      expect((await rowOf(crisisKey(a.id))).slack_first_claims).toBe(0);
      const other = await post(at(10, 10, 3), ['something_else']);
      expect(other.lines).toEqual([]);
      expect((await rowOf(crisisKey(a.id))).slack_first_claims).toBe(0);
    });

    it('the dry run lists what a real run would hand out, and writes nothing', async () => {
      const before = JSON.stringify(await prisma.homeEmergencyWatch.findMany({ where: { user_id: adminId } }));
      const plan = await watchPlan(prisma, adminId, at(10, 10, 4));
      expect(plan.would_post).toHaveLength(1);
      expect(plan.would_post[0]).toMatchObject({ kind: 'first', id: `${(await rowOf(crisisKey(a.id))).id}:first` });
      expect(JSON.stringify(await prisma.homeEmergencyWatch.findMany({ where: { user_id: adminId } }))).toBe(before);
      await setSwitch(false);
      expect((await watchPlan(prisma, adminId, at(10, 10, 4))).would_post).toEqual([]);
      await setSwitch(true);
    });
  });

  describe('first line, ack, and the one more offer', () => {
    let a: { id: string };
    it('with the switch on and the cap: one first line, with the row id, the title and the link', async () => {
      a = (await prisma.emailAsk.findFirstOrThrow({ where: { id: askIds[0] } }));
      const res = await post(at(10, 10, 5));
      expect(res.lines).toHaveLength(1);
      const line = res.lines[0];
      const row = await rowOf(crisisKey(a.id));
      expect(line).toMatchObject({ kind: 'first', id: `${row.id}:first` });
      expect(line.text.startsWith('Needs you now: ')).toBe(true);
      expect(line.text.endsWith(DASHBOARD_URL)).toBe(true);
      expect(line.text).not.toMatch(/[—–]|priorit|overdue/i);
      expect(row.slack_first_claims).toBe(1);
    });

    it('is not handed out again inside 15 minutes', async () => {
      expect((await post(at(10, 10, 6))).lines).toEqual([]);
    });

    it('ack stops it for good', async () => {
      const row = await rowOf(crisisKey(a.id));
      expect(await ackLines(prisma, adminId, [`${row.id}:first`], at(10, 10, 7))).toEqual({ acked: 1, ignored: 0 });
      expect((await rowOf(crisisKey(a.id))).slack_first_at).not.toBeNull();
      expect((await post(at(10, 10, 30))).lines).toEqual([]);
      expect((await post(at(10, 12))).lines).toEqual([]);
    });

    it('ack ignores a foreign, unknown or malformed id', async () => {
      const row = await rowOf(crisisKey(a.id));
      const res = await ackLines(prisma, overlookAdminId, [`${row.id}:again`, `${randomUUID()}:first`, 'nonsense'], at(10, 12));
      expect(res.acked).toBe(0);
      expect((await rowOf(crisisKey(a.id))).slack_again_at).toBeNull();
      expect(ackBodySchema.safeParse({ ids: [] }).success).toBe(false);
      expect(ackBodySchema.safeParse({ ids: Array.from({ length: 21 }, () => 'x') }).success).toBe(false);
      expect(ackBodySchema.safeParse({ ids: ['x'], extra: 1 }).success).toBe(false);
    });

    it('an unacknowledged line is offered exactly once more, then never again', async () => {
      const b = await ask('Customer cannot log in', at(10, 12, 10));
      const first = await post(at(10, 12, 10));
      expect(first.lines.map((l) => l.kind)).toEqual(['first']);
      expect((await post(at(10, 12, 20))).lines).toEqual([]);
      const again = await post(at(10, 12, 25));
      expect(again.lines).toHaveLength(1);
      expect(again.lines[0].id).toBe(first.lines[0].id);
      expect((await rowOf(crisisKey(b.id))).slack_first_claims).toBe(2);
      expect((await post(at(10, 12, 45))).lines).toEqual([]);
      expect((await post(at(10, 13, 30))).lines).toEqual([]);
      await handle(b.id);
      await post(at(10, 13, 31));
      expect((await rowOf(crisisKey(b.id))).cleared_at).not.toBeNull();
    });
  });

  describe('the second line after 4 working hours', () => {
    it('not before: a first line sent at 10:05 is due again at 14:05, once', async () => {
      const key = crisisKey(askIds[0]);
      expect((await post(at(10, 14, 4))).lines).toEqual([]);
      const res = await post(at(10, 14, 5));
      expect(res.lines).toHaveLength(1);
      expect(res.lines[0]).toMatchObject({ kind: 'again' });
      expect(res.lines[0].text).toMatch(/^Still waiting on you since Tuesday 10:00 am: .+\.$/);
      const row = await rowOf(key);
      expect(await ackLines(prisma, adminId, [res.lines[0].id], at(10, 14, 6))).toEqual({ acked: 1, ignored: 0 });
      expect((await rowOf(key)).slack_again_at).not.toBeNull();
      expect(row.slack_again_claims).toBe(1);
      expect((await post(at(10, 16, 30))).lines).toEqual([]);
    });

    it('acting on the item stops it', async () => {
      const d = await ask('Quote needed today', at(11, 9));
      const e = await ask('Contract question', at(11, 9));
      const first = await post(at(11, 9));
      expect(first.lines.map((l) => l.kind)).toEqual(['first', 'first']);
      await ackLines(prisma, adminId, first.lines.map((l) => l.id), at(11, 9, 1));
      await act(at(11, 9, 30), { action: 'matters_more', item_key: crisisKey(d.id) });
      // The action row is stamped with the real clock; move it onto the fake one.
      await prisma.homeAction.updateMany({ where: { user_id: adminId, item_key: crisisKey(d.id) }, data: { created_at: at(11, 9, 30) } });
      expect((await post(at(11, 12, 59))).lines).toEqual([]);
      const res = await post(at(11, 13, 1));
      expect(res.lines.map((l) => l.kind)).toEqual(['again']);
      expect(res.lines[0].id).toBe(`${(await rowOf(crisisKey(e.id))).id}:again`);
      expect((await rowOf(crisisKey(d.id))).acted_at).not.toBeNull();
      expect((await rowOf(crisisKey(e.id))).acted_at).toBeNull();
      await ackLines(prisma, adminId, [res.lines[0].id], at(11, 13, 2));
      for (const id of [d.id, e.id, askIds[0]]) await handle(id);
      await post(at(11, 13, 5));
    });

    it('an item that left Needs you now gets no second line', async () => {
      const f = await ask('Short lived', at(12, 9));
      const first = await post(at(12, 9));
      await ackLines(prisma, adminId, first.lines.map((l) => l.id), at(12, 9, 1));
      await handle(f.id);
      expect((await post(at(12, 14))).lines).toEqual([]);
      expect((await rowOf(crisisKey(f.id))).cleared_at).not.toBeNull();
    });
  });

  describe('quiet hours', () => {
    it('an item landing at 23:00 is tracked, held, and sent at 07:00', async () => {
      const c = await ask('Late night alert', at(12, 23));
      expect((await post(at(12, 23))).lines).toEqual([]);
      expect((await rowOf(crisisKey(c.id))).first_seen_at.toISOString()).toBe(at(12, 23).toISOString());
      expect((await post(at(13, 6, 59))).lines).toEqual([]);
      const res = await post(at(13, 7));
      expect(res.lines.map((l) => l.kind)).toEqual(['first']);
      await ackLines(prisma, adminId, [res.lines[0].id], at(13, 7, 1));
      await handle(c.id);
      await post(at(13, 7, 2));
    });
  });

  describe('text from a hostile subject', () => {
    it('the line is plain, one line, with no mention, link, dash or banned word', async () => {
      const long = 'x'.repeat(300);
      const h = await ask(`<!channel> <@U123> overdue priority — *bold* <https://evil.example|click> ${long}\nsecond line`, at(13, 9));
      const res = await post(at(13, 9));
      expect(res.lines).toHaveLength(1);
      const t = res.lines[0].text;
      expect(t).not.toMatch(/[<>@*—–\n]|priorit|overdue/i);
      expect(t.split(' ').filter((w) => w.startsWith('xxxxxxxxxxxxxxxxxxxx')).join('').length).toBeLessThanOrEqual(120);
      await ackLines(prisma, adminId, [res.lines[0].id], at(13, 9, 1));
      await handle(h.id);
      await post(at(13, 9, 2));
    });
  });

  describe('lifeline: once a day after 09:00, weekends too, until done', () => {
    let taskId = '';
    let rowKey = '';
    it('first sight, then the daily line at 09:00 on Saturday with the days left', async () => {
      const t = await prisma.task.create({
        data: { title: 'Renew the certificate', status: 'not_started', tags: ['lifeline'], assignee_id: adminId, created_by_id: adminId, needs_review: false, estimated_minutes: 10, due_date: new Date('2026-11-17T00:00:00Z'), created_at: new Date(at(14, 8).getTime() - 9 * DAY) },
      });
      taskId = t.id;
      taskIds.push(t.id);
      rowKey = taskKey(t.id);
      const first = await post(at(14, 8, 59));
      expect(first.lines.map((l) => l.kind)).toEqual(['first']);
      await ackLines(prisma, adminId, [first.lines[0].id], at(14, 8, 59));
      const nine = await post(at(14, 9));
      expect(nine.lines.map((l) => l.kind)).toEqual(['lifeline']);
      expect(nine.lines[0].text).toBe('Renew the certificate. 3 days left, and only you can do this one.');
      await ackLines(prisma, adminId, [nine.lines[0].id], at(14, 9, 1));
      expect((await post(at(14, 15))).lines).toEqual([]);
      expect((await post(at(14, 21, 59))).lines).toEqual([]);
    });
    it('again on Sunday (2 days left), not twice that day', async () => {
      const sun = await post(at(15, 9));
      expect(sun.lines.map((l) => l.kind)).toEqual(['lifeline']);
      expect(sun.lines[0].text).toContain('2 days left');
      await ackLines(prisma, adminId, [sun.lines[0].id], at(15, 9, 1));
      expect((await post(at(15, 18))).lines).toEqual([]);
      expect((await rowOf(rowKey)).lifeline_line_on?.toISOString().slice(0, 10)).toBe('2026-11-15');
    });
    it('the last day reads "Today is the last day", and an unacked daily line is offered once more', async () => {
      const last = await post(at(17, 9));
      const kinds = last.lines.map((l) => l.kind);
      expect(kinds).toContain('lifeline');
      const life = last.lines.find((l) => l.kind === 'lifeline')!;
      expect(life.text).toBe('Today is the last day: Renew the certificate.');
      expect((await post(at(17, 9, 10))).lines.filter((l) => l.kind === 'lifeline')).toEqual([]);
      expect((await post(at(17, 9, 20))).lines.filter((l) => l.kind === 'lifeline')).toHaveLength(1);
      expect((await post(at(17, 12))).lines.filter((l) => l.kind === 'lifeline')).toEqual([]);
    });
    it('done: no more lines', async () => {
      await prisma.task.update({ where: { id: taskId }, data: { status: 'done' } });
      expect((await post(at(18, 9))).lines).toEqual([]);
      expect((await rowOf(rowKey)).cleared_at).not.toBeNull();
    });
  });

  describe('what it never touches', () => {
    it('writes no Task, EmailAsk or Notification row, and leaves other users alone', async () => {
      const g = await ask('Final check', at(19, 9));
      const before = await shared();
      await post(at(19, 9));
      await post(at(19, 9, 20));
      await watchPlan(prisma, adminId, at(19, 9, 21));
      expect(await shared()).toBe(before);
      expect(await prisma.homeEmergencyWatch.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
      expect(await prisma.homeKeeperSettings.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
      await handle(g.id);
    });

    it('a POST for a user who is not on the home view tracks nothing and returns no lines', async () => {
      const res = await applyWatch(prisma, overlookAdminId, body({ kuma: null, checks: [], caps: ['slack'] }), at(19, 10));
      expect(res.skipped).toBe('home_off');
      expect(res.lines).toEqual([]);
      expect(await prisma.homeEmergencyWatch.count({ where: { user_id: overlookAdminId } })).toBe(0);
    });
  });
});
