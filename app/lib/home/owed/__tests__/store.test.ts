import { describe, it, expect } from 'vitest';
import { clearOwedRequest, isContentRefusal, itemRefusal, loadOwedRows, requestOwed, saveOwedResults, sha256, OWED_ACTION, type OwedResultItem } from '../store';
import { makeFakeDb, type FakeAsk } from './fixtures/fake-db';
import { threadKey } from '../../item-key';
import { owedQueue } from '../queue';
import { NOW as QNOW, d, makeClient, makeThread } from '../../__tests__/fixtures/tonight';

const USER = '3ecfb7be-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-11T15:00:00Z');
const ACCOUNT = 'mike@becomeindelible.com';
const ASK1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const ASK2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const key = (t: string) => threadKey(ACCOUNT, t);

const ask = (id: string, thread: string, over: Partial<FakeAsk> = {}): FakeAsk => ({
  id, account: ACCOUNT, thread_id: thread, message_id: `m-${id}`, state: 'open', is_urgent: false,
  received_at: new Date('2026-11-05T15:00:00Z'), from_name: 'Jessica Everlith', from_email: 'j@example.com', ...over,
});

const drafted = (thread: string, over: Record<string, unknown> = {}): OwedResultItem => ({
  thread_key: key(thread), newest_ask_id: ASK1, outcome: 'drafted', draft_id: 'r1', draft_message_id: 'g1', draft_text: 'Thanks, got this. I\'ll get back to you.\n\nMike', model: 'sonnet', cost_usd: 0.05, ...over,
}) as OwedResultItem;

