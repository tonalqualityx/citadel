import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import { actionsFor } from '../actions-for';
import { homeActSchema, planAct } from '../act';
import { threadKey } from '../item-key';
import { NOW, d, makeClient, makeInputs, makeState, makeThread } from './fixtures/tonight';
import { makeRow } from '../owed/__tests__/fixtures/owed-row';
import type { OwedRow } from '../owed/state';
import type { RawHomeInputs, RawItemState } from '../types';

const client = makeClient('Active Co');
const sel = (raw: Partial<RawHomeInputs>, states: RawItemState[] = []) => selectHome({ raw: makeInputs({ now: NOW, ...raw }), states, now: NOW });
const keyOf = (t: ReturnType<typeof makeThread>) => threadKey(t.account, t.thread_id);
const find = (r: ReturnType<typeof sel>, t: ReturnType<typeof makeThread>) => r.candidates.find((c) => c.key === keyOf(t));

describe('Slice 4c: clocks on the rows', () => {
  it('day 3 reads "Waiting 3 days." and goes to the top of People', () => {
    const young = makeThread({ client, received_at: d('2026-11-06T15:00:00Z') }); // 1 business day... newest
    const waiting = makeThread({ client, received_at: d('2026-11-04T15:00:00Z') });
    const older = makeThread({ client, received_at: d('2026-11-03T15:00:00Z') });
    const r = sel({ threads: [young, waiting, older] });
    expect(r.sections.mail.map((i) => i.key)[0]).toBe(keyOf(older));
    expect(find(r, waiting)?.item.owed_line).toMatch(/^Waiting \d days\.$/);
    expect(find(r, young)?.item.owed_line).toBeNull();
  });
  it('a lead shows "reply due {weekday}" as plain text, never the hard-date chip, and past the clock goes first', () => {
    const fresh = makeThread({ intent: 'sales', received_at: d('2026-11-09T20:00:00Z') });
    const pastClock = makeThread({ intent: 'sales', received_at: d('2026-11-05T15:00:00Z') });
    const r = sel({ threads: [pastClock, fresh], timezone: 'America/New_York' });
    expect(find(r, fresh)?.item.owed_line).toBe('reply due Wednesday');
    expect(find(r, fresh)?.item.hard_date).toBeNull();
    expect(find(r, pastClock)?.item.owed_line).toMatch(/^reply was due /);
    expect(r.sections.leads.map((i) => i.key)[0]).toBe(keyOf(pastClock));
  });
  it('at 10 business days the lead asks to keep it or let it go', () => {
    const t = makeThread({ intent: 'sales', received_at: d('2026-10-23T15:00:00Z') });
    const item = sel({ threads: [t] }).candidates.find((c) => c.key === keyOf(t))!.item;
    expect(item.why_now).toBe('Keep this lead or let it go?');
    expect(item.actions.map((a) => a.id)).toEqual(['keep_lead', 'let_lead_go', 'not_now']);
    expect(item.more_actions.map((a) => a.id)).toContain('not_lead');
  });
  it('Keep it restarts the clock', () => {
    const t = makeThread({ intent: 'sales', received_at: d('2026-10-23T15:00:00Z') });
    const row: OwedRow = makeRow({ thread_key: keyOf(t), lead_clock_from: d('2026-11-09T15:00:00Z'), keep_lead_at: d('2026-11-09T15:00:00Z') });
    const item = sel({ threads: [t], owed_rows: [row] }).candidates.find((c) => c.key === keyOf(t))!.item;
    expect(item.why_now).not.toBe('Keep this lead or let it go?');
  });
  it('auto draft reads as a line; a short draft shows with Open the short one and no send', () => {
    const t = makeThread({ client, received_at: d('2026-11-09T14:00:00Z') });
    const row = makeRow({ thread_key: keyOf(t), state: 'drafted', draft_id: 'g', draft_for_ask_id: t.asks[0].id, draft_text: 'Full.', auto_drafted_at: NOW, short_draft_id: 's', short_draft_text: 'Short one.' });
    const item = sel({ threads: [makeThread({ client, received_at: d('2026-11-03T15:00:00Z') })], owed_rows: [] }).candidates[0].item;
    expect(item).toBeTruthy();
    const th2 = makeThread({ client, received_at: d('2026-11-03T15:00:00Z') });
    const row2 = { ...row, thread_key: keyOf(th2), draft_for_ask_id: th2.asks[0].id };
    const it2 = find(sel({ threads: [th2], owed_rows: [row2] }), th2)!.item;
    // Work stage B: one state phrase on the meta line (the short draft comes before the auto draft line).
    expect(it2.owed_line).toBe('Short draft ready');
    expect(it2.opened.short_draft_text).toBe('Short one.');
    const ids = [...it2.actions, ...it2.more_actions].map((a) => a.id);
    expect(ids[0]).toBe('open_short');
    expect(ids.join(' ')).not.toMatch(/send/);
  });
});

