import { describe, it, expect } from 'vitest';
import { owedQueue } from '../queue';
import { OWED } from '../copy';
import { threadKey } from '../../item-key';
import { NOW, d, makeAsk, makeClient, makeThread } from '../../__tests__/fixtures/tonight';
import { makeRow } from './fixtures/owed-row';

const client = makeClient('Active Co');
const old = d('2026-11-02T15:00:00Z');
const clientThread = (over = {}) => makeThread({ client, received_at: old, ...over });
const leadThread = (over = {}) => makeThread({ intent: 'sales', received_at: d('2026-11-07T15:00:00Z'), ...over });
const keyOf = (t: ReturnType<typeof makeThread>) => threadKey(t.account, t.thread_id);
const keys = (r: { thread_key: string }[]) => r.map((x) => x.thread_key);

describe('owedQueue qualifying', () => {
  it('lists a client thread and a lead, never an unknown person', () => {
    const c = clientThread();
    const l = leadThread();
    const u = makeThread({ received_at: old });
    expect(keys(owedQueue({}, [c, l, u], [], NOW, 6))).toEqual([keyOf(l), keyOf(c)]);
  });
  it('a young client thread waits; a young lead does not', () => {
    const young = clientThread({ received_at: d('2026-11-09T20:00:00Z') });
    const lead = leadThread({ received_at: d('2026-11-09T20:00:00Z') });
    expect(keys(owedQueue({}, [young, lead], [], NOW, 6))).toEqual([keyOf(lead)]);
  });
  it('a thread over 21 days old is out', () => {
    expect(owedQueue({}, [clientThread({ received_at: d('2026-10-01T15:00:00Z') })], [], NOW, 6)).toEqual([]);
  });
  it('a crisis thread, an urgent ask on the thread and a dismissed thread are out', () => {
    const a = clientThread();
    const b = clientThread();
    const c = makeThread({ client, received_at: old, is_urgent: true });
    expect(keys(owedQueue({ crisisKeys: new Set([keyOf(a)]), dismissed: new Set([keyOf(b)]) }, [a, b, c], [], NOW, 6))).toEqual([]);
  });
  it('his own draft keeps the thread out; Bast\'s own draft row does not', () => {
    const his = clientThread({ draft_url: 'https://mail.google.com/d' });
    expect(owedQueue({}, [his], [], NOW, 6)).toEqual([]);
    const k = keyOf(his);
    const redraft = makeRow({ thread_key: k, state: 'drafted', draft_id: 'r1', draft_for_ask_id: 'older' });
    expect(keys(owedQueue({}, [his], [redraft], NOW, 6))).toEqual([k]);
  });
  it('an up to date Bast draft, an edited one and needs_thought are out', () => {
    const a = clientThread();
    const b = clientThread();
    const c = clientThread();
    const rows = [
      makeRow({ thread_key: keyOf(a), state: 'drafted', draft_id: 'r1', draft_for_ask_id: a.asks[0].id }),
      makeRow({ thread_key: keyOf(b), state: 'drafted', draft_id: 'r2', draft_for_ask_id: 'older', mike_edited_at: d('2026-11-08T00:00:00Z') }),
      makeRow({ thread_key: keyOf(c), state: 'needs_thought' }),
    ];
    // Slice 4c: these threads are old, so a's unsent draft is at its fifth business day and gets Bast's read (the clock). b and c stay out.
    const q = owedQueue({}, [a, b, c], rows, NOW, 6);
    expect(q.map((e) => e.thread_key)).toEqual([keyOf(a)]);
    expect(q[0]).toMatchObject({ reason: 'clock', request: 'read' });
  });
  it('needs_thought comes back when a tap is waiting', () => {
    const c = clientThread();
    const r = makeRow({ thread_key: keyOf(c), state: 'needs_thought', request_kind: 'go_with_that', requested_at: NOW });
    const q = owedQueue({}, [c], [r], NOW, 6);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ reason: 'request', request: 'go_with_that' });
  });
  it('3 failed attempts in the last 24 hours stop it; older than that, or fewer, do not', () => {
    const a = clientThread();
    const b = clientThread();
    const c = clientThread();
    const rows = [
      makeRow({ thread_key: keyOf(a), state: 'failed', attempts: OWED.failCap, updated_at: new Date(NOW.getTime() - 3_600_000) }),
      makeRow({ thread_key: keyOf(b), state: 'failed', attempts: OWED.failCap, updated_at: new Date(NOW.getTime() - 25 * 3_600_000) }),
      makeRow({ thread_key: keyOf(c), state: 'failed', attempts: OWED.failCap - 1, updated_at: NOW }),
    ];
    expect(keys(owedQueue({}, [a, b, c], rows, NOW, 6)).sort()).toEqual([keyOf(b), keyOf(c)].sort());
  });
});

describe('owedQueue order and limit', () => {
  it('taps, then redrafts, then leads, then the oldest thread', () => {
    const oldest = clientThread({ received_at: d('2026-10-28T15:00:00Z') });
    const newer = clientThread({ received_at: d('2026-11-03T15:00:00Z') });
    const lead = leadThread();
    const redraft = clientThread({ received_at: d('2026-11-04T15:00:00Z') });
    const tapped = clientThread({ received_at: d('2026-11-05T15:00:00Z') });
    const rows = [
      makeRow({ thread_key: keyOf(redraft), state: 'drafted', draft_id: 'r', draft_for_ask_id: 'older' }),
      makeRow({ thread_key: keyOf(tapped), request_kind: 'draft', requested_at: NOW }),
    ];
    const q = owedQueue({}, [newer, oldest, lead, redraft, tapped], rows, NOW, 6);
    expect(keys(q)).toEqual([keyOf(tapped), keyOf(redraft), keyOf(lead), keyOf(oldest), keyOf(newer)]);
    expect(q.map((e) => e.reason)).toEqual(['request', 'redraft', 'lead', 'oldest', 'oldest']);
  });
  it('the oldest tap goes first', () => {
    const a = clientThread();
    const b = clientThread();
    const rows = [
      makeRow({ thread_key: keyOf(a), request_kind: 'draft', requested_at: d('2026-11-09T20:00:00Z') }),
      makeRow({ thread_key: keyOf(b), request_kind: 'read', requested_at: d('2026-11-09T10:00:00Z') }),
    ];
    expect(keys(owedQueue({}, [a, b], rows, NOW, 6))).toEqual([keyOf(b), keyOf(a)]);
  });
  it('honours the limit, 6 by default', () => {
    const many = Array.from({ length: 9 }, (_, i) => clientThread({ received_at: new Date(old.getTime() + i * 60_000) }));
    expect(owedQueue({}, many, [], NOW, 2)).toHaveLength(2);
    expect(owedQueue({}, many, [], NOW)).toHaveLength(OWED.perRun);
    expect(owedQueue({}, many, [], NOW, 0)).toEqual([]);
  });
  it('an ask with a newer id order does not matter: the first ask is the newest', () => {
    const newest = makeAsk({ client, received_at: old });
    const t = { account: newest.account, thread_id: newest.thread_id!, asks: [newest] };
    expect(owedQueue({}, [t], [], NOW, 6)[0].thread).toBe(t);
  });
});