describe('saveOwedResults', () => {
  it('saves a clean draft, one run row, one keeper line, and touches nothing else', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    const r = await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    expect(r.saved).toEqual([{ thread_key: key('t1'), outcome: 'drafted' }]);
    expect(r.refused).toEqual([]);
    expect(r.line).toBe('Drafted a reply to Jessica Everlith. It is in your Gmail drafts.');
    const row = f.rows.get(`${USER}|${key('t1')}`)!;
    expect(row).toMatchObject({ state: 'drafted', draft_id: 'r1', draft_message_id: 'g1', draft_for_ask_id: ASK1, mike_edited_at: null, attempts: 0 });
    expect(row.draft_hash).toBe(sha256(drafted('t1') && (drafted('t1') as { draft_text: string }).draft_text));
    expect(f.runs.size).toBe(1);
    const run = [...f.runs.values()][0];
    expect(run.finished_at).toEqual(NOW);
    expect(run.kind).toBe('owed_reply');
    expect(f.actions).toHaveLength(1);
    expect(f.actions[0]).toMatchObject({ action: OWED_ACTION, source: 'keeper', item_key: null, undo_until: NOW });
    // Only these writes, and (the fake throws on any other model or an ask write) nothing else.
    expect([...new Set(f.writes)].sort()).toEqual(['homeAction.create', 'homeKeeperRun.upsert', 'homeOwedThread.upsert']);
  });

  it('refuses a dashed body and a $500 body and saves the clean one', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1'), ask(ASK1.replace(/1$/, '3'), 't2'), ask(ASK1.replace(/1$/, '4'), 't3')] });
    const r = await saveOwedResults(
      f.db,
      USER,
      [
        drafted('t1', { draft_text: 'Thanks — got it.' }),
        drafted('t2', { newest_ask_id: ASK1.replace(/1$/, '3'), draft_text: 'That would be $500.' }),
        drafted('t3', { newest_ask_id: ASK1.replace(/1$/, '4') }),
      ],
      NOW,
    );
    expect(r.refused).toEqual([
      { thread_key: key('t1'), reason: 'draft_shape' },
      { thread_key: key('t2'), reason: 'draft_money' },
    ]);
    expect(r.saved).toEqual([{ thread_key: key('t3'), outcome: 'drafted' }]);
    // The two refused texts each record one failed attempt (and nothing else); only t3 holds a draft.
    expect(f.rows.size).toBe(3);
    expect(f.rows.get(`${USER}|${key('t1')}`)).toMatchObject({ state: 'failed', attempts: 1, last_error: 'refused: draft_shape', draft_id: null });
    expect(f.rows.get(`${USER}|${key('t2')}`)).toMatchObject({ state: 'failed', attempts: 1, last_error: 'refused: draft_money' });
    expect(f.rows.get(`${USER}|${key('t3')}`)).toMatchObject({ state: 'drafted', draft_id: 'r1' });
  });

  it('a stale newest ask is refused 409 and nothing is written for it', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1'), ask(ASK2, 't1', { received_at: new Date('2026-11-06T15:00:00Z') })] });
    const r = await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    expect(r.refused).toEqual([{ thread_key: key('t1'), reason: 'stale', status: 409 }]);
    expect(r.saved).toEqual([]);
    expect(f.rows.size).toBe(0);
    expect(f.actions).toHaveLength(0);
    expect(f.writes).toEqual(['homeKeeperRun.upsert']);
  });

  it('a thread with no open ask is stale too', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1', { state: 'handled' })] });
    const r = await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    expect(r.refused[0]).toMatchObject({ reason: 'stale', status: 409 });
  });

  it('a lone ask with no thread id is found by its message id', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 'x', { thread_id: null, message_id: 'solo' })] });
    const r = await saveOwedResults(f.db, USER, [drafted('solo')], NOW);
    expect(r.saved).toHaveLength(1);
  });

  it('needs_thought saves the read and suggested answer; a bad read or suggestion is refused', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1'), ask(ASK2, 't2'), ask(ASK1.replace(/1$/, '6'), 't4')] });
    const ok: OwedResultItem = { thread_key: key('t1'), newest_ask_id: ASK1, outcome: 'needs_thought', read: 'The reply needs a price from you.', suggested_answer: null, needs_commitment: true, model: 'sonnet' };
    const badRead: OwedResultItem = { thread_key: key('t2'), newest_ask_id: ASK2, outcome: 'needs_thought', read: 'He wants a answer — now.', suggested_answer: null, needs_commitment: false, model: 'sonnet' };
    const r = await saveOwedResults(f.db, USER, [ok, badRead, { ...ok, thread_key: key('t4'), newest_ask_id: ASK1.replace(/1$/, '6'), suggested_answer: 'Say it will be done Friday.' }], NOW);
    expect(r.saved).toEqual([{ thread_key: key('t1'), outcome: 'needs_thought' }]);
    expect(r.refused.map((x) => x.reason)).toEqual(['read_shape', 'suggested_time']);
    expect(f.rows.get(`${USER}|${key('t1')}`)).toMatchObject({ state: 'needs_thought', bast_read: 'The reply needs a price from you.', needs_commitment: true, suggested_answer: null });
    expect(f.actions).toHaveLength(0);
  });

  it('a draft after needs_thought clears the read and the pending tap', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    await saveOwedResults(f.db, USER, [{ thread_key: key('t1'), newest_ask_id: ASK1, outcome: 'needs_thought', read: 'He is asking you to pick.', suggested_answer: 'Ask which one he wants.', needs_commitment: false, model: 'sonnet' }], NOW);
    await requestOwed(f.db, USER, key('t1'), 'go_with_that', NOW);
    await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    expect(f.rows.get(`${USER}|${key('t1')}`)).toMatchObject({ state: 'drafted', bast_read: null, suggested_answer: null, request_kind: null, requested_at: null });
  });

  it('mike_edited marks the row and needs a Bast draft', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    const edit: OwedResultItem = { thread_key: key('t1'), newest_ask_id: ASK1, outcome: 'mike_edited' };
    expect((await saveOwedResults(f.db, USER, [edit], NOW)).refused).toEqual([{ thread_key: key('t1'), reason: 'no_draft' }]);
    await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    const r = await saveOwedResults(f.db, USER, [edit], new Date(NOW.getTime() + 60_000));
    expect(r.saved).toEqual([{ thread_key: key('t1'), outcome: 'mike_edited' }]);
    expect(f.rows.get(`${USER}|${key('t1')}`)!.mike_edited_at).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it('failed counts attempts, keeps a draft row\'s state, and clears the tap', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    const fail: OwedResultItem = { thread_key: key('t1'), newest_ask_id: ASK1, outcome: 'failed', error: 'x'.repeat(500) };
    await saveOwedResults(f.db, USER, [fail], NOW);
    await saveOwedResults(f.db, USER, [fail], NOW);
    const row = f.rows.get(`${USER}|${key('t1')}`)!;
    expect(row).toMatchObject({ state: 'failed', attempts: 2 });
    expect((row.last_error as string).length).toBe(300);
    await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    await saveOwedResults(f.db, USER, [fail], NOW);
    expect(f.rows.get(`${USER}|${key('t1')}`)).toMatchObject({ state: 'drafted', attempts: 1, draft_id: 'r1' });
  });

  it('a repeat of the same thread in one POST and a bad key are refused', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    const r = await saveOwedResults(f.db, USER, [drafted('t1'), drafted('t1'), { ...drafted('t1'), thread_key: 'task:nope' }], NOW);
    expect(r.saved).toHaveLength(1);
    expect(r.refused.map((x) => x.reason)).toEqual(['duplicate', 'bad_key']);
  });

  it('the keeper line counts the people and the counts add up through the day', async () => {
    const asks = [ask(ASK1, 't1'), ask(ASK2, 't2', { from_name: null, from_email: 'bo@example.com' }), ask(ASK1.replace(/1$/, '5'), 't3')];
    const f = makeFakeDb({ asks });
    const r = await saveOwedResults(f.db, USER, [drafted('t1'), drafted('t2', { newest_ask_id: ASK2 }), drafted('t3', { newest_ask_id: ASK1.replace(/1$/, '5') })], NOW);
    expect(r.line).toBe('Drafted replies to Jessica Everlith and 2 others. They are in your Gmail drafts.');
    await saveOwedResults(f.db, USER, [], new Date(NOW.getTime() + 600_000));
    const run = [...f.runs.values()][0];
    expect(run.counts).toMatchObject({ drafted: 3 });
    expect(run.finished_at).toEqual(new Date(NOW.getTime() + 600_000));
    expect(f.actions).toHaveLength(1);
  });

  it('an owner who is not on the home view writes nothing', async () => {
    for (const owner of [{ is_active: true, role: 'admin', home_view: 'classic' }, { is_active: true, role: 'tech', home_view: 'home' }, { is_active: false, role: 'admin', home_view: 'home' }]) {
      const f = makeFakeDb({ owner, asks: [ask(ASK1, 't1')] });
      const r = await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
      expect(r).toEqual({ skipped: 'home_off', saved: [], refused: [], action_id: null, line: null });
      expect(f.writes).toEqual([]);
    }
  });
});

