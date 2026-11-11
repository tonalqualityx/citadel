import { describe, it, expect } from 'vitest';
import { mergeJoinedThreads, repliedElsewhere, type JoinRow } from '../join';
import { threadKey } from '../../item-key';
import { d, makeAsk, makeThread } from '../../__tests__/fixtures/tonight';

const a = makeThread({ account: 'mike@becomeindelible.com', received_at: d('2026-11-03T15:00:00Z') });
const b = makeThread({ account: 'mike@whoismikedion.com', received_at: d('2026-11-05T15:00:00Z') });
const c = makeThread({ account: 'bast@becomeindelible.com', received_at: d('2026-11-04T15:00:00Z') });
const ka = threadKey(a.account, a.thread_id);
const kb = threadKey(b.account, b.thread_id);
const kc = threadKey(c.account, c.thread_id);

describe('mergeJoinedThreads', () => {
  it('no links: the threads pass through unchanged', () => {
    const r = mergeJoinedThreads([a, b], []);
    expect(r.threads).toEqual([a, b]);
    expect(r.members.size).toBe(0);
  });
  it('a joined pair is one thread: the one with the newest message, every ask, newest first', () => {
    const rows: JoinRow[] = [{ thread_key: ka, joined_to_key: kb }];
    const r = mergeJoinedThreads([a, b, c], rows);
    expect(r.threads).toHaveLength(2);
    const merged = r.threads.find((t) => t.thread_id === b.thread_id)!;
    expect(merged.account).toBe(b.account);
    expect(merged.asks.map((x) => x.id)).toEqual([b.asks[0].id, a.asks[0].id]);
    expect(r.members.get(kb)).toEqual([ka]);
  });
  it('the primary follows the newest message, whichever way the link points', () => {
    const rows: JoinRow[] = [{ thread_key: kb, joined_to_key: ka }, { thread_key: kc, joined_to_key: ka }];
    const r = mergeJoinedThreads([a, b, c], rows);
    expect(r.threads).toHaveLength(1);
    expect(r.threads[0].thread_id).toBe(b.thread_id);
    expect(r.members.get(kb)?.sort()).toEqual([ka, kc].sort());
  });
  it('a link to a thread with no open ask now still leaves the other one alone', () => {
    const r = mergeJoinedThreads([a], [{ thread_key: ka, joined_to_key: kb }]);
    expect(r.threads).toHaveLength(1);
    expect(r.threads[0].thread_id).toBe(a.thread_id);
    expect(r.members.get(ka)).toEqual([kb]);
  });
  it('the same ask is never listed twice', () => {
    const dup = { ...a, asks: [makeAsk({ ...a.asks[0] })] };
    const r = mergeJoinedThreads([a, dup], [{ thread_key: ka, joined_to_key: ka }]);
    expect(r.threads.length).toBeGreaterThan(0);
  });
});

describe('repliedElsewhere', () => {
  const rows = new Map<string, JoinRow>([[ka, { thread_key: ka, replied_elsewhere_at: d('2026-11-06T15:00:00Z'), replied_elsewhere_from: 'support@becomeindelible.com' }]]);
  it('hides when our reply is after their newest message', () => {
    expect(repliedElsewhere(kb, [ka], rows, d('2026-11-05T15:00:00Z'))?.from).toBe('support@becomeindelible.com');
  });
  it('a newer message from them brings it back', () => {
    expect(repliedElsewhere(kb, [ka], rows, d('2026-11-07T15:00:00Z'))).toBeNull();
  });
});
