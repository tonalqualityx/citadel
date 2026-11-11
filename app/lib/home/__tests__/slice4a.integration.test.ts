// @vitest-environment node
/**
 * Slice 4a against a real Postgres: Bast's owed-reply drafts. The queue, the saved results, the taps and the owner gate,
 * with the proof that nothing outside the home tables changes and that nothing can send.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It seeds its own users, client and asks and
 * removes only those. Run on its own clean database (other slices' files count global rows):
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s4a_it npx vitest run lib/home/__tests__/slice4a.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { assembleHomeResponse, proposeDay } from '../today';
import { runHomeAct, runHomeUndo, zonedDateString } from '../act';
import { threadKey } from '../item-key';
import { listOwedWork, saveOwedResults, type OwedResultItem } from '../owed/store';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
/** Wednesday 2026-11-11, 07:00 Eastern. */
const NOW = new Date('2026-11-11T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DRAFT = 'Hi Pat,\n\nThanks for writing. I will get back to you.\n\nMike';

describe.skipIf(!SCRATCH)('Slice 4a: owed replies (real database)', () => {
  const tag = `s4a-${Date.now()}`;
  const account = `owner-${tag}@example.test`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const mid = (k: string) => `${tag}-${k}`;
  const askIds: Record<string, string> = {};
  let clientId = '';
  let snapshot = '';

  const ask = (key: string, thread: string, over: Record<string, unknown> = {}) =>
    prisma.emailAsk.create({
      data: {
        message_id: mid(key),
        thread_id: mid(thread),
        account,
        from_name: `Person ${key}`,
        from_email: `${key}@client.example`,
        subject: `Subject ${key}`,
        gist: `Gist ${key}.`,
        queue: 'answer',
        severity: 'internal',
        is_urgent: false,
        state: 'open',
        client_id: clientId,
        deep_link: `https://mail.google.com/mail/u/0/#inbox/${mid(thread)}`,
        received_at: new Date(NOW.getTime() - 2 * DAY),
        ...over,
      },
    });
  const key = (thread: string) => threadKey(account, mid(thread));

  async function screen(userId = adminId) {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, NOW, { timezone: TZ }), loadItemStates(prisma, userId)]);
    const sel = selectHome({ raw, states, now: NOW });
    const day = proposeDay(sel, raw.calendar_events, NOW);
    return { sel, resp: assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now: NOW, timezone: TZ, user_id: userId }) };
  }
  /** The row as the screen builds it, whichever section the caps put it in. */
  const rowFor = async (thread: string) => (await screen()).sel.byKey.get(key(thread))?.item;
  const queueKeys = async () => (await listOwedWork(prisma, adminId, NOW, 6)).items.map((i) => i.thread_key);
  const act = (req: Parameters<typeof runHomeAct>[2]) => runHomeAct(prisma, adminId, req, { now: NOW, timezone: TZ, date: zonedDateString(NOW, TZ) });

  async function counts() {
    const asks = await prisma.emailAsk.findMany({ where: { account }, orderBy: { message_id: 'asc' }, select: { id: true, state: true, draft_url: true, updated_at: true } });
    const tasks = await prisma.task.findMany({ select: { id: true, updated_at: true } });
    const outbox = await prisma.emailOutbox.findMany({ select: { id: true } });
    return JSON.stringify({ asks, tasks, outbox });
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 4a', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 4a', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 4a', role: 'admin' },
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

    // lead: no draft, any age
    askIds.lead = (await ask('lead', 'lead', { intent: 'sales', received_at: new Date(NOW.getTime() - 5 * HOUR), client_id: null })).id;
    // a client thread two business days old with no draft
    askIds.client = (await ask('client', 'client', { received_at: new Date('2026-11-09T15:00:00Z') })).id;
    // his own draft
    askIds.his = (await ask('his', 'his', { draft_url: 'https://mail.google.com/mail/u/0/#drafts/x', draft_started_at: new Date(NOW.getTime() - DAY) })).id;
    // a crisis ask
    askIds.crisis = (await ask('crisis', 'crisis', { is_urgent: true, severity: 'client_blocking', queue: 'do' })).id;
    // a Bast row for an older ask (two asks on the thread)
    askIds.redraft1 = (await ask('redraft1', 'redraft', { received_at: new Date('2026-11-06T15:00:00Z') })).id;
    askIds.redraft2 = (await ask('redraft2', 'redraft', { received_at: new Date('2026-11-09T14:00:00Z') })).id;
    await prisma.homeOwedThread.create({
      data: { user_id: adminId, thread_key: key('redraft'), state: 'drafted', draft_id: 'd-r', draft_message_id: 'm-r', draft_hash: 'h', draft_text: 'Earlier draft.', draft_for_ask_id: askIds.redraft1, drafted_at: new Date('2026-11-07T15:00:00Z') },
    });
    // a needs-thought row with a suggested answer
    askIds.thought = (await ask('thought', 'thought', { received_at: new Date('2026-11-08T15:00:00Z') })).id;
    await prisma.homeOwedThread.create({
      data: { user_id: adminId, thread_key: key('thought'), state: 'needs_thought', bast_read: 'They are asking for new work.', suggested_answer: 'Ask what the page is for.', thought_since: NOW },
    });
    snapshot = await counts();
  });

  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { user_id: { in: [adminId, techId, overlookAdminId] } } });
    await prisma.homeOwedThread.deleteMany({ where: { user_id: { in: [adminId, techId, overlookAdminId] } } });
    await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: [adminId, techId, overlookAdminId] } } });
    await prisma.emailAsk.deleteMany({ where: { account } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, techId, overlookAdminId] } } });
    await prisma.$disconnect();
  });

  it('the queue lists the redraft first, then the lead and the client thread, never the crisis, his draft or the needs-thought thread', async () => {
    expect(await queueKeys()).toEqual([key('redraft'), key('lead'), key('client')]);
    const items = (await listOwedWork(prisma, adminId, NOW, 6)).items;
    expect(items[0]).toMatchObject({ lead: false, bast_draft: { draft_id: 'd-r', for_ask_id: askIds.redraft1 }, newest: { ask_id: askIds.redraft2 } });
    expect(items[1]).toMatchObject({ lead: true, request: null });
  });

  it('a stale result (not the newest ask) is refused 409 and writes nothing for it', async () => {
    const before = await prisma.homeOwedThread.findUnique({ where: { user_id_thread_key: { user_id: adminId, thread_key: key('redraft') } } });
    const r = await saveOwedResults(prisma, adminId, [{ thread_key: key('redraft'), newest_ask_id: askIds.redraft1, outcome: 'drafted', draft_id: 'd-x', draft_message_id: 'm-x', draft_text: DRAFT, model: 'sonnet' }], NOW);
    expect(r.saved).toEqual([]);
    expect(r.refused).toEqual([{ thread_key: key('redraft'), reason: 'stale', status: 409 }]);
    const after = await prisma.homeOwedThread.findUnique({ where: { user_id_thread_key: { user_id: adminId, thread_key: key('redraft') } } });
    expect(after?.draft_id).toBe(before?.draft_id);
    expect(after?.updated_at.getTime()).toBe(before?.updated_at.getTime());
  });

  it('a draft with a price in it is refused and nothing is saved', async () => {
    const r = await saveOwedResults(prisma, adminId, [{ thread_key: key('client'), newest_ask_id: askIds.client, outcome: 'drafted', draft_id: 'd-p', draft_message_id: 'm-p', draft_text: 'That would be $1,500.', model: 'sonnet' }], NOW);
    expect(r.saved).toEqual([]);
    expect(r.refused[0]).toMatchObject({ thread_key: key('client'), reason: 'draft_money' });
    expect(await prisma.homeOwedThread.count({ where: { user_id: adminId, thread_key: key('client') } })).toBe(0);
  });

  it('POSTed results render Draft ready with the text and Needs thought with the read, and write one keeper line with no Undo', async () => {
    const items: OwedResultItem[] = [
      { thread_key: key('client'), newest_ask_id: askIds.client, outcome: 'drafted', draft_id: 'd-c', draft_message_id: 'm-c', draft_text: DRAFT, model: 'sonnet', cost_usd: 0.05 },
      { thread_key: key('lead'), newest_ask_id: askIds.lead, outcome: 'needs_thought', read: 'The reply needs a price from you.', suggested_answer: null, needs_commitment: true, model: 'sonnet' },
    ];
    const r = await saveOwedResults(prisma, adminId, items, NOW);
    expect(r.saved.map((s) => s.outcome)).toEqual(['drafted', 'needs_thought']);
    expect(r.line).toBe('Drafted a reply to Person client. It is in your Gmail drafts.');

    const drafted = await rowFor('client');
    expect(drafted?.owed_state).toBe('draft_ready');
    expect(drafted?.owed_line).toBe('Draft ready');
    expect(drafted?.opened.draft_text).toBe(DRAFT);
    expect(drafted?.actions.map((a) => a.id)).toEqual(['open_draft', 'needs_thought', 'not_now']);
    expect(drafted?.default_if_ignored).toBe('The draft waits in your Gmail. Nothing is sent until you send it.');

    const thought = await rowFor('lead');
    expect(thought?.owed_state).toBe('needs_thought');
    expect(thought?.owed_line).toBe('reply due Friday · Needs thought');
    expect(thought?.opened.bast_read).toBe('The reply needs a price from you.');
    expect(thought?.opened.suggested_answer).toBeNull();
    expect(thought?.actions.map((a) => a.id)).not.toContain('go_with_that');

    const withAnswer = await rowFor('thought');
    expect(withAnswer?.opened.suggested_answer).toBe('Ask what the page is for.');
    expect(withAnswer?.actions.map((a) => a.id)).toContain('go_with_that');

    const { resp } = await screen();
    const line = resp.sections.handled.find((h) => h.id === r.action_id);
    expect(line).toMatchObject({ text: r.line, undo_action_id: null });
    await expect(runHomeUndo(prisma, adminId, r.action_id as string, NOW)).rejects.toMatchObject({ code: 'not_undoable', statusCode: 409 });

    const run = await prisma.homeKeeperRun.findFirst({ where: { user_id: adminId, kind: 'owed_reply' } });
    expect(run?.finished_at?.getTime()).toBe(NOW.getTime());
    expect(await queueKeys()).toEqual([key('redraft')]);
  });

  it('draft_now puts a thread first in the queue and Undo clears an unserved tap', async () => {
    const res = await act({ action: 'draft_now', item_key: key('thought') });
    expect(res.message).toBe('Bast will draft this in the next few minutes.');
    expect((await queueKeys())[0]).toBe(key('thought'));
    const first = (await listOwedWork(prisma, adminId, NOW, 6)).items[0];
    expect(first).toMatchObject({ request: 'draft', suggested_answer: 'Ask what the page is for.' });
    expect((await rowFor('thought'))?.owed_line).toBe('Bast is drafting');
    await runHomeUndo(prisma, adminId, res.action_id, NOW);
    expect(await queueKeys()).toEqual([key('redraft')]);
  });

  it('go_with_that needs a suggested answer, and Undo after the draft exists answers 409', async () => {
    await expect(act({ action: 'go_with_that', item_key: key('lead') })).rejects.toMatchObject({ code: 'no_suggestion' });
    const res = await act({ action: 'go_with_that', item_key: key('thought') });
    expect((await queueKeys())[0]).toBe(key('thought'));
    // The next run served it: a draft is saved for the thread.
    await saveOwedResults(prisma, adminId, [{ thread_key: key('thought'), newest_ask_id: askIds.thought, outcome: 'drafted', draft_id: 'd-t', draft_message_id: 'm-t', draft_text: DRAFT, model: 'sonnet' }], NOW);
    await expect(runHomeUndo(prisma, adminId, res.action_id, NOW)).rejects.toMatchObject({ code: 'not_undoable', message: 'The draft is already in your Gmail. It stays there.' });
    expect((await rowFor('thought'))?.owed_state).toBe('draft_ready');
  });

  it('his own draft is never touched and shows his state', async () => {
    const his = await rowFor('his');
    expect(his?.owed_state).toBe('his_draft');
    expect(his?.actions.map((a) => a.id)).toEqual(['open_draft', 'no_reply_needed', 'not_now']);
    expect(await prisma.homeOwedThread.count({ where: { user_id: adminId, thread_key: key('his') } })).toBe(0);
  });

  it('the owner gate: an admin whose screen is off, and a tech, get skipped and write nothing', async () => {
    for (const id of [overlookAdminId, techId]) {
      expect(await listOwedWork(prisma, id, NOW, 6)).toEqual({ skipped: 'home_off', items: [] });
      const r = await saveOwedResults(prisma, id, [{ thread_key: key('client'), newest_ask_id: askIds.client, outcome: 'drafted', draft_id: 'd-z', draft_message_id: 'm-z', draft_text: DRAFT, model: 'sonnet' }], NOW);
      expect(r).toMatchObject({ skipped: 'home_off', saved: [], action_id: null });
    }
    expect(await prisma.homeOwedThread.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    expect(await prisma.homeKeeperRun.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    expect(await prisma.homeAction.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    // Another user's screen never carries the owner's drafts.
    const other = JSON.stringify((await screen(techId)).resp);
    expect(other).not.toContain('Thanks for writing');
    expect(other).not.toContain('They are asking for new work');
    expect(other).not.toContain('"owed_state":"draft_ready"');
    expect(other).not.toContain('"owed_state":"needs_thought"');
  });

  it('no EmailAsk, Task or EmailOutbox row changed (ids and updated_at), and nothing was queued to send', async () => {
    expect(await counts()).toBe(snapshot);
    const after = JSON.parse(await counts());
    expect(after.outbox).toEqual(JSON.parse(snapshot).outbox);
  });
});