describe('itemRefusal', () => {
  it('names the field and the category', () => {
    expect(itemRefusal(drafted('t', { draft_text: 'Within 3 days.' }))).toBe('draft_time');
    expect(itemRefusal(drafted('t'))).toBeNull();
    expect(itemRefusal({ thread_key: 'k', newest_ask_id: ASK1, outcome: 'mike_edited' })).toBeNull();
  });
});

describe('requestOwed and clearOwedRequest', () => {
  it('records a tap on a new thread and undo puts it back', async () => {
    const f = makeFakeDb();
    const r = await requestOwed(f.db, USER, key('t1'), 'draft', NOW);
    expect(r).toEqual({ ok: true, before: { request_kind: null, requested_at: null } });
    expect(f.rows.get(`${USER}|${key('t1')}`)).toMatchObject({ request_kind: 'draft', requested_at: NOW });
    expect(await clearOwedRequest(f.db, USER, key('t1'), 'draft', { request_kind: null, requested_at: null })).toBe(true);
    expect(f.rows.get(`${USER}|${key('t1')}`)).toMatchObject({ request_kind: null, requested_at: null });
    expect(await clearOwedRequest(f.db, USER, key('t1'), 'draft', { request_kind: null, requested_at: null })).toBe(false);
  });
  it('go_with_that needs a suggested answer', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1'), ask(ASK2, 't2')] });
    expect(await requestOwed(f.db, USER, key('t1'), 'go_with_that', NOW)).toEqual({ ok: false, reason: 'no_suggestion' });
    await saveOwedResults(f.db, USER, [{ thread_key: key('t1'), newest_ask_id: ASK1, outcome: 'needs_thought', read: 'He is stalling.', suggested_answer: null, needs_commitment: true, model: 'sonnet' }], NOW);
    expect(await requestOwed(f.db, USER, key('t1'), 'go_with_that', NOW)).toEqual({ ok: false, reason: 'no_suggestion' });
    await saveOwedResults(f.db, USER, [{ thread_key: key('t2'), newest_ask_id: ASK2, outcome: 'needs_thought', read: 'He is stalling.', suggested_answer: 'Ask which he prefers.', needs_commitment: false, model: 'sonnet' }], NOW);
    expect((await requestOwed(f.db, USER, key('t2'), 'go_with_that', NOW)).ok).toBe(true);
  });
  it('draft on an up to date Bast draft is refused; needs_thought on it is fine', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    expect(await requestOwed(f.db, USER, key('t1'), 'draft', NOW)).toEqual({ ok: false, reason: 'already_drafted' });
    expect((await requestOwed(f.db, USER, key('t1'), 'read', NOW)).ok).toBe(true);
  });
  it('undo keeps the earlier tap when a second tap replaced it', async () => {
    const f = makeFakeDb();
    await requestOwed(f.db, USER, key('t1'), 'read', NOW);
    const second = await requestOwed(f.db, USER, key('t1'), 'draft', new Date(NOW.getTime() + 1000));
    expect(second).toMatchObject({ ok: true, before: { request_kind: 'read' } });
    expect(await clearOwedRequest(f.db, USER, key('t1'), 'draft', (second as { before: { request_kind: string | null; requested_at: string | null } }).before)).toBe(true);
    expect(f.rows.get(`${USER}|${key('t1')}`)!.request_kind).toBe('read');
    expect(f.writes.every((w) => w.startsWith('homeOwedThread'))).toBe(true);
  });
});

