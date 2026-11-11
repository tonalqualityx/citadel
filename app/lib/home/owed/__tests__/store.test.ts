import { describe, it, expect } from 'vitest';
import { clearOwedRequest, itemRefusal, loadOwedRows, requestOwed, saveOwedResults, sha256, OWED_ACTION, type OwedResultItem } from '../store';
import { makeFakeDb, type FakeAsk } from './fixtures/fake-db';
import { threadKey } from '../../item-key';

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
    expect(f.rows.size).toBe(1);
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