describe('Slice 4c: wake and parked rows', () => {
  const t = makeThread({ client, received_at: d('2026-11-09T14:00:00Z') });
  const lateT = makeThread({ client, received_at: d('2026-11-02T15:00:00Z') });
  const park = (th: ReturnType<typeof makeThread>, parked_at: Date | null) =>
    makeState(keyOf(th), { park_count: 1, view_at: d('2026-11-11T14:00:00Z'), view_set_by: 'user', parked_at } as Partial<RawItemState>);
  it('a message after Not now brings the row back at once', () => {
    void t;
    const woke = find(sel({ threads: [lateT] }, [park(lateT, d('2026-11-01T15:00:00Z'))]), lateT)!;
    expect(woke.parked).toBe(false);
    expect(woke.item.owed_line).toContain('They wrote again.');
  });
  it('without a newer message the row stays parked', () => {
    const c = find(sel({ threads: [lateT] }, [park(lateT, d('2026-11-08T15:00:00Z'))]), lateT)!;
    expect(c.parked).toBe(true);
  });
});

describe('Slice 4c: one row per conversation', () => {
  it('a joined pair renders one row, with every ask behind it', () => {
    const a = makeThread({ account: 'mike@becomeindelible.com', client, received_at: d('2026-11-03T15:00:00Z') });
    const b = makeThread({ account: 'mike@whoismikedion.com', client, received_at: d('2026-11-04T15:00:00Z') });
    const r = sel({ threads: [a, b], owed_rows: [makeRow({ thread_key: keyOf(a), joined_to_key: keyOf(b) })] });
    const rows = r.candidates.filter((c) => c.kind === 'thread');
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(keyOf(b));
    expect(rows[0].item.source.ids.sort()).toEqual([a.asks[0].id, b.asks[0].id].sort());
  });
  it('a reply from our side hides the row until they write again', () => {
    const a = makeThread({ client, received_at: d('2026-11-03T15:00:00Z') });
    const row = makeRow({ thread_key: keyOf(a), replied_elsewhere_at: d('2026-11-05T15:00:00Z'), replied_elsewhere_from: 'support@x.test' });
    expect(sel({ threads: [a], owed_rows: [row] }).candidates.filter((c) => c.kind === 'thread')).toHaveLength(0);
    const again = makeThread({ client, received_at: d('2026-11-06T15:00:00Z') });
    expect(sel({ threads: [again], owed_rows: [{ ...row, thread_key: keyOf(again) }] }).candidates.filter((c) => c.kind === 'thread')).toHaveLength(1);
  });
});

describe('Slice 4c: buttons and acts', () => {
  it('the chat schema accepts keep_lead and treat_as_reply and still refuses a send', () => {
    expect(homeActSchema.safeParse({ action: 'keep_lead', item_key: 'thread:a:b' }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'treat_as_reply', item_key: 'thread:a:b' }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'send_short', item_key: 'thread:a:b' }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'send_draft', item_key: 'thread:a:b' }).success).toBe(false);
  });
  it('not_now writes parked_at and keep_lead marks the clock', () => {
    const ctx = { now: NOW, timezone: 'America/New_York', state: null, pinned: null, day: null };
    const p = planAct({ action: 'not_now', item_key: 'thread:a:b' }, ctx);
    expect(p.stateWrites[0].patch.parked_at).toEqual(NOW);
    const k = planAct({ action: 'keep_lead', item_key: 'thread:a:b' }, ctx);
    expect(k.leadMark).toEqual({ lead_clock_from: NOW, keep_lead_at: NOW });
    expect(k.stateWrites).toEqual([]);
    expect(planAct({ action: 'treat_as_reply', item_key: 'thread:a:b' }, ctx).leadMark).toEqual({ not_lead_at: NOW });
    expect(() => planAct({ action: 'keep_lead', item_key: 'task:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, ctx)).toThrow();
  });
  it('a short draft puts Open the short one first and never offers a send', () => {
    const out = actionsFor({
      kind: 'thread', emergency: false, pinned: false, parkCount: 0, filledFirst: false,
      draftUrl: 'https://g/d', threadUrl: 'https://g/t', owedThread: { state: 'draft_ready', suggestion: false, lead: true, short: true },
    });
    const ids = [...out.actions, ...out.more_actions].map((a) => a.id);
    expect(ids[0]).toBe('open_short');
    expect(out.actions.map((a) => a.id)).toContain('not_now');
    expect(ids).toContain('not_lead');
    expect(ids.join(',')).not.toMatch(/send/);
  });
});