describe('loadOwedRows', () => {
  it('reads only the user\'s rows and writes nothing', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    const before = f.writes.length;
    expect(await loadOwedRows(f.db, USER)).toHaveLength(1);
    expect(await loadOwedRows(f.db, 'someone-else')).toHaveLength(0);
    expect(f.writes.length).toBe(before);
  });
});

const SHORT_BAD = 'Got it. Looking now. Replying later.\n\nMike';
const shortItem = (thread: string, text: string, over: Record<string, unknown> = {}): OwedResultItem =>
  ({ thread_key: key(thread), newest_ask_id: ASK1, outcome: 'short_drafted', short_draft_id: 's1', short_draft_text: text, model: 'haiku', ...over }) as OwedResultItem;

/** A thread at day 5 with Bast's full draft unsent and the row Needs thought: the queue asks for a short draft. */
async function needsShortSetup() {
  const received = d('2026-11-02T15:00:00Z');
  const f = makeFakeDb({ asks: [ask(ASK1, 't1', { received_at: received })] });
  await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
  const row = f.rows.get(`${USER}|${key('t1')}`)!;
  Object.assign(row, { state: 'needs_thought', thought_since: d('2026-11-09T10:00:00Z'), updated_at: d('2026-11-09T10:00:00Z') });
  const thread = makeThread({ id: ASK1, account: ACCOUNT, thread_id: 't1', client: makeClient('Active Co'), received_at: received });
  const queue = async (now: Date = QNOW) => owedQueue({}, [thread], await loadOwedRows(f.db, USER), now, 6, { short: true, auto: true });
  return { f, row, queue };
}

