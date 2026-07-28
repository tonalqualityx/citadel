import { describe, it, expect } from 'vitest';
import { selectHeroPicks, heroSessionStatus, HERO_MAX } from '../hero-logic';
import type { TodayPick } from '@/lib/hooks/use-today';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';

function pick(overrides: Partial<TodayPick> = {}): TodayPick {
  return {
    id: 'pick-1',
    date: '2026-07-27',
    item_type: 'note',
    arc_id: null,
    arc: null,
    task_id: null,
    task: null,
    session_external_id: null,
    session: null,
    charter_id: null,
    charter: null,
    accord_id: null,
    accord: null,
    label: 'A pick',
    sort: 0,
    started_at: null,
    completed_at: null,
    calendar_event_id: null,
    primary_action: { kind: 'toggle' },
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<OracleSessionWithMachine> = {}): OracleSessionWithMachine {
  return {
    external_id: 'sess-1',
    title: 'A session',
    status: 'running',
    remote_url: null,
    goal: null,
    needs_attention: false,
    agents: [],
    machine: { name: 'demo', id: 'm1' } as never,
    ...overrides,
  } as OracleSessionWithMachine;
}

describe('HERO_MAX', () => {
  it('is 3', () => expect(HERO_MAX).toBe(3));
});

describe('selectHeroPicks', () => {
  it('never touches completed picks', () => {
    const picks = [pick({ id: 'done', completed_at: '2026-07-27T10:00:00.000Z' })];
    expect(selectHeroPicks(picks)).toHaveLength(0);
  });

  it('puts started (Doing) picks first, sorted by started_at', () => {
    const picks = [
      pick({ id: 'a', started_at: '2026-07-27T11:00:00.000Z', created_at: '2026-07-27T08:00:00.000Z' }),
      pick({ id: 'b', started_at: '2026-07-27T09:00:00.000Z', created_at: '2026-07-27T07:00:00.000Z' }),
      pick({ id: 'c', created_at: '2026-07-27T06:00:00.000Z' }),
    ];
    const result = selectHeroPicks(picks);
    expect(result.map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('fills remaining slots with earliest-created unstarted picks', () => {
    const picks = [
      pick({ id: 'a', created_at: '2026-07-27T09:00:00.000Z' }),
      pick({ id: 'b', created_at: '2026-07-27T08:00:00.000Z' }),
    ];
    expect(selectHeroPicks(picks).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('caps at max (default 3)', () => {
    const picks = Array.from({ length: 5 }, (_, i) => pick({ id: `p${i}`, created_at: `2026-07-27T0${i}:00:00.000Z` }));
    expect(selectHeroPicks(picks)).toHaveLength(3);
  });
});

describe('heroSessionStatus', () => {
  it('returns null for a task-type pick (no session ever attaches)', () => {
    expect(heroSessionStatus(pick({ item_type: 'task', task_id: 't1' }), [session()])).toBeNull();
  });

  it('matches a session-type pick by external_id', () => {
    const s = session({ external_id: 'sess-42', status: 'waiting', waiting_on: 'approve deploy?' });
    const p = pick({ item_type: 'session', session_external_id: 'sess-42' });
    const result = heroSessionStatus(p, [s]);
    expect(result?.status).toBe('needs_you');
    expect(result?.detail).toContain('approve deploy?');
  });

  it('matches an arc-type pick to the first session declared against that arc', () => {
    const s = session({ arc_id: 'arc-1', status: 'running' });
    const p = pick({ item_type: 'arc', arc_id: 'arc-1' });
    const result = heroSessionStatus(p, [s]);
    expect(result?.status).toBe('working');
  });

  it('returns null when no session matches', () => {
    const p = pick({ item_type: 'arc', arc_id: 'arc-nope' });
    expect(heroSessionStatus(p, [session({ arc_id: 'arc-other' })])).toBeNull();
  });

  it('a running/working session never fabricates "needs_you"', () => {
    const s = session({ external_id: 's1', status: 'running' });
    const p = pick({ item_type: 'session', session_external_id: 's1' });
    expect(heroSessionStatus(p, [s])?.status).toBe('working');
  });
});
