import { describe, it, expect } from 'vitest';
import { owedQueue } from '../queue';
import { checkShortDraft } from '../checks';
import { threadKey } from '../../item-key';
import { NOW, d, makeClient, makeThread } from '../../__tests__/fixtures/tonight';
import { makeRow } from './fixtures/owed-row';

const client = makeClient('Active Co');
const keyOf = (t: ReturnType<typeof makeThread>) => threadKey(t.account, t.thread_id);
const CAPS = { short: true, auto: true };
// NOW is Monday 2026-11-09 18:59 Eastern.
const day5 = d('2026-11-02T15:00:00Z'); // 5 business days
const day2 = d('2026-11-05T15:00:00Z');

describe('queue, Slice 4c', () => {
  it('day 5 with Bast\'s draft unsent asks for a read; a thought row already read does not repeat it', () => {
    const t = makeThread({ client, received_at: day5 });
    const row = makeRow({ thread_key: keyOf(t), state: 'drafted', draft_id: 'g', draft_for_ask_id: t.asks[0].id, draft_text: 'Hi.' });
    expect(owedQueue({}, [t], [row], NOW, 6)[0]).toMatchObject({ reason: 'clock', request: 'read' });
    const read = makeRow({ ...row, thought_since: d('2026-11-09T10:00:00Z') });
    expect(owedQueue({}, [t], [{ ...read, state: 'drafted' }], NOW, 6)).toEqual([]);
  });
  it('day 2 asks for nothing', () => {
    const t = makeThread({ client, received_at: day2 });
    const row = makeRow({ thread_key: keyOf(t), state: 'drafted', draft_id: 'g', draft_for_ask_id: t.asks[0].id });
    expect(owedQueue({}, [t], [row], NOW, 6)).toEqual([]);
  });
  it('a Needs-thought row at day 5 with a full draft asks for a short draft, only with caps', () => {
    const t = makeThread({ client, received_at: day5 });
    const row = makeRow({ thread_key: keyOf(t), state: 'needs_thought', draft_id: 'g', draft_for_ask_id: t.asks[0].id, draft_text: 'Hi there.', thought_since: d('2026-11-09T10:00:00Z') });
    expect(owedQueue({}, [t], [row], NOW, 6)).toEqual([]);
    expect(owedQueue({}, [t], [row], NOW, 6, CAPS)[0]).toMatchObject({ reason: 'short', request: 'short' });
    expect(owedQueue({}, [t], [{ ...row, short_draft_id: 's1' }], NOW, 6, CAPS)).toEqual([]);
  });
  it('3 business days of Needs thought with a suggestion and no commitment asks for auto; never when it needs a commitment', () => {
    const t = makeThread({ client, received_at: d('2026-11-03T15:00:00Z') });
    const base = { thread_key: keyOf(t), state: 'needs_thought', suggested_answer: 'Ask which pages.', thought_since: d('2026-11-04T15:00:00Z') };
    expect(owedQueue({}, [t], [makeRow(base)], NOW, 6, CAPS)[0]).toMatchObject({ reason: 'auto', request: 'auto' });
    expect(owedQueue({}, [t], [makeRow(base)], NOW, 6)).toEqual([]);
    expect(owedQueue({}, [t], [makeRow({ ...base, needs_commitment: true })], NOW, 6, CAPS)).toEqual([]);
    expect(owedQueue({}, [t], [makeRow({ ...base, auto_drafted_at: NOW })], NOW, 6, CAPS)).toEqual([]);
    expect(owedQueue({}, [t], [makeRow({ ...base, thought_since: d('2026-11-09T10:00:00Z') })], NOW, 6, CAPS)).toEqual([]);
  });
  it('auto and short requests come last', () => {
    const a = makeThread({ client, received_at: d('2026-11-03T15:00:00Z') });
    const b = makeThread({ client, received_at: d('2026-11-04T15:00:00Z') });
    const rows = [makeRow({ thread_key: keyOf(a), state: 'needs_thought', suggested_answer: 'x', thought_since: d('2026-11-04T15:00:00Z') })];
    expect(owedQueue({}, [a, b], rows, NOW, 6, CAPS).map((e) => e.reason)).toEqual(['oldest', 'auto']);
  });
  it('a lead past its clock with an older draft is refreshed; a lead that came back gets a short draft once', () => {
    const t = makeThread({ intent: 'sales', received_at: d('2026-11-02T15:00:00Z') });
    const row = makeRow({ thread_key: keyOf(t), state: 'drafted', draft_id: 'g', draft_for_ask_id: t.asks[0].id, draft_text: 'Hi.', drafted_at: d('2026-11-04T16:00:00Z') });
    expect(owedQueue({}, [t], [row], NOW, 6)[0]).toMatchObject({ reason: 'clock', request: 'draft', lead: true });
    const fresh = { ...row, drafted_at: d('2026-11-09T12:00:00Z') };
    expect(owedQueue({}, [t], [fresh], NOW, 6, CAPS)[0]).toMatchObject({ reason: 'short', request: 'short' });
    expect(owedQueue({}, [t], [{ ...fresh, resurfaced_at: d('2026-11-09T12:30:00Z') }], NOW, 6, CAPS)).toEqual([]);
  });
  it('a thread answered from our side is out, and joined keys are listed', () => {
    const t = makeThread({ client, received_at: day5 });
    const other = 'thread:bast@x.test:other';
    const row = makeRow({ thread_key: keyOf(t), replied_elsewhere_at: d('2026-11-09T12:00:00Z'), replied_elsewhere_from: 'support@x' });
    expect(owedQueue({}, [t], [row], NOW, 6)).toEqual([]);
    const q = owedQueue({ members: new Map([[keyOf(t), [other]]]) }, [t], [], NOW, 6);
    expect(q[0].joined).toEqual([other]);
  });
  it('Not a lead makes a lead an ordinary reply', () => {
    const t = makeThread({ intent: 'sales', client, received_at: d('2026-11-09T20:00:00Z') });
    expect(owedQueue({}, [t], [], NOW, 6)).toHaveLength(1);
    const row = makeRow({ thread_key: keyOf(t), not_lead_at: d('2026-11-09T21:00:00Z') });
    expect(owedQueue({}, [t], [row], NOW, 6)).toEqual([]);
  });
});

describe('checkShortDraft', () => {
  it('two plain sentences pass', () => {
    expect(checkShortDraft('Thanks, got this. I will get back to you.').ok).toBe(true);
  });
  it('three sentences, over 40 words, a price or a dash fail', () => {
    expect(checkShortDraft('One. Two. Three.').ok).toBe(false);
    expect(checkShortDraft(Array(41).fill('word').join(' ')).ok).toBe(false);
    expect(checkShortDraft('That would be $500.').ok).toBe(false);
    expect(checkShortDraft('Got it — thanks.').ok).toBe(false);
  });
});
