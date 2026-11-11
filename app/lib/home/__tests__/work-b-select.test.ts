import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import { proposeDay } from '../today';
import { owedQueue } from '../owed/queue';
import type { RawHomeInputs } from '../types';
import { NOW, d, makeClient, makeInputs, makeTask, makeThread } from './fixtures/tonight';

const sel = (raw: Partial<RawHomeInputs>) => selectHome({ raw: makeInputs({ now: NOW, ...raw }), states: [], now: NOW });
const active = makeClient('Active Co');
const old = d('2026-11-02T15:00:00Z');

describe('Work stage B: the thread title and the one state phrase', () => {
  it('the title is "sender, client: subject" with no Re: prefix, cut at 90 characters', () => {
    const t = makeThread({ client: active, from_name: 'Ken Duffy', subject: 'Re: Fwd: The roof quote', gist: 'Ken asks about the roof quote.', received_at: old });
    expect(sel({ threads: [t] }).sections.mail[0].title).toBe('Ken Duffy, Active Co: The roof quote');
    const long = makeThread({ client: active, from_name: 'Ken Duffy', subject: 'x'.repeat(200), received_at: old });
    const title = sel({ threads: [long] }).sections.mail[0].title;
    expect(title.length).toBe(90);
    expect(title.endsWith('…')).toBe(true);
  });

  it('a thread with no state to report has no meta phrase', () => {
    const t = makeThread({ client: active, received_at: old });
    expect(sel({ threads: [t] }).sections.mail[0].owed_line ?? '').not.toContain(' · ');
  });
});

describe('Work stage B: a meeting request is a row that wants a time', () => {
  const meeting = () => makeThread({ client: active, from_name: 'Dan Wargo', subject: 'Can we find a time', received_at: old, disposition: 'meeting' });

  it('shows in Decisions ready as "Wants a time", never in Client emails waiting, with no draft button', () => {
    const t = meeting();
    const r = sel({ threads: [t] });
    const item = r.sections.next.find((i) => i.source.kind === 'thread');
    expect(item?.owed_line).toBe('Wants a time');
    expect(item?.why_now).toBe('Asked for a time to meet.');
    expect(r.sections.mail).toEqual([]);
    const ids = [...(item?.actions ?? []), ...(item?.more_actions ?? [])].map((a) => a.id);
    expect(ids).not.toContain('draft_now');
    expect(ids).toContain('open_thread');
  });

  it('the drafter queue never takes it', () => {
    const t = meeting();
    expect(owedQueue({}, [t], [], NOW)).toEqual([]);
    const plain = makeThread({ client: active, received_at: old });
    expect(owedQueue({}, [plain], [], NOW)).toHaveLength(1);
  });

  it('it has no clock, no wait line and no "If you do nothing" line', () => {
    const t = meeting();
    const r = sel({ threads: [t] });
    const c = r.candidates.find((x) => x.kind === 'thread')!;
    expect(c.clockDue).toBeFalsy();
    expect(c.item.owed_line).not.toMatch(/Waiting/);
  });
});

describe('Work stage B: a thread is never the day arc or an arc step', () => {
  it('a client with a waiting email and a task: the proposed day holds the task, never the thread', () => {
    const task = makeTask({ client: active, requested_by_contact_id: 'c', clock_started_at: old, created_at: old });
    const t = makeThread({ client: active, received_at: old });
    const raw = makeInputs({ now: NOW, tasks: [task], threads: [t] });
    const s = selectHome({ raw, states: [], now: NOW });
    const day = proposeDay(s, raw.calendar_events, NOW);
    expect(day).not.toBeNull();
    expect(day!.step_item_keys.some((k) => k.startsWith('thread:'))).toBe(false);
  });

  it('only a thread in view: no arc is proposed from it', () => {
    const t = makeThread({ client: active, received_at: old });
    const raw = makeInputs({ now: NOW, threads: [t] });
    const s = selectHome({ raw, states: [], now: NOW });
    const day = proposeDay(s, raw.calendar_events, NOW);
    expect(day?.step_item_keys ?? []).toEqual([]);
    expect(day?.group_key ?? 'none').not.toMatch(/^client:/);
  });
});

describe('Work stage B: recorded as handled, and the 30-day list', () => {
  it('a quiet line with Undo (the reopen key), and a read-only list row with the reason', () => {
    const at = d('2026-11-09T14:00:00Z');
    const raw = makeInputs({
      now: NOW,
      intake_handled: [{ id: '7aa4a01a-1111-4222-8333-944445555666', from_name: 'Ken Duffy', from_email: 'k@x.test', subject: 'Appreciate it Mike', kind: 'no_action', deep_link: 'https://mail.google.com/x', handled_at: at }],
      handled_mail: [{ id: '7aa4a01a-1111-4222-8333-944445555666', from_name: 'Ken Duffy', from_email: 'k@x.test', subject: 'Re: Appreciate it Mike', client_name: 'Duffy Co', reason: 'A thank-you, nothing asked', deep_link: 'https://mail.google.com/x', handled_at: at, kind: 'no_action' }],
    });
    const r = selectHome({ raw, states: [], now: NOW });
    const line = r.sections.handled[0];
    expect(line.text).toBe('Recorded as handled: Ken Duffy, "Appreciate it Mike". No reply needed.');
    expect(line.reopen_item_key).toBe('ask:7aa4a01a-1111-4222-8333-944445555666');
    expect(line.undo_action_id).toBeNull();
    expect(r.handled_mail).toEqual([
      { id: '7aa4a01a-1111-4222-8333-944445555666', key: 'ask:7aa4a01a-1111-4222-8333-944445555666', title: 'Ken Duffy, Duffy Co: Appreciate it Mike', reason: 'A thank-you, nothing asked.', href: 'https://mail.google.com/x', at: at.toISOString(), kind: 'no_action' },
    ]);
    // Never counted in Everything else.
    expect(r.everything_else.count).toBe(0);
  });

  it('a waiting_them record reads "Waiting on them."', () => {
    const raw = makeInputs({
      now: NOW,
      intake_handled: [{ id: '7aa4a01a-1111-4222-8333-944445555666', from_name: 'Dan', from_email: 'd@x.test', subject: 'Out until Monday', kind: 'waiting_them', deep_link: '', handled_at: NOW }],
    });
    expect(selectHome({ raw, states: [], now: NOW }).sections.handled[0].text).toBe('Recorded as handled: Dan, "Out until Monday". Waiting on them.');
  });
});