describe('saveOwedResults: dry', () => {
  it('answers what would happen for every outcome and writes nothing at all', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1'), ask(ASK2, 't2'), ask(ASK1.replace(/1$/, '3'), 't3')] });
    await saveOwedResults(f.db, USER, [drafted('t1')], NOW);
    const before = { rows: structuredClone([...f.rows.entries()]), runs: structuredClone([...f.runs.entries()]), actions: f.actions.length, writes: f.writes.length };
    const items: OwedResultItem[] = [
      drafted('t2', { newest_ask_id: ASK2 }),
      drafted('t3', { newest_ask_id: ASK1.replace(/1$/, '3'), draft_text: 'That would be $500.' }),
      shortItem('t1', 'Thanks for sending this over. I am looking at it.\n\nMike'),
      { thread_key: key('t2'), newest_ask_id: ASK2, outcome: 'failed', error: 'x' },
      { thread_key: key('t1'), newest_ask_id: ASK1, outcome: 'mike_edited' },
      { thread_key: key('t2'), newest_ask_id: ASK2, outcome: 'replied_elsewhere', replied_from: 'support@x.test', replied_at: '2026-11-06T15:00:00Z' },
      { thread_key: key('t2'), newest_ask_id: ASK2, outcome: 'needs_thought', read: 'The reply needs a price from you.', suggested_answer: null, needs_commitment: true, model: 'sonnet', joins: [{ account: ACCOUNT, thread_id: 't1' }] },
      drafted('t2', { newest_ask_id: ASK1 }),
    ];
    const results = [];
    for (const item of items) results.push(await saveOwedResults(f.db, USER, [item], NOW, { dry: true }));
    expect(results.map((r) => r.saved.map((x) => x.outcome))).toEqual([['drafted'], [], ['short_drafted'], ['failed'], ['mike_edited'], ['replied_elsewhere'], ['needs_thought'], []]);
    expect(results.map((r) => r.refused)).toEqual([[], [{ thread_key: key('t3'), reason: 'draft_money' }], [], [], [], [], [], [{ thread_key: key('t2'), reason: 'stale', status: 409 }]]);
    const r = results[0];
    expect(r.action_id).toBeNull();
    expect(r.line).toBeNull();
    // No writes: not one write method called, rows, run rows and keeper lines exactly as before.
    expect(f.writes.length).toBe(before.writes);
    expect([...f.rows.entries()]).toEqual(before.rows);
    expect([...f.runs.entries()]).toEqual(before.runs);
    expect(f.actions.length).toBe(before.actions);
  });

  it('gives the same saved and refused as the real save would', async () => {
    const mk = () => makeFakeDb({ asks: [ask(ASK1, 't1'), ask(ASK2, 't2')] });
    const items: OwedResultItem[] = [drafted('t1'), drafted('t2', { newest_ask_id: ASK2, draft_text: 'Thanks \u2014 yes.' }), shortItem('t1', SHORT_BAD)];
    const dry = await saveOwedResults(mk().db, USER, items, NOW, { dry: true });
    const real = await saveOwedResults(mk().db, USER, items, NOW);
    expect({ saved: dry.saved, refused: dry.refused }).toEqual({ saved: real.saved, refused: real.refused });
  });

  it('a refused content result writes no failed attempt when dry', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    await saveOwedResults(f.db, USER, [drafted('t1', { draft_text: 'That would be $500.' })], NOW, { dry: true });
    expect(f.writes).toEqual([]);
    expect(f.rows.size).toBe(0);
  });

  it('a short result needs the full draft on the row, dry or not', async () => {
    const f = makeFakeDb({ asks: [ask(ASK1, 't1')] });
    const r = await saveOwedResults(f.db, USER, [shortItem('t1', 'Thanks.\n\nMike')], NOW, { dry: true });
    expect(r.refused).toEqual([{ thread_key: key('t1'), reason: 'no_draft' }]);
  });

  it('an owner who is not on the home view answers skipped and writes nothing', async () => {
    const f = makeFakeDb({ owner: { is_active: true, role: 'admin', home_view: 'classic' }, asks: [ask(ASK1, 't1')] });
    expect(await saveOwedResults(f.db, USER, [drafted('t1')], NOW, { dry: true })).toEqual({ skipped: 'home_off', saved: [], refused: [], action_id: null, line: null });
    expect(f.writes).toEqual([]);
  });
});

