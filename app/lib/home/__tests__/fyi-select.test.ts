import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import { proposeDay } from '../today';
import { owedQueue } from '../owed/queue';
import { buildTiles } from '@/components/domain/home/home-screen-logic';
import type { HomeResponse, RawHomeInputs } from '../types';
import { NOW, d, makeClient, makeInputs, makeTask, makeThread } from './fixtures/tonight';
import { makeRow } from '../owed/__tests__/fixtures/owed-row';

const sel = (raw: Partial<RawHomeInputs>) => selectHome({ raw: makeInputs({ now: NOW, ...raw }), states: [], now: NOW });
const client = makeClient('VCDP');
const oldDay = d('2026-10-26T15:00:00Z'); // ten business days before NOW
const fyiThread = (over = {}, extra = []) =>
  makeThread({ client, from_name: 'Dan Wargo', subject: 'Re: newsletter email', received_at: oldDay, disposition: 'fyi', addressed_to: 'Lisa', ...over }, extra);

describe('FYI rows: shape', () => {
  it('reads "FYI: Dan and Lisa, newsletter email", with no clock, no draft line and one Clear button', () => {
    const r = sel({ threads: [fyiThread()] });
    const item = r.sections.mail[0];
    expect(item.title).toBe('FYI: Dan and Lisa, newsletter email');
    expect(item.fyi).toBe(true);
    expect(item.owed_line).toBe('You were copied');
    expect(item.owed_state ?? null).toBeNull();
    expect(item.who).toContain('Dan Wargo to Lisa');
    expect(item.why_now).toBe('Written to Lisa about their own work. Nothing is owed.');
    expect(item.owed_line).not.toMatch(/Waiting/);
    expect(item.default_if_ignored).not.toMatch(/If you do nothing/i);
    expect(item.default_if_ignored).toBe('It stays here until you clear it. Nothing is owed.');
    expect(item.actions.map((a) => [a.id, a.label])).toEqual([
      ['open_thread', expect.any(String)],
      ['no_reply_needed', 'Clear'],
    ]);
    expect(item.more_actions).toEqual([]);
    const c = r.candidates.find((x) => x.kind === 'thread')!;
    expect(c.clockDue).toBeFalsy();
    expect(c.fyi).toBe(true);
  });

  it('without an addressee the title falls back to the sender and subject', () => {
    const item = sel({ threads: [fyiThread({ addressed_to: null })] }).sections.mail[0];
    expect(item.title).toBe('FYI: Dan Wargo, newsletter email');
    expect(item.why_now).toBe('Written to someone else. Nothing is owed.');
  });

  it('a client thread received ten minutes ago is shown at once with the client reason', () => {
    const t = makeThread({ client, received_at: new Date(NOW.getTime() - 10 * 60_000) });
    const r = sel({ threads: [t] });
    expect(r.sections.mail).toHaveLength(1);
    expect(r.sections.mail[0].reason).toBe('A client is waiting on a reply.');
  });

  it('a thread known only by his own draft, same age, is counted under New mail', () => {
    const t = makeThread({ draft_url: 'https://mail.google.com/draft/1', received_at: new Date(NOW.getTime() - 10 * 60_000) });
    const r = sel({ threads: [t] });
    expect(r.sections.mail).toEqual([]);
    expect(r.everything_else.groups).toEqual([expect.objectContaining({ key: 'new_mail', count: 1 })]);
  });
});

describe('FYI rows: placement', () => {
  it('sorts after an owed client thread of the same age and carries the fyi reason', () => {
    const owed = makeThread({ client, received_at: oldDay });
    const r = sel({ threads: [fyiThread(), owed] });
    expect(r.sections.mail.map((i) => !!i.fyi)).toEqual([false, true]);
    expect(r.sections.mail[1].reason).toBe('You were copied on it, so it is shown, not owed.');
  });

  it('with three owed threads it goes to Waiting its turn', () => {
    const owed = [0, 1, 2].map(() => makeThread({ client, received_at: oldDay }));
    const f = fyiThread();
    const r = sel({ threads: [f, ...owed] });
    expect(r.sections.mail.some((i) => i.fyi)).toBe(false);
    expect(r.everything_else.groups).toEqual([expect.objectContaining({ key: 'waiting_turn', count: 1 })]);
  });

  it('an older ask that is fyi with a newest reply_mike is an ordinary owed row', () => {
    const older = makeThread({ client, received_at: oldDay, disposition: 'fyi' }).asks[0];
    const t = makeThread({ client, from_name: 'Dan Wargo', received_at: d('2026-11-02T15:00:00Z'), disposition: 'reply_mike', thread_id: older.thread_id, account: older.account }, [older]);
    const item = sel({ threads: [t] }).sections.mail[0];
    expect(item.fyi).toBeUndefined();
    expect(item.title).not.toMatch(/^FYI/);
    expect(item.owed_line).toMatch(/Waiting/);
  });
});

describe('FYI rows: never a quick item, an arc step, a draft or a count', () => {
  it('buildToday never lists the FYI key in quick or steps', () => {
    const task = makeTask({ client, requested_by_contact_id: 'c', clock_started_at: oldDay, created_at: oldDay });
    const t = fyiThread();
    const raw = makeInputs({ now: NOW, tasks: [task], threads: [t] });
    const s = selectHome({ raw, states: [], now: NOW });
    const key = s.sections.mail[0].key;
    const day = proposeDay(s, raw.calendar_events, NOW);
    expect(day?.quick_item_keys ?? []).not.toContain(key);
    expect(day?.step_item_keys ?? []).not.toContain(key);
  });

  it('the drafter skips an all-fyi thread even with a request waiting', () => {
    const t = fyiThread();
    const key = `thread:${t.account}:${t.thread_id}`;
    expect(owedQueue({}, [t], [makeRow({ thread_key: key, request_kind: 'draft', requested_at: NOW })], NOW)).toEqual([]);
  });

  it('the drafter keeps its timing: a young client thread waits, but a tap is served at once', () => {
    const fresh = d('2026-11-09T20:00:00Z');
    const young = makeThread({ client, received_at: fresh });
    expect(owedQueue({}, [young], [], NOW)).toEqual([]);
    const key = `thread:${young.account}:${young.thread_id}`;
    expect(owedQueue({}, [young], [makeRow({ thread_key: key, request_kind: 'draft', requested_at: NOW })], NOW)).toHaveLength(1);
  });

  it('the client emails tile excludes FYI rows', () => {
    const r = sel({ threads: [fyiThread(), makeThread({ client, received_at: oldDay })] });
    const res = {
      today: null,
      sections: { ...r.sections },
      everything_else: r.everything_else,
      triage: { count: 0, open_questions: 0, groups: [], cards: [] },
    } as unknown as HomeResponse;
    expect(r.sections.mail).toHaveLength(2);
    expect(buildTiles(res, 0).find((t) => t.id === 'mail')).toMatchObject({ count: 1 });
  });
});
