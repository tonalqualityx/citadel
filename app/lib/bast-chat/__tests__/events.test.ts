import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { appendMikeMessage, appendWorkerEvents, feed, patchWorkerConversation, requestStop, stripDashes, STOP_CODE } from '../events';
import { DEFAULT_SETTINGS } from '../settings';
import { makeChatDb, type FakeEvent } from './fake-db';

const base = (db: ReturnType<typeof makeChatDb>, over: Record<string, unknown> = {}) => ({
  conversationId: db.conv.id,
  ownerId: db.conv.owner_id,
  text: 'where is VCDP at?',
  context: { kind: 'none' as const },
  clientRef: 'ref-1',
  settings: DEFAULT_SETTINGS,
  ...over,
});

describe('appendMikeMessage', () => {
  it('allocates seq under the row lock, stores the message pending, queues the chat and counts one message', async () => {
    const db = makeChatDb();
    const r = await appendMikeMessage(base(db), db);
    expect(r).toEqual({ seq: 1, duplicate: false });
    expect(db.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(db.events[0]).toMatchObject({ seq: 1, role: 'mike', kind: 'text', delivered_at: null, client_ref: 'ref-1' });
    expect(db.conv.status).toBe('queued');
    expect(db.conv.title).toBe('where is VCDP at?');
    expect(db.usage.turns).toBe(1);
    const r2 = await appendMikeMessage(base(db, { clientRef: 'ref-2' }), db);
    expect(r2.seq).toBe(2);
  });
  it('a repeat client_ref stores nothing and counts nothing', async () => {
    const db = makeChatDb();
    await appendMikeMessage(base(db), db);
    const again = await appendMikeMessage(base(db), db);
    expect(again).toEqual({ seq: 1, duplicate: true });
    expect(db.events).toHaveLength(1);
    expect(db.usage.turns).toBe(1);
  });
  it('a repeat is answered even when the cap is now reached', async () => {
    const db = makeChatDb();
    await appendMikeMessage(base(db), db);
    db.usage.turns = 100;
    expect((await appendMikeMessage(base(db), db)).duplicate).toBe(true);
  });
  it('refuses with 429 at the daily message cap and stores nothing', async () => {
    const db = makeChatDb();
    db.usage.turns = 100;
    await expect(appendMikeMessage(base(db), db)).rejects.toMatchObject({ statusCode: 429 });
    expect(db.events).toHaveLength(0);
    expect(db.conv.last_seq).toBe(0);
  });
  it('refuses with 429 at the cost cap', async () => {
    const db = makeChatDb();
    db.usage.cost = 8;
    await expect(appendMikeMessage(base(db), db)).rejects.toMatchObject({ statusCode: 429, limit: 'daily_cost' });
  });
  it('refuses empty text, over 4000 characters, a bad client_ref, a closed chat and another owner', async () => {
    const db = makeChatDb();
    await expect(appendMikeMessage(base(db, { text: '   ' }), db)).rejects.toMatchObject({ statusCode: 400 });
    await expect(appendMikeMessage(base(db, { text: 'x'.repeat(4001) }), db)).rejects.toMatchObject({ statusCode: 400 });
    await expect(appendMikeMessage(base(db, { clientRef: '' }), db)).rejects.toMatchObject({ statusCode: 400 });
    await expect(appendMikeMessage(base(db, { ownerId: 'someone-else' }), db)).rejects.toMatchObject({ statusCode: 404 });
    const closed = makeChatDb({ conv: { status: 'closed' } });
    await expect(appendMikeMessage(base(closed), closed)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('appendWorkerEvents', () => {
  it('gives gapless seqs, acks once, and adds a cost event to the usage', async () => {
    const db = makeChatDb();
    await appendMikeMessage(base(db), db);
    db._n = 3;
    const r = await appendWorkerEvents(db.conv.id, null, { acks: [1, 1], events: [
      { role: 'system', kind: 'status', payload: { text: 'Got it.' } },
      { role: 'assistant', kind: 'text', payload: { text: 'Waiting on your sign-off.' } },
      { role: 'system', kind: 'cost', payload: { turn_usd: 0.12 } },
    ] }, new Date(), db);
    expect(r).toEqual({ last_seq: 4, first_seq: 2, acked: 1 });
    expect(db.events.filter((e: FakeEvent) => e.role === 'mike')[0].delivered_at).not.toBeNull();
    expect(db.usage.cost).toBeCloseTo(0.12);
    expect(db.conv.cost_usd).toBeCloseTo(0.12);
    const again = await appendWorkerEvents(db.conv.id, null, { acks: [1] }, new Date(), db);
    expect(again.acked).toBe(0);
  });
  it('refuses a role of mike, an unknown kind, an oversize payload and too many events', async () => {
    const db = makeChatDb();
    await expect(appendWorkerEvents(db.conv.id, null, { events: [{ role: 'mike' as never, kind: 'text', payload: {} }] }, new Date(), db)).rejects.toMatchObject({ statusCode: 400 });
    await expect(appendWorkerEvents(db.conv.id, null, { events: [{ role: 'assistant', kind: 'bogus' as never, payload: {} }] }, new Date(), db)).rejects.toMatchObject({ statusCode: 400 });
    await expect(appendWorkerEvents(db.conv.id, null, { events: [{ role: 'assistant', kind: 'text', payload: { text: 'x'.repeat(9000) } }] }, new Date(), db)).rejects.toMatchObject({ statusCode: 413 });
    await expect(appendWorkerEvents(db.conv.id, null, { events: Array.from({ length: 101 }, () => ({ role: 'assistant' as const, kind: 'text' as const, payload: {} })) }, new Date(), db)).rejects.toMatchObject({ statusCode: 413 });
  });
});

describe('dashes in assistant text', () => {
  const EM = String.fromCharCode(0x2014);
  const EN = String.fromCharCode(0x2013);
  it('stripDashes swaps an em or en dash for a comma and collapses doubled spaces', () => {
    expect(stripDashes(`Can't do either ${EM} due dates are set by the system`)).toBe("Can't do either, due dates are set by the system");
    expect(stripDashes(`Done${EM}marked it. Mon${EN}Fri  ok`)).toBe('Done, marked it. Mon, Fri ok');
  });
  it('stripDashes also swaps the ranking words, drops bold marks and leading heading marks', () => {
    expect(stripDashes('Priority one. The priorities are set. PRIORITY, Overdue and overdue.')).toBe('order one. The order are set. order, late and late.');
    expect(stripDashes('**Delete:** none\n## Next steps\n#Tag')).toBe('Delete: none\nNext steps\nTag');
    expect(stripDashes('reprioritize and overdueness stay')).toBe('reprioritize and overdueness stay');
  });
  it('assistant text is stored without a dash; other roles and kinds are untouched', async () => {
    const db = makeChatDb();
    await appendWorkerEvents(db.conv.id, null, { events: [
      { role: 'assistant', kind: 'text', payload: { text: `Done ${EM} it is closed ${EN} for now` } },
      { role: 'system', kind: 'status', payload: { code: 'x', text: `keep ${EM} this` } },
    ] }, new Date(), db);
    expect((db.events[0].payload as { text: string }).text).toBe('Done, it is closed, for now');
    expect((db.events[1].payload as { text: string }).text).toBe(`keep ${EM} this`);
  });
  it('live text is cleaned too', async () => {
    const db = makeChatDb();
    await patchWorkerConversation(db.conv.id, { live_text: `half ${EM} way` }, db);
    expect(db.conv.live_text).toBe('half, way');
  });
});

describe('patchWorkerConversation', () => {
  it('refuses a model that is not sonnet or haiku, and never lets the daemon close a chat', async () => {
    const db = makeChatDb();
    for (const m of ['fable', 'opus', 'best', 'default']) await expect(patchWorkerConversation(db.conv.id, { model: m }, db)).rejects.toMatchObject({ statusCode: 400 });
    await patchWorkerConversation(db.conv.id, { model: 'claude-sonnet-4-5-20250929', status: 'running', live_text: 'y'.repeat(5000) }, db);
    expect(db.conv.status).toBe('running');
    expect(String(db.conv.live_text ?? '').length).toBe(4000);
    await expect(patchWorkerConversation(db.conv.id, { status: 'closed' as never }, db)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('stop and feed', () => {
  it('a stop is queued only while running and only once; the feed hides it', async () => {
    const idle = makeChatDb();
    expect(await requestStop(idle.conv.id, idle.conv.owner_id, idle)).toEqual({ queued: false });
    expect(idle.conv.last_seq).toBe(0);
    const running = makeChatDb({ conv: { status: 'running' } });
    expect(await requestStop(running.conv.id, running.conv.owner_id, running)).toEqual({ queued: true });
    expect(await requestStop(running.conv.id, running.conv.owner_id, running)).toEqual({ queued: true });
    expect(running.events).toHaveLength(1);
    expect((running.events[0].payload as { code: string }).code).toBe(STOP_CODE);
    expect((await feed(running.conv.id, {}, running)).events).toHaveLength(0);
  });
});