describe('saveOwedResults: a refused result is a failed attempt', () => {
  it('isContentRefusal names the content reasons only', () => {
    for (const r of ['draft_money', 'draft_shape', 'short_shape', 'short_time', 'read_shape', 'suggested_scope']) expect(isContentRefusal(r)).toBe(true);
    for (const r of ['stale', 'stale_draft', 'duplicate', 'no_draft', 'bad_key', 'bad_replied_at']) expect(isContentRefusal(r)).toBe(false);
  });

  it('three refused shorts and the thread is no longer in the queue', async () => {
    const { f, row, queue } = await needsShortSetup();
    expect((await queue())[0]).toMatchObject({ reason: 'short', request: 'short' });
    for (let i = 1; i <= 3; i++) {
      const r = await saveOwedResults(f.db, USER, [shortItem('t1', SHORT_BAD)], NOW);
      expect(r.refused).toEqual([{ thread_key: key('t1'), reason: 'short_shape' }]);
      expect(r.saved).toEqual([]);
      expect(row).toMatchObject({ attempts: i, last_error: 'refused: short_shape', state: 'needs_thought', draft_id: 'r1', short_draft_id: null });
      expect((await queue()).length).toBe(i < 3 ? 1 : 0);
    }
    // 24 hours later the rule lets it back in, once.
    row.updated_at = new Date(QNOW.getTime() - 25 * 3_600_000);
    expect((await queue()).length).toBe(1);
  });

  it('a pending short or auto tap is cleared, and a stale ask or a non-content refusal records nothing', async () => {
    const { f, row } = await needsShortSetup();
    Object.assign(row, { request_kind: 'short', requested_at: NOW });
    await saveOwedResults(f.db, USER, [shortItem('t1', SHORT_BAD)], NOW);
    expect(row).toMatchObject({ request_kind: null, requested_at: null, attempts: 1 });
    Object.assign(row, { request_kind: 'auto', requested_at: NOW, attempts: 0 });
    await saveOwedResults(f.db, USER, [{ thread_key: key('t1'), newest_ask_id: ASK1, outcome: 'needs_thought', read: 'He wants a answer \u2014 now.', suggested_answer: null, needs_commitment: false, model: 'sonnet' }], NOW);
    expect(row).toMatchObject({ request_kind: null, requested_at: null, attempts: 1, last_error: 'refused: read_shape' });
    const writes = f.writes.length;
    const stale = await saveOwedResults(f.db, USER, [shortItem('t1', SHORT_BAD, { newest_ask_id: ASK2 })], NOW);
    expect(stale.refused).toEqual([{ thread_key: key('t1'), reason: 'short_shape' }]);
    expect(row.attempts).toBe(1);
    // the run row is the only write (no failed attempt for an ask that is not the live newest one)
    expect(f.writes.slice(writes)).toEqual(['homeKeeperRun.upsert']);
    const noDraft = makeFakeDb({ asks: [ask(ASK1, 'x')] });
    await saveOwedResults(noDraft.db, USER, [shortItem('x', 'Thanks.\n\nMike')], NOW);
    expect(noDraft.rows.size).toBe(0);
  });

  it('a later real draft resets the count, so a new message that gets drafted starts clean', async () => {
    const { f, row } = await needsShortSetup();
    for (let i = 0; i < 3; i++) await saveOwedResults(f.db, USER, [shortItem('t1', SHORT_BAD)], NOW);
    expect(row.attempts).toBe(3);
    await saveOwedResults(f.db, USER, [drafted('t1', { draft_id: 'r2' })], NOW);
    expect(f.rows.get(`${USER}|${key('t1')}`)).toMatchObject({ state: 'drafted', attempts: 0, last_error: null, draft_id: 'r2' });
  });
});
