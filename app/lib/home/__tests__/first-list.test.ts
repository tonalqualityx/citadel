import { describe, it, expect } from 'vitest';
import { buildFirstList, FIRST_LIST_MAX, moneyWords } from '../first-list';
import type { Candidate } from '../select';
import type { HomeMoneyRow, HomeTriage, HomeTriageCard } from '../types';

const NOW = new Date('2026-11-10T15:00:00Z'); // Tuesday 10:00 in New York
const TZ = 'America/New_York';
const d = (s: string) => new Date(s);

let n = 0;
function cand(over: Partial<Candidate> & { itemOver?: Record<string, unknown>; taskId?: string | null } = {}): Candidate {
  n += 1;
  const key = over.key ?? `task:t${n}`;
  const { itemOver, taskId, ...rest } = over;
  return {
    key,
    kind: 'task',
    item: {
      key,
      type: 'task',
      title: `Title ${key}`,
      age: '3 days',
      why_now: `Why ${key}.`,
      hard_date: null,
      opened: { task_id: taskId === undefined ? key.replace('task:', '') : taskId, links: [] },
      ...(itemOver ?? {}),
    },
    rule: null,
    parked: false,
    pinned: false,
    fyi: false,
    section: 'next',
    hardDate: null,
    since: d('2026-11-01T12:00:00Z'),
    botTask: false,
    ...rest,
  } as unknown as Candidate;
}

const money = (key: string, amount: number | null, over: Partial<HomeMoneyRow> = {}): HomeMoneyRow => ({
  key,
  kind: 'unpaid_invoice',
  amount,
  label: `Invoice ${key}`,
  client_id: 'c1',
  client_name: 'Acme',
  project_id: null,
  project_name: null,
  due: '2026-11-03',
  ...over,
});

const card = (id: string, created: string, over: Partial<HomeTriageCard> = {}) =>
  ({ task_id: id, title: `Card ${id}`, href: `/tasks/${id}`, created_at: created, age_days: 4, summary: 'Wanted.', ...over }) as unknown as HomeTriageCard;
const triageOf = (cards: HomeTriageCard[]): HomeTriage => ({ count: cards.length, open_questions: 0, groups: [], cards });

const build = (over: Partial<Parameters<typeof buildFirstList>[0]> = {}) =>
  buildFirstList({ candidates: [], triage: null, money: [], now: NOW, timezone: TZ, ...over });
const keys = (l: ReturnType<typeof buildFirstList>) => l.rows.map((r) => r.key);

describe('buildFirstList: tier order', () => {
  it('crisis, then money, then deadline, then decision', () => {
    const crisis = cand({ key: 'thread:site', rule: 'site_down' as never, section: 'needs_you_now', kind: 'crisis' as never });
    const dead = cand({ key: 'task:dead', hardDate: d('2026-11-12T00:00:00Z') });
    const decide = cand({ key: 'task:decide' });
    const l = build({ candidates: [decide, dead, crisis], money: [money('inv1', 500)], triage: triageOf([card('trg', '2026-10-01T00:00:00Z')]) });
    expect(l.rows.map((r) => r.tier)).toEqual(['crisis', 'money', 'deadline', 'decision', 'decision']);
    expect(keys(l).slice(0, 3)).toEqual(['thread:site', 'inv1', 'task:dead']);
  });

  it('orders crises with the emergency comparison (a client first, then the nearest date)', () => {
    const a = cand({ key: 'task:a', rule: 'security' as never, section: 'needs_you_now', itemOver: { client: null } });
    const b = cand({ key: 'task:b', rule: 'security' as never, section: 'needs_you_now', itemOver: { client: { id: 'c', name: 'C' } } });
    expect(keys(build({ candidates: [a, b] }))).toEqual(['task:b', 'task:a']);
  });
});

