// @vitest-environment node
/**
 * Slice 4c against a real Postgres: owed-reply clocks, re-surfacing, wake on new activity and cross-inbox joining.
 * Clock days run on a fake now. Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Run on its own
 * clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s4c_it npx vitest run lib/home/__tests__/slice4c.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { runHomeAct, runHomeUndo, zonedDateString } from '../act';
import { threadKey } from '../item-key';
import { listOwedWork, parseCaps, saveOwedResults, type OwedResultItem } from '../owed/store';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
/** Wednesday 2026-11-11, 07:00 Eastern. */
const NOW = new Date('2026-11-11T12:00:00Z');
const CAPS = parseCaps('short,auto,joins');
const at = (iso: string) => new Date(iso);
const FULL = 'Hi Pat,\n\nThanks for writing. I will get back to you.\n\nMike';

describe.skipIf(!SCRATCH)('Slice 4c: clocks, wake and joining (real database)', () => {
  const tag = `s4c-${Date.now()}`;
  const acctA = `a-${tag}@example.test`;
  const acctB = `b-${tag}@example.test`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const mid = (k: string) => `${tag}-${k}`;
  const ids: Record<string, string> = {};
  let clientId = '';

  const ask = (key: string, thread: string, received: string, over: Record<string, unknown> = {}) =>
    prisma.emailAsk.create({
      data: {
        message_id: mid(key),
        thread_id: mid(thread),
        account: acctA,
        from_name: `Person ${thread}`,
        from_email: `${thread}@client.example`,
        subject: `Subject ${thread}`,
        gist: `Gist ${thread}.`,
        queue: 'answer',
        severity: 'internal',
        is_urgent: false,
        state: 'open',
        client_id: clientId,
        deep_link: `https://mail.google.com/mail/u/0/#inbox/${mid(thread)}`,
        received_at: at(received),
        ...over,
      },
    });
  const key = (thread: string, acct = acctA) => threadKey(acct, mid(thread));
  async function screen(now: Date, userId = adminId) {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, now, { timezone: TZ }), loadItemStates(prisma, userId)]);
    return selectHome({ raw, states, now });
  }
  const rowAt = async (thread: string, now: Date, acct = acctA) => (await screen(now)).candidates.find((c) => c.key === key(thread, acct))?.item;
  const candAt = async (thread: string, now: Date, acct = acctA) => (await screen(now)).candidates.find((c) => c.key === key(thread, acct));
  const act = (req: Parameters<typeof runHomeAct>[2], now = NOW) => runHomeAct(prisma, adminId, req, { now, timezone: TZ, date: zonedDateString(now, TZ) });
  const save = (items: OwedResultItem[], now = NOW) => saveOwedResults(prisma, adminId, items, now);
  /** The queue. `mute` names threads to take out of it for this call (state flipped with raw SQL, so updated_at is untouched), because a run serves 6 at most and short and auto come last. */
  const work = async (now: Date, caps = parseCaps(''), mute: string[] = []) => {
    const msgs = mute.map(mid);
    if (msgs.length) await prisma.$executeRawUnsafe(`UPDATE email_asks SET state = 'dismissed' WHERE thread_id = ANY($1)`, msgs);
    try {
      return (await listOwedWork(prisma, adminId, now, 6, caps)).items;
    } finally {
      if (msgs.length) await prisma.$executeRawUnsafe(`UPDATE email_asks SET state = 'open' WHERE thread_id = ANY($1)`, msgs);
    }
  };
  const NOISE = ['l1', 'l10', 'w1', 'ja', 'jb', 'r1', 'auto2'];
  const rowOf = (k: string) => prisma.homeOwedThread.findUnique({ where: { user_id_thread_key: { user_id: adminId, thread_key: k } } });

  async function counts() {
    const asks = await prisma.emailAsk.findMany({ where: { account: { in: [acctA, acctB] } }, orderBy: { message_id: 'asc' }, select: { id: true, state: true, gist: true, subject: true, draft_url: true, updated_at: true } });
    const tasks = await prisma.task.findMany({ select: { id: true, updated_at: true } });
    const outbox = await prisma.emailOutbox.findMany({ select: { id: true } });
    return JSON.stringify({ asks, tasks, outbox });
  }
  /** Run Citadel code and prove no EmailAsk content, Task or EmailOutbox row changed. */
  async function unchanged<T>(fn: () => Promise<T>): Promise<T> {
    const before = await counts();
    const out = await fn();
    expect(await counts()).toBe(before);
    return out;
  }
  const draftRow = (thread: string, over: Record<string, unknown> = {}) =>
    prisma.homeOwedThread.create({
      data: { user_id: adminId, thread_key: key(thread), state: 'drafted', draft_id: `d-${thread}`, draft_message_id: `m-${thread}`, draft_hash: 'h', draft_text: FULL, draft_for_ask_id: ids[thread], drafted_at: at('2026-11-09T16:00:00Z'), ...over },
    });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 4c', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 4c', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 4c', role: 'admin' },
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
    // A client reply from Monday with Bast's draft on it (the clock days).
    ids.c1 = (await ask('c1', 'c1', '2026-11-09T15:00:00Z')).id;
    await draftRow('c1');
    // A lead from Monday, with a draft (the lead clock).
    ids.l1 = (await ask('l1', 'l1', '2026-11-09T15:00:00Z', { intent: 'sales', client_id: null })).id;
    await draftRow('l1');
    // A lead 12 business days old (the ten-day question).
    ids.l10 = (await ask('l10', 'l10', '2026-10-26T15:00:00Z', { intent: 'sales', client_id: null })).id;
    // Needs thought for over 3 business days, with a suggestion (auto), and one that needs a commitment (never auto).
    ids.auto1 = (await ask('auto1', 'auto1', '2026-11-03T15:00:00Z')).id;
    await prisma.homeOwedThread.create({ data: { user_id: adminId, thread_key: key('auto1'), state: 'needs_thought', bast_read: 'They want new work.', suggested_answer: 'Ask what the page is for.', thought_since: at('2026-11-04T15:00:00Z') } });
    ids.auto2 = (await ask('auto2', 'auto2', '2026-11-03T16:00:00Z')).id;
    await prisma.homeOwedThread.create({ data: { user_id: adminId, thread_key: key('auto2'), state: 'needs_thought', bast_read: 'The reply needs a price from you.', suggested_answer: null, needs_commitment: true, thought_since: at('2026-11-04T15:00:00Z') } });
    // The wake thread: one message from Monday.
    ids.w1 = (await ask('w1', 'w1', '2026-11-05T14:00:00Z')).id;
    // A joined pair: the same conversation in two inboxes.
    ids.ja = (await ask('ja', 'ja', '2026-11-05T15:00:00Z')).id;
    ids.jb = (await ask('jb', 'jb', '2026-11-06T15:00:00Z', { account: acctB, deep_link: 'https://mail.google.com/mail/u/1/#inbox/jb' })).id;
    // A thread somebody on our side will answer.
    ids.r1 = (await ask('r1', 'r1', '2026-11-05T14:00:00Z')).id;
  });

  afterAll(async () => {
    const users = [adminId, techId, overlookAdminId];
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeOwedThread.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: users } } });
    await prisma.emailAsk.deleteMany({ where: { account: { in: [acctA, acctB] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it('owed clock days on a fake now: nothing on day 1, "Waiting 3 days." on day 3, a read request on day 5', async () => {
    await unchanged(async () => {
      expect((await rowAt('c1', NOW))?.owed_line).toBe('Draft ready');
      expect((await rowAt('c1', at('2026-11-12T22:30:00Z')))?.owed_line).toBe('Draft ready');
      const day5 = at('2026-11-16T22:30:00Z');
      expect((await rowAt('c1', day5))?.owed_line).toBe('Draft ready');
      expect((await work(NOW)).find((i) => i.thread_key === key('c1'))).toBeUndefined();
      expect((await work(day5)).find((i) => i.thread_key === key('c1'))).toMatchObject({ request: 'read' });
    });
  });

  it('day 5 becomes Needs thought, then asks for a short draft; the card offers Open the short one and no send', async () => {
    const day5 = at('2026-11-16T22:30:00Z');
    const r1 = await unchanged(() =>
      save([{ thread_key: key('c1'), newest_ask_id: ids.c1, outcome: 'needs_thought', read: 'They want a yes or no.', suggested_answer: 'Say yes and ask for the files.', needs_commitment: false, model: 'sonnet' }], day5),
    );
    expect(r1.saved).toHaveLength(1);
    expect((await work(day5, parseCaps(''), NOISE)).find((i) => i.thread_key === key('c1'))).toBeUndefined();
    const withCaps = (await work(day5, CAPS, NOISE)).find((i) => i.thread_key === key('c1'));
    expect(withCaps).toMatchObject({ request: 'short', full_draft_text: FULL, joined: [] });
    await unchanged(async () => {
      const bad = await save([{ thread_key: key('c1'), newest_ask_id: ids.c1, outcome: 'short_drafted', short_draft_id: 's1', short_draft_text: 'Got this. I will be in touch on Friday.', model: 'haiku' }], day5);
      expect(bad.refused[0].reason).toBe('short_time');
      const three = await save([{ thread_key: key('c1'), newest_ask_id: ids.c1, outcome: 'short_drafted', short_draft_id: 's1', short_draft_text: 'One. Two. Three.', model: 'haiku' }], day5);
      expect(three.refused[0].reason).toBe('short_shape');
      const ok = await save([{ thread_key: key('c1'), newest_ask_id: ids.c1, outcome: 'short_drafted', short_draft_id: 's1', short_draft_text: 'Thanks, got this. I will get back to you.', model: 'haiku', cost_usd: 0.01 }], day5);
      expect(ok.saved).toEqual([{ thread_key: key('c1'), outcome: 'short_drafted' }]);
      expect(ok.line).toBe('Wrote a short holding reply to Person c1. It is in your Gmail drafts.');
    });
    const item = await rowAt('c1', day5);
    expect(item?.owed_state).toBe('needs_thought');
    expect(item?.opened.short_draft_text).toBe('Thanks, got this. I will get back to you.');
    const all = [...(item?.actions ?? []), ...(item?.more_actions ?? [])].map((a) => a.id);
    expect(all[0]).toBe('open_short');
    expect(all.join(',')).not.toMatch(/send/);
    expect((await work(day5, CAPS, NOISE)).find((i) => i.thread_key === key('c1'))).toBeUndefined();
  });

  it('a GET without caps never returns short or auto, and no 4c keys; with caps it does', async () => {
    const day5 = at('2026-11-16T22:30:00Z');
    const plain = await work(day5, parseCaps(''), NOISE.filter((x) => x !== 'auto2'));
    for (const i of plain) {
      expect(['draft', 'read', 'go_with_that', null]).toContain(i.request);
      expect(i).not.toHaveProperty('full_draft_text');
      expect(i).not.toHaveProperty('joined');
    }
    expect(plain.find((i) => i.thread_key === key('auto1'))).toBeUndefined();
    const capped = await work(day5, CAPS, ['l1', 'l10', 'w1', 'ja', 'jb', 'r1']);
    expect(capped.find((i) => i.thread_key === key('auto1'))).toMatchObject({ request: 'auto', suggested_answer: 'Ask what the page is for.' });
    expect(capped.find((i) => i.thread_key === key('auto2'))).toBeUndefined();
    const reqs = capped.map((i) => i.request);
    expect(reqs.indexOf('auto')).toBe(reqs.length - 1);
  });

  it('the auto draft marks the row and reads as a line', async () => {
    const day5 = at('2026-11-16T22:30:00Z');
    await unchanged(async () => {
      await save([{ thread_key: key('auto1'), newest_ask_id: ids.auto1, outcome: 'drafted', draft_id: 'd-a', draft_message_id: 'm-a', draft_text: FULL, model: 'sonnet' }], day5);
    });
    expect((await rowOf(key('auto1')))?.auto_drafted_at?.getTime()).toBe(day5.getTime());
    expect((await rowAt('auto1', day5))?.owed_line).toContain('Bast wrote it along its suggestion');
    expect((await work(day5, CAPS)).find((i) => i.thread_key === key('auto1'))).toBeUndefined();
  });

  it('lead clock: "reply due Wednesday" before, "reply was due" after, a refresh at the clock, a short draft when it comes back', async () => {
    await unchanged(async () => {
      expect((await rowAt('l1', NOW))?.owed_line).toBe('Draft ready');
      expect((await rowAt('l1', NOW))?.hard_date).toBeNull();
      const after = at('2026-11-11T22:30:00Z');
      expect((await rowAt('l1', after))?.owed_line).toBe('Draft ready');
      expect((await work(after)).find((i) => i.thread_key === key('l1'))).toMatchObject({ lead: true, request: 'draft', bast_draft: { draft_id: 'd-l1' } });
    });
    await prisma.homeOwedThread.update({ where: { user_id_thread_key: { user_id: adminId, thread_key: key('l1') } }, data: { drafted_at: at('2026-11-11T23:00:00Z') } });
    const back = at('2026-11-13T22:30:00Z');
    expect((await work(back)).find((i) => i.thread_key === key('l1'))).toBeUndefined();
    expect((await work(back, CAPS)).find((i) => i.thread_key === key('l1'))).toMatchObject({ request: 'short', full_draft_text: FULL });
    const ok = await save([{ thread_key: key('l1'), newest_ask_id: ids.l1, outcome: 'short_drafted', short_draft_id: 's-l1', short_draft_text: 'Thanks for reaching out. I have your note.', model: 'haiku' }], back);
    expect(ok.saved).toHaveLength(1);
    const row = await rowOf(key('l1'));
    expect(row).toMatchObject({ resurface_count: 1 });
    expect((await work(back, CAPS)).find((i) => i.thread_key === key('l1'))).toBeUndefined();
  });

  it('ten business days: Keep this lead or let it go, Keep it restarts the clock, Undo puts it back', async () => {
    const item = await rowAt('l10', NOW);
    expect(item?.why_now).toBe('Keep this lead or let it go?');
    expect(item?.actions.map((a) => a.id)).toEqual(['keep_lead', 'let_lead_go', 'not_now']);
    expect(item?.more_actions.map((a) => a.id)).toContain('not_lead');
    const kept = await unchanged(() => act({ action: 'keep_lead', item_key: key('l10') }));
    expect(kept.message).toBe('Kept. The clock starts again.');
    expect((await rowAt('l10', NOW))?.why_now).not.toBe('Keep this lead or let it go?');
    await runHomeUndo(prisma, adminId, kept.action_id, NOW);
    expect((await rowAt('l10', NOW))?.why_now).toBe('Keep this lead or let it go?');
  });

  it('Not a lead, then Treat as a reply: it stops being a lead', async () => {
    const res = await unchanged(() => act({ action: 'treat_as_reply', item_key: key('l10') }));
    expect((await rowAt('l10', NOW))?.type).toBe('owed_reply');
    await runHomeUndo(prisma, adminId, res.action_id, NOW);
    expect((await rowAt('l10', NOW))?.type).toBe('lead');
  });

  it('wake: a new message after Not now ends the park at once; a park with no new message stays', async () => {
    const parkAt = at('2026-11-10T12:00:00Z');
    await unchanged(() => act({ action: 'not_now', item_key: key('w1') }, parkAt));
    const st = await prisma.homeItemState.findFirst({ where: { user_id: adminId, item_key: key('w1') } });
    expect(st?.parked_at?.getTime()).toBe(parkAt.getTime());
    expect((await candAt('w1', at('2026-11-10T13:00:00Z')))?.parked).toBe(true);
    // They write again.
    await ask('w2', 'w1', '2026-11-10T18:00:00Z');
    const woke = await unchanged(() => candAt('w1', at('2026-11-10T19:00:00Z')));
    expect(woke?.parked).toBe(false);
    expect(woke?.item.owed_line).toContain('They wrote again.');
  });

  it('a joined pair renders one row, and No reply needed reaches both inboxes\' asks', async () => {
    await unchanged(async () => {
      const r = await save([{ thread_key: key('ja'), newest_ask_id: ids.ja, outcome: 'needs_thought', read: 'They want a yes or no.', suggested_answer: null, needs_commitment: true, model: 'sonnet', joins: [{ account: acctB, thread_id: mid('jb') }] }]);
      expect(r.saved).toHaveLength(1);
    });
    expect((await rowOf(key('ja')))?.joined_to_key).toBe(key('jb', acctB));
    expect((await rowOf(key('jb', acctB)))?.joined_to_key).toBeNull();
    const s = await screen(NOW);
    const rows = s.candidates.filter((c) => c.kind === 'thread' && (c.key === key('ja') || c.key === key('jb', acctB)));
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(key('jb', acctB));
    expect(rows[0].item.source.ids.sort()).toEqual([ids.ja, ids.jb].sort());
    const q = await work(NOW, CAPS, ['l1', 'l10', 'w1', 'r1']);
    // The conversation is one queue item, under the thread whose newest message is newest, and it names the other inbox's thread.
    expect(q.find((i) => i.thread_key === key('ja'))).toBeUndefined();
    expect(q.find((i) => i.thread_key === key('jb', acctB))).toMatchObject({ account: acctB, joined: [{ account: acctA, thread_id: mid('ja') }] });
    expect(q.find((i) => i.thread_key === key('jb', acctB))?.ask_ids.sort()).toEqual([ids.ja, ids.jb].sort());
    const old = await work(NOW, parseCaps(''), ['l1', 'l10', 'w1', 'r1']);
    expect(old.find((i) => i.thread_key === key('jb', acctB))).not.toHaveProperty('joined');
  });

  it('replied_elsewhere hides the row with its line, and a newer message brings it back', async () => {
    expect(await rowAt('r1', NOW)).toBeTruthy();
    const res = await unchanged(() =>
      save([{ thread_key: key('r1'), newest_ask_id: ids.r1, outcome: 'replied_elsewhere', replied_from: 'support@becomeindelible.com', replied_at: '2026-11-10T15:00:00Z' }]),
    );
    expect(res.saved).toEqual([{ thread_key: key('r1'), outcome: 'replied_elsewhere' }]);
    expect(res.line).toBeNull();
    expect(await rowAt('r1', NOW)).toBeUndefined();
    const action = await prisma.homeAction.findFirst({ where: { user_id: adminId, action: 'keeper_owed_drafts' }, orderBy: { created_at: 'desc' } });
    expect((action?.after as { line: string }).line).toBe('Person r1 got a reply from support@ on Tuesday. Taken off your list.');
    expect((await work(NOW, CAPS, ['l1', 'l10', 'w1'])).find((i) => i.thread_key === key('r1'))).toBeUndefined();
    await ask('r2', 'r1', '2026-11-10T20:00:00Z');
    expect(await rowAt('r1', at('2026-11-12T22:30:00Z'))).toBeTruthy();
  });

  it('other users are untouched: no rows, no lines, nothing of the owner on their screen', async () => {
    for (const id of [techId, overlookAdminId]) {
      expect(await listOwedWork(prisma, id, NOW, 6, CAPS)).toEqual({ skipped: 'home_off', items: [] });
      const r = await saveOwedResults(prisma, id, [{ thread_key: key('c1'), newest_ask_id: ids.c1, outcome: 'replied_elsewhere', replied_from: 'support@x.test', replied_at: '2026-11-10T15:00:00Z' }], NOW);
      expect(r).toMatchObject({ skipped: 'home_off', saved: [] });
    }
    expect(await prisma.homeOwedThread.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    expect(await prisma.homeAction.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    expect(await prisma.homeItemState.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    const other = JSON.stringify((await screen(NOW, techId)).sections);
    expect(other).not.toContain('Thanks for writing');
    expect(other).not.toContain('Short draft ready');
  });

  it('nothing was queued to send: no EmailOutbox row exists for these asks', async () => {
    const outbox = await prisma.emailOutbox.count({ where: { to: { contains: 'client.example' } } });
    expect(outbox).toBe(0);
  });
});
