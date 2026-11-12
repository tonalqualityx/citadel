// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkRow, clockRowSchema, clocksBodySchema, monthStart, summarize, cleanBasis } from '../clocks';
import { bastLine, formatMinutes, inferredFrom, mikeLine, roundToStep, trackedEstimateBasis } from '../clocks-copy';

const row = (over: Record<string, unknown> = {}) =>
  clockRowSchema.parse({ kind: 'mike_estimate', target_key: null, session_external_id: 's1', source: 'session', started_at: '2026-11-10T14:00:00Z', ended_at: '2026-11-10T14:30:00Z', minutes: 30, dedupe_key: 'k1', ...over });
const NOW = new Date('2026-11-12T15:00:00Z');

describe('words', () => {
  it('formats minutes the way the plan writes them', () => {
    expect(formatMinutes(45)).toBe('45 m');
    expect(formatMinutes(65)).toBe('1 h 05 m');
    expect(formatMinutes(130)).toBe('2 h 10 m');
    expect(formatMinutes(120)).toBe('2 h');
    expect(roundToStep(132)).toBe(130);
  });
  it('an estimate says it is an estimate and what it came from', () => {
    const l = mikeLine(130, 0, inferredFrom(3, 2));
    expect(l).toBe("Your time: about 2 h 10 m this month (Bast's estimate from 3 of your sessions on 2 days). Log it?");
    expect(mikeLine(0, 60, inferredFrom(1, 1))).toContain('Logged.');
    expect(mikeLine(0, 60, inferredFrom(0, 1))).toContain('when you tracked it');
  });
  it('Bast line: minutes, dollars only from real cost', () => {
    expect(bastLine(65, 3.4, true)).toBe('Bast worked: 1 h 05 m, $3.40.');
    expect(bastLine(65, null, false)).toBe('Bast worked: 1 h 05 m.');
    expect(bastLine(65, 3.4, false)).toBe('Bast worked: 1 h 05 m, $3.40 on unattended runs.');
  });
  it('no dash, no banned word in anything it writes', () => {
    const all = [mikeLine(95, 10, inferredFrom(2, 2)), bastLine(80, 1.2, false), trackedEstimateBasis('3 blocks — 7 prompts'), cleanBasis('a – b')].join(' ');
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/priorit|overdue/i);
  });
});

describe('rows', () => {
  it('the machine cannot set a time entry, a user or an unknown field', () => {
    expect(() => row({ time_entry_id: 'x' })).toThrow();
    expect(() => row({ user_id: 'x' })).toThrow();
  });
  it('limits: 1 to 1440 minutes a row, at most 200 rows', () => {
    expect(() => row({ minutes: 0 })).toThrow();
    expect(() => row({ minutes: 1441 })).toThrow();
    expect(clocksBodySchema.safeParse({ rows: Array.from({ length: 201 }, () => ({})) }).success).toBe(false);
    expect(clocksBodySchema.safeParse({ rows: [] }).success).toBe(false);
  });
  it('pairs: the owner estimate comes only from a session or Track it, with no cost; a worker pass is Bast', () => {
    expect(checkRow(row(), NOW)).toBeNull();
    expect(checkRow(row({ source: 'citadel-worker' }), NOW)).toBe('bad_pairing');
    expect(checkRow(row({ cost_usd: 1 }), NOW)).toBe('bad_pairing');
    expect(checkRow(row({ kind: 'bast_run', source: 'citadel-worker', cost_usd: 1.5 }), NOW)).toBeNull();
    expect(checkRow(row({ kind: 'bast_run', source: 'track' }), NOW)).toBe('bad_pairing');
  });
  it('windows: the end is not before the start nor far in the future', () => {
    expect(checkRow(row({ ended_at: '2026-11-10T13:00:00Z' }), NOW)).toBe('bad_window');
    expect(checkRow(row({ started_at: '2026-11-20T14:00:00Z', ended_at: '2026-11-20T14:30:00Z' }), NOW)).toBe('bad_window');
  });
});

describe('summary', () => {
  const at = (iso: string) => new Date(iso);
  const rows = (list: Partial<Parameters<typeof summarize>[1][number]>[]) =>
    list.map((r, i) => ({ id: `r${i}`, kind: 'mike_estimate', session_external_id: `s${i}`, started_at: at('2026-11-10T14:00:00Z'), minutes: 30, agent_minutes: null, cost_usd: null, basis: null, time_entry_id: null, source: 'session', ...r }));
  const from = monthStart(NOW, 'America/New_York');

  it('month start is the first of the month in his zone', () => {
    expect(monthStart(NOW, 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
  it('sums unlogged estimate minutes, counts sessions and days, and suggests the unlogged amount', () => {
    const s = summarize('project:p', rows([{ minutes: 60 }, { minutes: 70, started_at: at('2026-11-11T14:00:00Z') }, { minutes: 20, time_entry_id: 'e1' }]), from, 'America/New_York');
    expect(s.mike).toMatchObject({ unlogged_minutes: 130, logged_minutes: 20, sessions: 3, days: 2, suggested: 130 });
    expect(s.mike?.line).toContain('Log it?');
    expect(s.bast).toBeNull();
  });
  it('all logged: no suggestion, no Log it', () => {
    const s = summarize('task:t', rows([{ minutes: 60, time_entry_id: 'e1' }]), from, 'America/New_York');
    expect(s.mike?.suggested).toBeNull();
    expect(s.mike?.line).not.toContain('Log it?');
  });
  it('Bast: minutes, agent minutes, dollars from costed rows only', () => {
    const s = summarize('task:t', rows([{ kind: 'bast_run', source: 'citadel-worker', minutes: 20, cost_usd: { toString: () => '3.4' } }, { kind: 'bast_run', minutes: 45, agent_minutes: 90 }]), from, 'America/New_York');
    expect(s.bast).toMatchObject({ minutes: 65, agent_minutes: 90, cost_usd: 3.4 });
    expect(s.bast?.line).toBe('Bast worked: 1 h 05 m, $3.40 on unattended runs.');
    expect(s.mike).toBeNull();
  });
});