describe('buildFirstList: money', () => {
  it('biggest amount first, amounts not set after, then sales leads', () => {
    const lead = cand({ key: 'thread:lead', kind: 'thread' as never, section: 'leads' });
    const l = build({
      candidates: [lead],
      money: [money('small', 120), money('none', null), money('big', 4250.5, { kind: 'ready_invoice', due: null }), money('mid', 900)],
      leadOrder: ['thread:lead'],
    });
    expect(keys(l)).toEqual(['big', 'mid', 'small', 'none', 'thread:lead']);
    expect(l.rows[0].amount).toBe('$4,250.50');
    expect(l.rows[1].amount).toBe('$900');
    expect(l.rows[3].amount).toBeNull();
    expect(l.rows[3].line).toContain('Amount not set');
    expect(l.rows[4].age).toBe('3 days');
  });

  it('a money row opens its project, else its client, else billing', () => {
    const l = build({ money: [money('a', 3, { project_id: 'p1' }), money('b', 2), money('c', 1, { client_id: null })] });
    expect(l.rows.map((r) => r.open)).toEqual([
      { kind: 'link', href: '/projects/p1' },
      { kind: 'link', href: '/clients/c1' },
      { kind: 'link', href: '/billing' },
    ]);
  });

  it('leads keep the screen order', () => {
    const a = cand({ key: 'thread:a', section: 'leads' });
    const b = cand({ key: 'thread:b', section: 'leads' });
    expect(keys(build({ candidates: [a, b], leadOrder: ['thread:b', 'thread:a'] }))).toEqual(['thread:b', 'thread:a']);
  });

  it('uses no alarm words', () => {
    const l = build({ money: [money('a', 10), money('b', null, { kind: 'milestone' })] });
    const text = JSON.stringify(l);
    expect(text).not.toMatch(/overdue|past due|priority|\blate\b/i);
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('buildFirstList: deadlines', () => {
  it('nearest first, a passed date counts and sorts first, 7 days in and 8 days out', () => {
    const past = cand({ key: 'task:past', hardDate: d('2026-11-05T00:00:00Z') });
    const soon = cand({ key: 'task:soon', hardDate: d('2026-11-11T00:00:00Z') });
    const edge = cand({ key: 'task:edge', hardDate: d('2026-11-17T00:00:00Z') });
    const far = cand({ key: 'task:far', hardDate: d('2026-11-18T00:00:00Z') });
    const deadlines = build({ candidates: [far, edge, soon, past] }).rows.filter((r) => r.tier === 'deadline');
    expect(deadlines.map((r) => r.key)).toEqual(['task:past', 'task:soon', 'task:edge']);
    expect(deadlines[1].date).toBe('Wed, Nov 11');
  });

  it('a hard date 10 days out is not in the deadlines (it is only a decision, since it is his task)', () => {
    const far = cand({ key: 'task:far10', hardDate: d('2026-11-20T00:00:00Z') });
    const l = build({ candidates: [far] });
    expect(l.rows.map((r) => r.tier)).toEqual(['decision']);
  });
});

describe('buildFirstList: decisions', () => {
  it('his tasks and Triage cards, oldest first', () => {
    const newest = cand({ key: 'task:new', since: d('2026-11-08T00:00:00Z') });
    const oldest = cand({ key: 'task:old', since: d('2026-10-01T00:00:00Z') });
    const l = build({ candidates: [newest, oldest], triage: triageOf([card('mid', '2026-10-20T00:00:00Z')]) });
    expect(keys(l)).toEqual(['task:old', 'task:mid', 'task:new']);
    expect(l.rows[1].open).toEqual({ kind: 'triage', task_id: 'mid', title: 'Card mid' });
    expect(l.rows[1].age).toBe('4 days');
  });

  it('a task opens its peek', () => {
    const l = build({ candidates: [cand({ key: 'task:abc', taskId: 'abc' })] });
    expect(l.rows[0].open).toMatchObject({ kind: 'task', task_id: 'abc', key: 'task:abc' });
  });

  it('a row with no task opens its own tile in Everything else', () => {
    const l = build({ candidates: [cand({ key: 'thread:x', kind: 'thread' as never, section: 'needs_you_now', rule: 'site_down' as never, taskId: null })] });
    expect(l.rows[0].open).toEqual({ kind: 'item', key: 'thread:x', tile: 'needs_you_now' });
  });
});

describe('buildFirstList: what does not need him never appears', () => {
  it('working on, parked, FYI, rest, mail, and non-task kinds without a date or rule', () => {
    const l = build({
      candidates: [
        cand({ key: 'task:working', pinned: true, section: 'working_on' }),
        cand({ key: 'task:parked', parked: true, section: 'rest' }),
        cand({ key: 'task:parked-next', parked: true }),
        cand({ key: 'thread:fyi', kind: 'thread' as never, fyi: true, section: 'mail' }),
        cand({ key: 'thread:mail', kind: 'thread' as never, section: 'mail' }),
        cand({ key: 'task:rest', section: 'rest', hardDate: d('2026-11-11T00:00:00Z') }),
        cand({ key: 'task:pinned-date', pinned: true, hardDate: d('2026-11-11T00:00:00Z') }),
        cand({ key: 'review:x', kind: 'review' as never }),
        cand({ key: 'thread:lead-parked', kind: 'thread' as never, section: 'leads', parked: true }),
      ],
    });
    expect(l.rows).toEqual([]);
    expect(l.more).toBe(0);
  });

  it('a parked emergency inside Needs you now still shows (the screen ignores a snooze for those)', () => {
    const c = cand({ key: 'task:crisis', rule: 'security' as never, section: 'needs_you_now', parked: true });
    expect(keys(build({ candidates: [c] }))).toEqual(['task:crisis']);
  });

  it('nothing at all gives an empty list', () => {
    expect(build()).toEqual({ rows: [], more: 0 });
  });
});

describe('buildFirstList: dedupe and cap', () => {
  it('an item appears once, in its highest tier', () => {
    const both = cand({ key: 'task:both', rule: 'security' as never, section: 'needs_you_now', hardDate: d('2026-11-11T00:00:00Z') });
    const l = build({ candidates: [both], triage: triageOf([card('both', '2026-10-01T00:00:00Z')]) });
    expect(keys(l)).toEqual(['task:both']);
    expect(l.rows[0].tier).toBe('crisis');
  });

  it('caps at 10 rows filled in tier order, and counts the rest', () => {
    const decisions = Array.from({ length: 6 }, (_, i) => cand({ key: `task:d${i}`, since: d(`2026-10-0${i + 1}T00:00:00Z`) }));
    const moneys = Array.from({ length: 7 }, (_, i) => money(`inv${i}`, 100 + i));
    const l = build({ candidates: decisions, money: moneys });
    expect(l.rows).toHaveLength(FIRST_LIST_MAX);
    expect(l.rows.filter((r) => r.tier === 'money')).toHaveLength(7);
    expect(l.rows.filter((r) => r.tier === 'decision').map((r) => r.key)).toEqual(['task:d0', 'task:d1', 'task:d2']);
    expect(l.more).toBe(3);
  });
});

describe('moneyWords', () => {
  it('shows whole dollars without cents', () => {
    expect(moneyWords(4250)).toBe('$4,250');
    expect(moneyWords(12.5)).toBe('$12.50');
  });
});

describe('buildFirstList: only a site down or a security flag is a crisis', () => {
  it('an invoice ready to send ranks above a promised client date two days out, which is a deadline', () => {
    const promised = cand({ key: 'task:promised', rule: 'promised_date' as never, section: 'needs_you_now', hardDate: d('2026-11-12T00:00:00Z') });
    const l = build({ candidates: [promised], money: [money('ready', 800, { kind: 'ready_invoice', due: '2026-11-09' })] });
    expect(keys(l)).toEqual(['ready', 'task:promised']);
    expect(l.rows.map((r) => r.tier)).toEqual(['money', 'deadline']);
  });

  it('urgent client mail and a waiting client stay on the list as decisions, after money', () => {
    const mail = cand({ key: 'thread:urgent', kind: 'thread' as never, rule: 'crisis_mail' as never, section: 'needs_you_now', taskId: null });
    const wait = cand({ key: 'wait:w1', kind: 'wait' as never, rule: 'client_waiting' as never, section: 'needs_you_now', taskId: null });
    const l = build({ candidates: [mail, wait], money: [money('inv', 50)] });
    expect(l.rows.map((r) => r.tier)).toEqual(['money', 'decision', 'decision']);
  });

  it('a security flag and a site down are crises, above money', () => {
    const sec = cand({ key: 'task:sec', rule: 'security' as never, section: 'needs_you_now' });
    const down = cand({ key: 'thread:down', kind: 'crisis' as never, rule: 'site_down' as never, section: 'needs_you_now', taskId: null });
    const l = build({ candidates: [sec, down], money: [money('inv', 99999)] });
    expect(l.rows.map((r) => r.tier)).toEqual(['crisis', 'crisis', 'money']);
  });
});
