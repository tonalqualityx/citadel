// @vitest-environment node
/**
 * Slice 4b against a real Postgres: "Send the draft" through the mail outbox with the 10-minute hold, shipped switched OFF.
 * The routes are called as functions with the login mocked (a browser session, or an API key). Skips unless DATABASE_URL
 * names the scratch Postgres on localhost:55433. Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s4b_it npx vitest run lib/home/__tests__/slice4b.integration.test.ts
 *
 * The first block is the deployed state: NO home_keeper_settings row. It proves the screen has no Send button and nothing can
 * be queued by any path. The rest turns the switch on inside the test only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/middleware')>();
  return { ...actual, requireAuth: vi.fn() };
});

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { runHomeUndo } from '../act';
import { threadKey } from '../item-key';
import { queueInOutbox } from '@/lib/sends/outbox';
import { POST as sendRoute } from '@/app/api/home/send/route';
import { POST as undoRoute } from '@/app/api/home/undo/route';
import { GET as listRoute } from '@/app/api/email-outbox/route';
import { POST as claimRoute } from '@/app/api/email-outbox/[id]/claim/route';
import { POST as sentRoute } from '@/app/api/email-outbox/[id]/sent/route';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const MIN = 60_000;

describe.skipIf(!SCRATCH)('Slice 4b: Send the draft (real database)', () => {
  const tag = `s4b-${Date.now()}`;
  const acct = `a-${tag}@example.test`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const courierId = randomUUID();
  const mid = (k: string) => `${tag}-${k}`;
  const ids: Record<string, string> = {};
  const outboxIds: string[] = [];
  let clientId = '';
  type Who = 'admin' | 'tech' | 'overlook' | 'chatkey' | 'courier' | 'courierkey';
  const login = (who: Who) => {
    const m: Record<Who, Record<string, unknown>> = {
      admin: { userId: adminId, role: 'admin', via: 'session' },
      tech: { userId: techId, role: 'tech', via: 'session' },
      overlook: { userId: overlookAdminId, role: 'admin', via: 'session' },
      chatkey: { userId: adminId, role: 'admin', via: 'api_key' },
      courier: { userId: courierId, role: 'pm', via: 'session' },
      courierkey: { userId: courierId, role: 'pm', via: 'api_key' },
    };
    vi.mocked(requireAuth).mockResolvedValue({ email: 'x@example.test', ...m[who] } as never);
  };
  const jreq = (url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const key = (thread: string) => threadKey(acct, mid(thread));
  const press = async (thread: string, draft: string, who: Who = 'admin') => {
    login(who);
    return sendRoute(jreq('/api/home/send', { item_key: key(thread), draft_id: draft }));
  };
  const undo = async (actionId: string, who: Who = 'admin') => {
    login(who);
    return undoRoute(jreq('/api/home/undo', { action_id: actionId }));
  };
  const claim = async (id: string, who: Who = 'courier') => {
    login(who);
    return claimRoute(jreq(`/api/email-outbox/${id}/claim`), { params: Promise.resolve({ id }) });
  };
  const markSent = async (id: string) => {
    login('courier');
    return sentRoute(jreq(`/api/email-outbox/${id}/sent`, { message_id: 'gm-1', gmail_thread_id: 'gt-1' }), { params: Promise.resolve({ id }) });
  };
  const listing = async (qs = '') => {
    login('courier');
    const res = await listRoute(new NextRequest(`http://localhost:3000/api/email-outbox${qs}`));
    return { status: res.status, items: ((await res.json()).items ?? []) as Array<{ id: string; kind: string }> };
  };
  const screen = async (userId = adminId, now = new Date()) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, now, { timezone: TZ }), loadItemStates(prisma, userId)]);
    return selectHome({ raw, states, now });
  };
  const rowOnScreen = async (thread: string) => (await screen()).candidates.find((c) => c.key === key(thread))?.item;
  const buttons = (item: { actions: Array<{ id: string }>; more_actions: Array<{ id: string }> } | undefined) => [...(item?.actions ?? []), ...(item?.more_actions ?? [])].map((a) => a.id);
  const owedCount = () => prisma.emailOutbox.count({ where: { kind: 'owed_reply' } });
  const outboxOf = (actionId: string) => prisma.homeAction.findUnique({ where: { id: actionId } }).then((a) => (a?.after as { outbox_id: string }).outbox_id);
  const setSwitch = (on: boolean) => prisma.homeKeeperSettings.upsert({ where: { user_id: adminId }, create: { user_id: adminId, owed_send: on }, update: { owed_send: on } });
  const pastHold = (id: string, ms = 1000) => prisma.emailOutbox.update({ where: { id }, data: { send_after: new Date(Date.now() - ms) } });

  const ask = (k: string, over: Record<string, unknown> = {}) =>
    prisma.emailAsk.create({
      data: {
        message_id: mid(k), thread_id: mid(k), account: acct, from_name: 'Dana Whitfield', from_email: `${k}@client.example`, subject: `Photos ${k}`,
        gist: `Gist ${k}.`, queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', client_id: clientId,
        deep_link: `https://mail.google.com/mail/u/0/#inbox/${mid(k)}`, received_at: new Date(Date.now() - 4 * 24 * 3600_000), ...over,
      },
    });
  const draftRow = (k: string, over: Record<string, unknown> = {}) =>
    prisma.homeOwedThread.create({
      data: { user_id: adminId, thread_key: key(k), state: 'drafted', draft_id: `d-${k}`, draft_message_id: `m-${k}`, draft_hash: 'h', draft_text: `Hi Dana,\n\nThanks, got this. I'll get back to you.\n\nMike`, draft_for_ask_id: ids[k], drafted_at: new Date(Date.now() - 2 * 24 * 3600_000), ...over },
    });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 4b', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 4b', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 4b', role: 'admin' },
        { id: courierId, email: `courier-${tag}@example.test`, password_hash: 'x', name: 'Courier 4b', role: 'pm' },
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
    for (const k of ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 'blank', 'stale', 'edited']) ids[k] = (await ask(k)).id;
    for (const k of ['t1', 't2', 't3', 't4', 't5', 't6', 't7']) await draftRow(k);
    await draftRow('blank', { draft_text: 'Dear [[name]], hello.' });
    await draftRow('stale', { draft_for_ask_id: randomUUID() });
    await draftRow('edited', { mike_edited_at: new Date() });
  });

  afterAll(async () => {
    const users = [adminId, techId, overlookAdminId, courierId];
    await prisma.emailOutbox.deleteMany({ where: { OR: [{ id: { in: outboxIds } }, { to: { endsWith: '@client.example' }, subject: { contains: 'Photos' } }, { dedupe_key: { startsWith: 'owed:d-' } }] } });
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
  describe('the deployed state: no settings row, the slice is inert', () => {
    it('there is no home_keeper_settings row for anyone', async () => {
      expect(await prisma.homeKeeperSettings.count({ where: { user_id: { in: [adminId, techId, overlookAdminId, courierId] } } })).toBe(0);
    });

    it('the screen has no Send button, no owed_send on any item, no Send line', async () => {
      const r = await screen();
      const row = r.candidates.find((c) => c.key === key('t1'));
      expect(row).toBeDefined();
      expect(row!.item.owed_state).toBe('draft_ready');
      expect(buttons(row!.item).join(' ')).not.toMatch(/send/);
      expect(row!.item.owed_send ?? null).toBeNull();
      expect(r.candidates.filter((c) => c.item.owed_send).length).toBe(0);
      expect(r.sections.handled.filter((l) => /^Sen(d|t)/.test(l.text))).toHaveLength(0);
      const raw = await loadHomeInputs(prisma, adminId, new Date(), { timezone: TZ });
      expect(raw.owed_send).toBe(false);
      expect(raw.owed_sends).toEqual([]);
    });

    it('POST /api/home/send refuses with 409 send_off and creates nothing', async () => {
      const before = { outbox: await owedCount(), actions: await prisma.homeAction.count({ where: { action: 'send_draft' } }) };
      const res = await press('t1', 'd-t1');
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('send_off');
      expect(await owedCount()).toBe(before.outbox);
      expect(await prisma.homeAction.count({ where: { action: 'send_draft' } })).toBe(before.actions);
    });

    it('queueInOutbox cannot make an owed_reply row either, with a correct-looking govern block', async () => {
      const govern = { intent: 'owed_reply' as const, home_action_id: randomUUID(), user_id: adminId, ask_ids: [ids.t1], account: acct, thread_id: mid('t1'), draft_id: 'd-t1' };
      await expect(
        queueInOutbox(prisma, { kind: 'owed_reply', to: 'x@client.example', subject: 'Re: Photos', text: 't', send_after: new Date(Date.now() + 10 * MIN), dedupe_key: 'owed:d-direct0' }, govern),
      ).rejects.toThrow('send_off');
      expect(await owedCount()).toBe(0);
    });

    it('with the switch row present but false, the same', async () => {
      await setSwitch(false);
      expect((await press('t1', 'd-t1')).status).toBe(409);
      expect(await owedCount()).toBe(0);
      expect(buttons(await rowOnScreen('t1')).join(' ')).not.toMatch(/send/);
      await prisma.homeKeeperSettings.deleteMany({ where: { user_id: adminId } });
    });

    it('the claim route would refuse any owed row as send_off (a row that slipped in before the switch went off)', async () => {
      // Built the only way left: with the switch on for an instant, then off.
      await setSwitch(true);
      const res = await press('t6', 'd-t6');
      expect(res.status).toBe(200);
      const actionId = (await res.json()).action_id as string;
      const oid = await outboxOf(actionId);
      outboxIds.push(oid);
      await setSwitch(false);
      await pastHold(oid);
      const c = await claim(oid);
      expect(c.status).toBe(409);
      expect((await c.json()).code).toBe('send_off');
      const row = await prisma.emailOutbox.findUnique({ where: { id: oid } });
      expect(row?.claimed_at).toBeNull();
      expect(row?.sent_at).toBeNull();
      // The screen says it did not go, and the thread is back.
      const r = await screen();
      expect(r.sections.handled.find((l) => l.id === actionId)?.text).toBe('Not sent: sending is turned off. The draft is still in your Gmail.');
      expect(r.candidates.find((c2) => c2.key === key('t6'))).toBeDefined();
      // Clean up this one so later blocks start empty.
      await prisma.emailOutbox.update({ where: { id: oid }, data: { superseded_at: new Date(), superseded_reason: 'test_cleanup' } });
      await prisma.homeAction.update({ where: { id: actionId }, data: { undone_at: new Date() } });
      await prisma.homeKeeperSettings.deleteMany({ where: { user_id: adminId } });
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('who may press', () => {
    it('API keys of every kind get 403 (the chat key, the courier key, an admin key)', async () => {
      await setSwitch(true);
      const before = await owedCount();
      for (const who of ['chatkey', 'courierkey'] as Who[]) expect((await press('t2', 'd-t2', who)).status).toBe(403);
      expect(await owedCount()).toBe(before);
    });
    it('a tech user and an overlook admin get 403 and have no send rows', async () => {
      for (const who of ['tech', 'overlook'] as Who[]) expect((await press('t2', 'd-t2', who)).status).toBe(403);
      expect(await prisma.homeAction.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
      expect((await screen(techId)).candidates.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('with the switch on, in the test only', () => {
    it('the screen offers Send the draft first, only on the current untouched draft', async () => {
      const t1 = await rowOnScreen('t1');
      expect(buttons(t1)[0]).toBe('send_draft');
      expect(t1!.owed_send).toEqual({ draft_id: 'd-t1', short_draft_id: null });
      for (const k of ['blank', 'stale', 'edited']) expect(buttons(await rowOnScreen(k)).join(' ')).not.toMatch(/send_draft/);
    });

    it('a draft that is not current, edited by him, or holds a blank is refused', async () => {
      const before = await owedCount();
      for (const [k, code] of [['stale', 'not_current'], ['edited', 'not_current'], ['blank', 'draft_blank']] as const) {
        const res = await press(k, `d-${k}`);
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe(code);
      }
      expect((await press('t1', 'a-different-draft')).status).toBe(409);
      expect(await owedCount()).toBe(before);
    });

    it('no press: a row inserted directly with queueInOutbox is held, then 409 no_press once the hold has passed', async () => {
      const govern = { intent: 'owed_reply' as const, home_action_id: randomUUID(), user_id: adminId, ask_ids: [ids.t3], account: acct, thread_id: mid('t3'), draft_id: 'd-t3' };
      const { id } = await queueInOutbox(prisma, { kind: 'owed_reply', to: 't3@client.example', subject: 'Re: Photos t3', text: 'x', from_account: acct, send_after: new Date(Date.now() + 10 * MIN), dedupe_key: 'owed:d-direct1' }, govern);
      outboxIds.push(id);
      const early = await claim(id);
      expect(early.status).toBe(409);
      expect((await early.json()).code).toBe('held');
      await pastHold(id);
      const res = await claim(id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'superseded', reason: 'no_press' });
      const row = await prisma.emailOutbox.findUnique({ where: { id } });
      expect(row?.superseded_reason).toBe('no_press');
      expect(row?.sent_at).toBeNull();
      expect((await claim(id)).status).toBe(409);
    });

    it('a press on a real action of another thread or draft is no_press too', async () => {
      const real = await press('t7', 'd-t7');
      const actionId = (await real.json()).action_id as string;
      const realOutbox = await outboxOf(actionId);
      outboxIds.push(realOutbox);
      const govern = { intent: 'owed_reply' as const, home_action_id: actionId, user_id: adminId, ask_ids: [ids.t3], account: acct, thread_id: mid('t3'), draft_id: 'd-t3' };
      const { id } = await queueInOutbox(prisma, { kind: 'owed_reply', to: 't3@client.example', subject: 'Re: Photos t3', text: 'x', from_account: acct, send_after: new Date(Date.now() + 10 * MIN), dedupe_key: 'owed:d-direct2' }, govern);
      outboxIds.push(id);
      await pastHold(id);
      expect(await (await claim(id)).json()).toMatchObject({ reason: 'no_press' });
      // Put t7 back: undo the real press.
      expect((await undo(actionId)).status).toBe(200);
    });

    it('the full chain: press, hold, undo, press again, claim after the hold, sent', async () => {
      const asksBefore = JSON.stringify(await prisma.emailAsk.findMany({ where: { account: acct }, orderBy: { message_id: 'asc' }, select: { id: true, state: true, updated_at: true } }));
      const tasksBefore = await prisma.task.count();
      const res = await press('t1', 'd-t1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(new Date(body.send_after).getTime() - Date.now()).toBeGreaterThan(9 * MIN);
      expect(new Date(body.send_after).getTime() - Date.now()).toBeLessThanOrEqual(10 * MIN);
      expect(body.message).toMatch(/^Sending your reply to Dana Whitfield at \d{1,2}:\d{2} (AM|PM)\.$/);
      const oid = await outboxOf(body.action_id);
      outboxIds.push(oid);

      // What was queued.
      const row = await prisma.emailOutbox.findUnique({ where: { id: oid } });
      expect(row).toMatchObject({ kind: 'owed_reply', from_account: acct, to: 't1@client.example', subject: 'Re: Photos t1', allow_external: true, dedupe_key: 'owed:d-t1', claimed_at: null, sent_at: null });
      expect(row?.send_after?.getTime()).toBe(new Date(body.send_after).getTime());
      expect(row?.govern).toMatchObject({ intent: 'owed_reply', home_action_id: body.action_id, user_id: adminId, ask_ids: [ids.t1], draft_id: 'd-t1' });
      const action = await prisma.homeAction.findUnique({ where: { id: body.action_id } });
      expect(action).toMatchObject({ action: 'send_draft', source: 'home', user_id: adminId, item_key: key('t1'), undone_at: null });
      expect(action?.undo_until?.getTime()).toBe(row?.send_after?.getTime());

      // The row leaves People; Handled for you says so, with Undo.
      const r = await screen();
      expect(r.candidates.find((c) => c.key === key('t1'))).toBeUndefined();
      const line = r.sections.handled.find((l) => l.id === body.action_id);
      expect(line?.text).toMatch(/^Sending your reply to Dana Whitfield at \d{1,2}:\d{2} (AM|PM)\.$/);
      expect(line?.undo_action_id).toBe(body.action_id);

      // The drain's default listing never includes it, held or due. The owed listing shows it only when due.
      expect((await listing()).items.map((i) => i.id)).not.toContain(oid);
      expect((await listing('?kind=owed_reply')).items.map((i) => i.id)).not.toContain(oid);

      // Pressed but held: 409 held, row untouched.
      const held = await claim(oid);
      expect(held.status).toBe(409);
      expect((await held.json()).code).toBe('held');
      expect((await prisma.emailOutbox.findUnique({ where: { id: oid } }))?.claimed_at).toBeNull();

      // Pressing again while it waits is refused.
      expect((await press('t1', 'd-t1')).status).toBe(409);

      // Undo during the hold: the row is superseded for good, the thread comes back, the line goes.
      const u = await undo(body.action_id);
      expect(u.status).toBe(200);
      expect(await u.json()).toMatchObject({ ok: true, action_id: body.action_id, item_key: key('t1') });
      const dead = await prisma.emailOutbox.findUnique({ where: { id: oid } });
      expect(dead).toMatchObject({ superseded_reason: 'cancelled_by_mike', dedupe_key: null, sent_at: null, claimed_at: null });
      expect((await undo(body.action_id)).status).toBe(409);
      const back = await screen();
      expect(back.candidates.find((c) => c.key === key('t1'))).toBeDefined();
      expect(back.sections.handled.find((l) => l.id === body.action_id)).toBeUndefined();
      // Even with the hold forced past, an undone press is superseded.
      await pastHold(oid);
      const gone = await claim(oid);
      expect(gone.status).toBe(409);
      expect((await gone.json()).code).toBe('superseded');
      expect((await listing('?kind=owed_reply')).items.map((i) => i.id)).not.toContain(oid);

      // Press again after an undo: allowed (the dedupe key was freed).
      const again = await press('t1', 'd-t1');
      expect(again.status).toBe(200);
      const a2 = (await again.json()).action_id as string;
      const oid2 = await outboxOf(a2);
      outboxIds.push(oid2);
      expect(oid2).not.toBe(oid);

      // The chat's undo (runHomeUndo) cannot touch a live send row: it is refused, and the held row is untouched.
      await expect(runHomeUndo(prisma, adminId, a2, new Date())).rejects.toMatchObject({ code: 'not_undoable', message: 'Undo that on the home screen.' });
      expect(await prisma.emailOutbox.findUnique({ where: { id: oid2 } })).toMatchObject({ superseded_at: null, claimed_at: null });
      expect((await prisma.homeAction.findUnique({ where: { id: a2 } }))?.undone_at).toBeNull();

      // After the hold: only now the claim reaches 200, and it returns the row with its body.
      await pastHold(oid2);
      const due = await listing('?kind=owed_reply');
      expect(due.items.map((i) => i.id)).toContain(oid2);
      expect((await listing()).items.map((i) => i.id)).not.toContain(oid2);
      const ok = await claim(oid2);
      expect(ok.status).toBe(200);
      const claimed = await ok.json();
      expect(claimed).toMatchObject({ id: oid2, kind: 'owed_reply', from_account: acct });
      expect(claimed.text).toContain('Thanks, got this.');
      // A second claim does not repeat it.
      expect((await claim(oid2)).status).toBe(409);
      // Undo is over.
      await prisma.homeAction.update({ where: { id: a2 }, data: { undo_until: new Date(Date.now() - 1000) } });
      const late = await undo(a2);
      expect(late.status).toBe(409);
      expect((await late.json()).code).toBe('undo_expired');

      // The courier records the send: the line turns to Sent with no Undo, the owed row stops being a draft.
      expect((await markSent(oid2)).status).toBe(200);
      const sentRow = await prisma.emailOutbox.findUnique({ where: { id: oid2 } });
      expect(sentRow?.sent_at).toBeInstanceOf(Date);
      expect(sentRow?.text).toBe('[sent; body removed]');
      const owed = await prisma.homeOwedThread.findUnique({ where: { user_id_thread_key: { user_id: adminId, thread_key: key('t1') } } });
      expect(owed).toMatchObject({ state: 'sent', draft_id: null, draft_text: null, draft_hash: null });
      const after = await screen();
      expect(after.candidates.find((c) => c.key === key('t1'))).toBeUndefined();
      const sentLine = after.sections.handled.find((l) => l.id === a2);
      expect(sentLine?.text).toBe("Sent your reply to Dana Whitfield. It can't be undone.");
      expect(sentLine?.undo_action_id).toBeNull();

      // Nothing shared changed: no ask changed state or updated_at, no task was made.
      const asksAfter = JSON.stringify(await prisma.emailAsk.findMany({ where: { account: acct }, orderBy: { message_id: 'asc' }, select: { id: true, state: true, updated_at: true } }));
      expect(asksAfter).toBe(asksBefore);
      expect(await prisma.task.count()).toBe(tasksBefore);
    });

    it('the switch going off during the hold stops the claim (send_off), and going on again lets the same row through', async () => {
      const res = await press('t2', 'd-t2');
      const actionId = (await res.json()).action_id as string;
      const oid = await outboxOf(actionId);
      outboxIds.push(oid);
      await pastHold(oid);
      await setSwitch(false);
      const off = await claim(oid);
      expect(off.status).toBe(409);
      expect((await off.json()).code).toBe('send_off');
      expect(await prisma.emailOutbox.findUnique({ where: { id: oid } })).toMatchObject({ claimed_at: null, superseded_at: null });
      await setSwitch(true);
      expect((await claim(oid)).status).toBe(200);
    });

    it('a mail that was answered meanwhile is already_replied, final', async () => {
      const res = await press('t3', 'd-t3');
      const actionId = (await res.json()).action_id as string;
      const oid = await outboxOf(actionId);
      outboxIds.push(oid);
      await prisma.emailAsk.update({ where: { id: ids.t3 }, data: { state: 'handled' } });
      await pastHold(oid);
      const c = await claim(oid);
      expect(c.status).toBe(409);
      expect(await c.json()).toMatchObject({ code: 'superseded', reason: 'already_replied' });
      const r = await screen();
      expect(r.sections.handled.find((l) => l.id === actionId)?.text).toBe('Not sent: the thread already has a reply. The draft is still in your Gmail.');
    });

    it('a row left for 7 hours is expired, final', async () => {
      const res = await press('t4', 'd-t4');
      const oid = await outboxOf((await res.json()).action_id);
      outboxIds.push(oid);
      await pastHold(oid, 7 * 3600_000);
      expect(await (await claim(oid)).json()).toMatchObject({ reason: 'expired' });
    });

    it('the short draft follows the same door and the same checks', async () => {
      await prisma.homeOwedThread.update({ where: { user_id_thread_key: { user_id: adminId, thread_key: key('t5') } }, data: { short_draft_id: 's-t5', short_draft_hash: 'h', short_draft_text: 'Thanks, got this. I will get back to you.' } });
      const item = await rowOnScreen('t5');
      expect(item!.owed_send).toEqual({ draft_id: 'd-t5', short_draft_id: 's-t5' });
      expect(buttons(item)).toContain('send_short');
      expect((await press('t5', 'not-the-short-one')).status).toBe(409);
      const res = await press('t5', 's-t5');
      expect(res.status).toBe(200);
      const actionId = (await res.json()).action_id as string;
      const oid = await outboxOf(actionId);
      outboxIds.push(oid);
      const row = await prisma.emailOutbox.findUnique({ where: { id: oid } });
      expect(row?.text).toBe('Thanks, got this. I will get back to you.');
      expect(row?.dedupe_key).toBe('owed:s-t5');
      expect(await claim(oid)).toHaveProperty('status', 409); // still held
      await pastHold(oid);
      expect((await claim(oid)).status).toBe(200);
    });

    it('other outbox kinds are unchanged: no hold on a null send_after, listed by default, claimed as before', async () => {
      const plain = await prisma.emailOutbox.create({ data: { to: `plain@client.example`, subject: 'Photos plain', text: 'x', kind: 'other', dedupe_key: `owed:d-plain-${tag}` } });
      outboxIds.push(plain.id);
      const l = await listing();
      expect(l.status).toBe(200);
      expect(l.items.map((i) => i.id)).toContain(plain.id);
      expect(l.items.filter((i) => i.kind === 'owed_reply')).toEqual([]);
      expect((await listing('?kind=other')).status).toBe(400);
      const c = await claim(plain.id);
      expect(c.status).toBe(200);
      expect((await c.json()).send_after).toBeNull();
    });
  });
});
