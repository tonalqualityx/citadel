// @vitest-environment node
/**
 * Slice 4d against a real Postgres: "Book 30 minutes", a private block on the owner's own calendar from a needs-thought row.
 * The act and the undo are called as functions on a fake clock; the machine's two routes are called through their store functions.
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It seeds its own rows and removes only those.
 * Run on its own clean database (other slices' files count global rows):
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s4d_it npx vitest run lib/home/__tests__/slice4d.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { homeActSchema, runHomeAct, runHomeUndo, zonedDateString } from '../act';
import { threadKey } from '../item-key';
import { listBookings, saveBookings, bookingsBodySchema } from '../owed/book-store';
import { NO_FREE_SLOT } from '../owed/slot';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
/** Wall clock in Eastern standard time (UTC-5), November 2026. */
const at = (day: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, day, h + 5, mi));
/** Wednesday 11 November, 8:00 his time. Thursday 12 is the next business day. */
const NOW = at(11, 8, 0);
const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d);

describe.skipIf(!SCRATCH)('Slice 4d: Book 30 minutes (real database)', () => {
  const tag = `s4d-${Date.now()}`;
  const acct = `a-${tag}@example.test`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const users = [adminId, techId, overlookAdminId];
  const mid = (k: string) => `${tag}-${k}`;
  const key = (k: string) => threadKey(acct, mid(k));
  const ids: Record<string, string> = {};
  const eventIds: string[] = [];
  let clientId = '';

  const act = (userId: string, req: unknown, now = NOW) =>
    runHomeAct(prisma, userId, homeActSchema.parse(req), { now, timezone: TZ, date: zonedDateString(now, TZ) });
  const book = (k: string, userId = adminId, now = NOW) => act(userId, { action: 'book_block', item_key: key(k) }, now);
  const screen = async (userId = adminId, now = NOW) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, now, { timezone: TZ }), loadItemStates(prisma, userId)]);
    return selectHome({ raw, states, now });
  };
  const rowOnScreen = async (k: string, userId = adminId) => (await screen(userId)).candidates.find((c) => c.key === key(k))?.item;
  const buttons = (item: { actions: Array<{ id: string }>; more_actions: Array<{ id: string }> } | undefined) => [...(item?.actions ?? []), ...(item?.more_actions ?? [])].map((a) => a.id);
  const owedRow = (k: string) => prisma.homeOwedThread.findUnique({ where: { user_id_thread_key: { user_id: adminId, thread_key: key(k) } } });
  const setSwitch = (on: boolean) => prisma.homeKeeperSettings.upsert({ where: { user_id: adminId }, create: { user_id: adminId, book_blocks: on }, update: { book_blocks: on } });
  const world = async () => ({
    asks: await prisma.emailAsk.count(),
    askStamp: (await prisma.emailAsk.aggregate({ _max: { updated_at: true } }))._max.updated_at?.toISOString() ?? null,
    tasks: await prisma.task.count(),
    outbox: await prisma.emailOutbox.count(),
    events: await prisma.calendarEvent.count(),
  });
  const seedEvent = async (title: string, start: Date, end: Date, all_day = false) => {
    const event_id = `${tag}-ev-${eventIds.length}`;
    eventIds.push(event_id);
    await prisma.calendarEvent.create({ data: { event_id, title, starts_at: start, ends_at: end, all_day } });
    return event_id;
  };
  const dropEvent = (event_id: string) => prisma.calendarEvent.deleteMany({ where: { event_id } });
  const ask = (k: string) =>
    prisma.emailAsk.create({
      data: {
        message_id: mid(k), thread_id: mid(k), account: acct, from_name: k === 'dashy' ? 'Jess— "Lee"\n<b>x</b>' : 'Dana Whitfield', from_email: `${k}@client.example`, subject: `Photos ${k}`,
        gist: `Gist ${k}.`, queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', client_id: clientId,
        deep_link: `https://mail.google.com/mail/u/0/#inbox/${mid(k)}`, received_at: new Date(NOW.getTime() - 4 * 24 * 3600_000),
      },
    });
  const thoughtRow = (k: string) =>
    prisma.homeOwedThread.create({
      data: { user_id: adminId, thread_key: key(k), state: 'needs_thought', bast_read: 'The reply needs a date from you.', suggested_answer: null, thought_since: new Date(NOW.getTime() - 24 * 3600_000), last_model: 'sonnet' },
    });

  const T = ['t1', 't2', 't3', 't4', 't5', 't6', 'dashy'];

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 4d', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 4d', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 4d', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: TZ },
      ],
    });
    clientId = (await prisma.client.create({ data: { name: `Client ${tag}`, status: 'active' } })).id;
    for (const k of [...T, 'drafted']) ids[k] = (await ask(k)).id;
    for (const k of T) await thoughtRow(k);
    await prisma.homeOwedThread.create({
      data: { user_id: adminId, thread_key: key('drafted'), state: 'drafted', draft_id: 'd-1', draft_message_id: 'm-1', draft_hash: 'h', draft_text: 'Hi.\n\nMike', draft_for_ask_id: ids.drafted, drafted_at: new Date(NOW.getTime() - 24 * 3600_000) },
    });
  });

  afterAll(async () => {
    await prisma.calendarEvent.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeOwedThread.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeKeeperSettings.deleteMany({ where: { user_id: { in: users } } });
    await prisma.emailAsk.deleteMany({ where: { account: acct } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('switch off (no settings row)', () => {
    it('no button, GET says book_off, the act is refused and writes nothing', async () => {
      const before = await world();
      const item = await rowOnScreen('t1');
      expect(item?.owed_state).toBe('needs_thought');
      expect(buttons(item)).not.toContain('book_block');
      const raw = await loadHomeInputs(prisma, adminId, NOW, { timezone: TZ });
      expect(raw.book_blocks).toBe(false);
      expect(await listBookings(prisma, adminId, NOW)).toEqual({ skipped: 'book_off', create: [], delete: [] });
      await expect(book('t1')).rejects.toMatchObject({ statusCode: 409, code: 'book_off' });
      expect((await owedRow('t1'))!.book_requested_at).toBeNull();
      expect(await prisma.homeAction.count({ where: { user_id: adminId, action: 'book_block' } })).toBe(0);
      expect(await world()).toEqual(before);
    });

    it('with a settings row that says false it is the same', async () => {
      await setSwitch(false);
      expect(buttons(await rowOnScreen('t1'))).not.toContain('book_block');
      await expect(book('t1')).rejects.toMatchObject({ code: 'book_off' });
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('switch on', () => {
    beforeAll(async () => {
      await setSwitch(true);
    });

    it('the button shows on a needs-thought row only, for the owner only', async () => {
      expect(buttons(await rowOnScreen('t1'))).toContain('book_block');
      expect(buttons(await rowOnScreen('drafted'))).not.toContain('book_block');
      const t = (await screen(techId)).candidates.find((c) => c.key === key('t1'));
      expect(buttons(t?.item)).not.toContain('book_block');
      await expect(book('t1', techId)).rejects.toMatchObject({ code: 'book_off' });
      await expect(book('drafted')).rejects.toMatchObject({ code: 'book_not_ready' });
    });

    it('the chat can ask for it too: the home op body schema accepts book_block', () => {
      expect(homeActSchema.safeParse({ action: 'book_block', item_key: key('t1') }).success).toBe(true);
      expect(homeActSchema.safeParse({ action: 'book_block', item_key: key('t1'), attendees: ['x@y.z'] }).success).toBe(false);
    });

    let first = { id: '', start: new Date(0), end: new Date(0) };
    let second = { id: '', start: new Date(0) };

    it('picks the first free half hour on a fake clock with seeded events, honouring each rule', async () => {
      // A meeting 10:00 to 10:40 (blocks 9:40 to 11:10), an all-day event that must not block, an event yesterday and one on Saturday.
      await seedEvent('Standup', at(11, 10, 0), at(11, 10, 40));
      await seedEvent('Holiday', at(11, 0, 0), at(12, 0, 0), true);
      await seedEvent('Old', at(10, 11, 0), at(10, 12, 0));
      const before = await world();
      const res = await book('t1');
      expect(res.message).toBe('Put 30 minutes on your calendar Wednesday at 11:15 to answer Dana Whitfield.');
      expect(res.undo_until).toBe(new Date(NOW.getTime() + 24 * 3600_000).toISOString());
      const row = (await owedRow('t1'))!;
      expect(row.book_requested_at?.toISOString()).toBe(NOW.toISOString());
      expect(hhmm(row.booked_start!)).toBe('11:15');
      expect(row.booked_end!.getTime() - row.booked_start!.getTime()).toBe(30 * 60_000);
      expect(row.booked_event_id).toBeNull();
      first = { id: res.action_id, start: row.booked_start!, end: row.booked_end! };
      const action = await prisma.homeAction.findUnique({ where: { id: res.action_id } });
      expect(action).toMatchObject({ user_id: adminId, action: 'book_block', item_key: key('t1'), source: 'home' });
      expect(await world()).toEqual(before);
    });

    it('a second tap in the same minute never takes the same time, and keeps the margins around the first', async () => {
      const res = await book('t3');
      const row = (await owedRow('t3'))!;
      // The first block holds 11:15 to 11:45, so 20 minutes before and 30 after: the next start is 12:15.
      expect(hhmm(row.booked_start!)).toBe('12:15');
      second = { id: res.action_id, start: row.booked_start! };
    });

    it('a row with a request or a block cannot be booked twice', async () => {
      await expect(book('t1')).rejects.toMatchObject({ code: 'already_booked' });
      expect(buttons(await rowOnScreen('t1'))).not.toContain('book_block');
    });

    it('the Handled line says when, with Undo, and the dry run lists the request exactly', async () => {
      const r = await screen();
      const line = r.sections.handled.find((l) => l.id === first.id);
      expect(line?.text).toBe('Put 30 minutes on your calendar Wednesday at 11:15 to answer Dana Whitfield.');
      expect(line?.undo_action_id).toBe(first.id);
      const g = await listBookings(prisma, adminId, NOW);
      expect(g.skipped).toBeUndefined();
      expect(g.delete).toEqual([]);
      const c = g.create.find((x) => x.thread_key === key('t1'))!;
      expect(c).toEqual({
        thread_key: key('t1'),
        title: 'Answer Dana Whitfield',
        description: `https://mail.google.com/mail/u/0/#inbox/${mid('t1')}`,
        start: first.start.toISOString(),
        end: first.end.toISOString(),
        calendar: 'primary',
        account: 'mike@becomeindelible.com',
      });
      expect(g.window).toEqual({ from: NOW.toISOString(), to: new Date(NOW.getTime() + 5 * 24 * 3600_000).toISOString() });
      expect(Object.keys(c).sort()).toEqual(['account', 'calendar', 'description', 'end', 'start', 'thread_key', 'title']);
    });

    it('the dry run writes nothing', async () => {
      const before = JSON.stringify(await prisma.homeOwedThread.findMany({ where: { user_id: adminId }, orderBy: { thread_key: 'asc' } }));
      await listBookings(prisma, adminId, NOW);
      await listBookings(prisma, adminId, at(11, 9, 0));
      expect(JSON.stringify(await prisma.homeOwedThread.findMany({ where: { user_id: adminId }, orderBy: { thread_key: 'asc' } }))).toBe(before);
    });

    it('a conflict clears the picked slot and the next GET picks again, without writing', async () => {
      const m = await seedEvent('Client call', at(11, 11, 30), at(11, 12, 30));
      const r = await saveBookings(prisma, adminId, bookingsBodySchema.parse({ conflicts: [{ thread_key: key('t1') }] }), NOW);
      expect(r).toEqual({ saved: [{ thread_key: key('t1'), outcome: 'conflict' }], refused: [] });
      const row = (await owedRow('t1'))!;
      expect(row.booked_start).toBeNull();
      expect(row.book_requested_at).not.toBeNull();
      const g = await listBookings(prisma, adminId, NOW);
      const c = g.create.find((x) => x.thread_key === key('t1'))!;
      // The meeting 11:30 to 12:30 blocks 11:10 to 13:00; the second thread holds 12:15 to 12:45 (11:55 to 13:15), so 13:15.
      expect(hhmm(new Date(c.start))).toBe('13:15');
      expect((await owedRow('t1'))!.booked_start).toBeNull();
      await dropEvent(m);
    });

    it('a conflict for a thread with no pending request is refused', async () => {
      const r = await saveBookings(prisma, adminId, bookingsBodySchema.parse({ conflicts: [{ thread_key: key('t2') }] }), NOW);
      expect(r.saved).toEqual([]);
      expect(r.refused).toEqual([{ thread_key: key('t2'), reason: 'no_request' }]);
    });

    it('created shows "Booked ..." on the row and the line stays under Handled', async () => {
      const before = await world();
      const r = await saveBookings(
        prisma,
        adminId,
        bookingsBodySchema.parse({ created: [{ thread_key: key('t1'), event_id: 'g-evt-1', start: first.start.toISOString(), end: first.end.toISOString() }] }),
        NOW,
      );
      expect(r.saved).toEqual([{ thread_key: key('t1'), outcome: 'created' }]);
      const row = (await owedRow('t1'))!;
      expect(row).toMatchObject({ booked_event_id: 'g-evt-1' });
      expect(row.booked_at?.toISOString()).toBe(NOW.toISOString());
      const s = await screen();
      const item = s.candidates.find((c) => c.key === key('t1'))!.item;
      expect(item.owed_booked).toBe('Booked Wednesday at 11:15');
      expect(item.owed_line).toContain('Booked Wednesday at 11:15');
      expect(buttons(item)).not.toContain('book_block');
      const line = s.sections.handled.find((l) => l.id === first.id);
      expect(line?.text).toBe('Put 30 minutes on your calendar Wednesday at 11:15 to answer Dana Whitfield.');
      expect(line?.undo_action_id).toBe(first.id);
      const g = await listBookings(prisma, adminId, NOW);
      expect(g.create.map((x) => x.thread_key)).not.toContain(key('t1'));
      expect(g.delete).toEqual([]);
      expect(await world()).toEqual(before);
    });

    it('a created result with no pending request, or the wrong length, is refused and echoes the event id', async () => {
      const r = await saveBookings(
        prisma,
        adminId,
        bookingsBodySchema.parse({
          created: [
            { thread_key: key('t2'), event_id: 'g-evt-x', start: at(12, 10).toISOString(), end: at(12, 10, 30).toISOString() },
            { thread_key: key('t3'), event_id: 'g-evt-y', start: second.start.toISOString(), end: new Date(second.start.getTime() + 45 * 60_000).toISOString() },
          ],
        }),
        NOW,
      );
      expect(r.saved).toEqual([]);
      expect(r.refused).toEqual([
        { thread_key: key('t2'), reason: 'no_request', event_id: 'g-evt-x' },
        { thread_key: key('t3'), reason: 'bad_slot', event_id: 'g-evt-y' },
      ]);
      expect((await owedRow('t3'))!.booked_event_id).toBeNull();
    });

    it('Undo before the event exists just clears the request', async () => {
      const before = await world();
      const res = await runHomeUndo(prisma, adminId, second.id, NOW);
      expect(res.ok).toBe(true);
      const row = (await owedRow('t3'))!;
      expect(row).toMatchObject({ book_requested_at: null, booked_start: null, booked_end: null, booked_event_id: null, book_undo_requested_at: null });
      const g = await listBookings(prisma, adminId, NOW);
      expect(g.create.map((x) => x.thread_key)).not.toContain(key('t3'));
      expect(g.delete).toEqual([]);
      expect((await screen()).sections.handled.find((l) => l.id === second.id)).toBeUndefined();
      expect(buttons(await rowOnScreen('t3'))).toContain('book_block');
      // A machine result that arrives late finds no request.
      const late = await saveBookings(prisma, adminId, bookingsBodySchema.parse({ created: [{ thread_key: key('t3'), event_id: 'g-late', start: second.start.toISOString(), end: new Date(second.start.getTime() + 30 * 60_000).toISOString() }] }), NOW);
      expect(late.refused).toEqual([{ thread_key: key('t3'), reason: 'no_request', event_id: 'g-late' }]);
      expect(await world()).toEqual(before);
    });

    it('Undo after the event exists asks the machine to delete that one event, then the machine confirms', async () => {
      const before = await world();
      await runHomeUndo(prisma, adminId, first.id, NOW);
      const row = (await owedRow('t1'))!;
      expect(row.booked_event_id).toBe('g-evt-1');
      expect(row.book_undo_requested_at?.toISOString()).toBe(NOW.toISOString());
      const g = await listBookings(prisma, adminId, NOW);
      expect(g.delete).toEqual([{ thread_key: key('t1'), event_id: 'g-evt-1' }]);
      expect(g.create).toEqual([]);
      const s = await screen();
      expect(s.sections.handled.find((l) => l.id === first.id)).toBeUndefined();
      expect(s.candidates.find((c) => c.key === key('t1'))!.item.owed_booked ?? null).toBeNull();
      expect(buttons(s.candidates.find((c) => c.key === key('t1'))!.item)).not.toContain('book_block');
      await expect(runHomeUndo(prisma, adminId, first.id, NOW)).rejects.toMatchObject({ code: 'undo_used' });

      const wrong = await saveBookings(prisma, adminId, bookingsBodySchema.parse({ deleted: [{ thread_key: key('t1'), event_id: 'other-event' }] }), NOW);
      expect(wrong.refused).toEqual([{ thread_key: key('t1'), reason: 'no_such_event' }]);
      const ok = await saveBookings(prisma, adminId, bookingsBodySchema.parse({ deleted: [{ thread_key: key('t1'), event_id: 'g-evt-1' }] }), NOW);
      expect(ok.saved).toEqual([{ thread_key: key('t1'), outcome: 'deleted' }]);
      expect(await owedRow('t1')).toMatchObject({ book_requested_at: null, booked_event_id: null, booked_start: null, book_undo_requested_at: null });
      expect((await listBookings(prisma, adminId, NOW)).delete).toEqual([]);
      expect(buttons(await rowOnScreen('t1'))).toContain('book_block');
      expect(await world()).toEqual(before);
    });

    it('Undo is refused after 24 hours', async () => {
      const res = await book('t4');
      await expect(runHomeUndo(prisma, adminId, res.action_id, new Date(NOW.getTime() + 25 * 3600_000))).rejects.toMatchObject({ code: 'undo_expired' });
      await runHomeUndo(prisma, adminId, res.action_id, NOW);
    });

    it('a delete the machine never asked for is refused (a created block with no Undo)', async () => {
      const res = await book('t5');
      const row = (await owedRow('t5'))!;
      await saveBookings(prisma, adminId, bookingsBodySchema.parse({ created: [{ thread_key: key('t5'), event_id: 'g-evt-5', start: row.booked_start!.toISOString(), end: row.booked_end!.toISOString() }] }), NOW);
      const r = await saveBookings(prisma, adminId, bookingsBodySchema.parse({ deleted: [{ thread_key: key('t5'), event_id: 'g-evt-5' }] }), NOW);
      expect(r.refused).toEqual([{ thread_key: key('t5'), reason: 'not_requested' }]);
      expect((await owedRow('t5'))!.booked_event_id).toBe('g-evt-5');
      await runHomeUndo(prisma, adminId, res.action_id, NOW);
      await saveBookings(prisma, adminId, bookingsBodySchema.parse({ deleted: [{ thread_key: key('t5'), event_id: 'g-evt-5' }] }), NOW);
    });

    it('three failed creates drop the request and the button comes back', async () => {
      await book('t6');
      for (let i = 0; i < 2; i++) {
        const r = await saveBookings(prisma, adminId, bookingsBodySchema.parse({ failed: [{ thread_key: key('t6'), error: 'gog said no' }] }), NOW);
        expect(r.saved).toEqual([{ thread_key: key('t6'), outcome: 'failed' }]);
        expect((await listBookings(prisma, adminId, NOW)).create.map((x) => x.thread_key)).toContain(key('t6'));
      }
      await saveBookings(prisma, adminId, bookingsBodySchema.parse({ failed: [{ thread_key: key('t6'), error: 'gog said no' }] }), NOW);
      const row = (await owedRow('t6'))!;
      expect(row.book_requested_at).toBeNull();
      expect(row.book_error).toBe('gog said no');
      expect((await listBookings(prisma, adminId, NOW)).create.map((x) => x.thread_key)).not.toContain(key('t6'));
      expect(buttons(await rowOnScreen('t6'))).toContain('book_block');
    });

    it('the title is one plain line of at most 80 characters, with no dash or markup', async () => {
      await book('dashy');
      const c = (await listBookings(prisma, adminId, NOW)).create.find((x) => x.thread_key === key('dashy'))!;
      expect(c.title).toBe('Answer Jess- Lee bx/b');
      expect(c.title).not.toMatch(/[–—\n<>"]/);
      expect(c.title.length).toBeLessThanOrEqual('Answer '.length + 80);
    });

    it('no free half hour in the next two business days: a plain refusal and nothing written', async () => {
      const wall = [await seedEvent('Wed full', at(11, 9, 0), at(11, 18, 0)), await seedEvent('Thu full', at(12, 9, 0), at(12, 18, 0))];
      const before = await world();
      const rowBefore = JSON.stringify(await owedRow('t2'));
      const actions = await prisma.homeAction.count({ where: { user_id: adminId } });
      await expect(book('t2')).rejects.toMatchObject({ statusCode: 409, code: 'no_free_slot', message: NO_FREE_SLOT });
      expect(NO_FREE_SLOT).toBe('No free half hour found in the next two days.');
      expect(JSON.stringify(await owedRow('t2'))).toBe(rowBefore);
      expect(await prisma.homeAction.count({ where: { user_id: adminId } })).toBe(actions);
      expect(await world()).toEqual(before);
      for (const e of wall) await dropEvent(e);
    });

    it('other users are untouched: no booking column, no action row, no settings row', async () => {
      expect(await prisma.homeOwedThread.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
      expect(await prisma.homeAction.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
      expect(await prisma.homeKeeperSettings.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
      const raw = await loadHomeInputs(prisma, techId, NOW, { timezone: TZ });
      expect(raw.book_blocks).toBe(false);
      expect(raw.owed_books).toEqual([]);
    });

    it('a machine result for a user who is not on the home screen is skipped', async () => {
      await prisma.userPreference.update({ where: { user_id: adminId }, data: { home_view: 'overlook' } });
      expect(await listBookings(prisma, adminId, NOW)).toEqual({ skipped: 'home_off', create: [], delete: [] });
      expect(await saveBookings(prisma, adminId, bookingsBodySchema.parse({ conflicts: [{ thread_key: key('t1') }] }), NOW)).toEqual({ skipped: 'home_off', saved: [], refused: [] });
      await prisma.userPreference.update({ where: { user_id: adminId }, data: { home_view: 'home' } });
    });
  });
});
