import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../store', () => ({ buildDailySnapshot: vi.fn(), loadWeekReads: vi.fn(), writeGuesses: vi.fn() }));

import { buildDailySnapshot, loadWeekReads, writeGuesses } from '../store';
import { runLearn } from '../run';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const MONDAY = new Date('2026-11-23T15:00:00Z');
const TUESDAY = new Date('2026-11-24T15:00:00Z');

const CLIENT_X = 'c0000000-0000-4000-8000-00000000000a';
const T1 = 'a0000000-0000-4000-8000-000000000001';
const T2 = 'a0000000-0000-4000-8000-000000000002';
const T3 = 'a0000000-0000-4000-8000-000000000003';
const tap = (action: string, taskId: string, iso: string) => ({ item_key: `task:${taskId}`, action, after: {}, undone_at: null, created_at: new Date(iso) });
/** Five up taps on three tasks of client X over three days, the oldest 20 days before the Monday. */
const XTAPS = [
  tap('matters_more', T1, '2026-11-17T15:00:00Z'),
  tap('bring_forward', T2, '2026-11-18T15:00:00Z'),
  tap('matters_more', T3, '2026-11-19T15:00:00Z'),
];

function fakeDb(opts: { onHome?: boolean; prior?: { finished_at: Date | null; started_at: Date } | null; learnOff?: boolean; taps?: unknown[]; firstTapAt?: Date | null; weights?: unknown[] } = {}) {
  const calls: string[] = [];
  const rec = (name: string, ret: unknown) => vi.fn(async (...a: unknown[]) => { calls.push(name); void a; return ret; });
  const db = {
    user: { findUnique: vi.fn(async () => ({ is_active: true, role: 'admin', preferences: { home_view: opts.onHome === false ? 'classic' : 'home', timezone: 'America/New_York' } })) },
    homeKeeperRun: {
      findUnique: vi.fn(async () => opts.prior ?? null),
      createMany: rec('run.create', { count: 1 }),
      updateMany: rec('run.take', { count: 1 }),
      update: rec('run.update', {}),
    },
    homeMeasure: { upsert: vi.fn(async (a: { create: { kind: string } }) => { calls.push(`measure.${a.create.kind}`); return {}; }) },
    homeAction: {
      create: vi.fn(async (a: { data: { action: string; source: string; undo_until: unknown } }) => { calls.push(`action.${a.data.action}.${a.data.source}.${a.data.undo_until}`); return { id: `act-${calls.length}` }; }),
      findFirst: vi.fn(async () => (opts.firstTapAt === null ? null : { created_at: opts.firstTapAt ?? new Date('2026-11-01T15:00:00Z') })),
      findMany: vi.fn(async () => opts.taps ?? []),
      count: vi.fn(async () => 0), // work stage B: the weekly reopen count
    },
    homeKeeperSettings: { findUnique: vi.fn(async () => (opts.learnOff ? { learn_weights: false } : null)) },
    homeScoreWeight: {
      findMany: vi.fn(async () => opts.weights ?? []),
      upsert: vi.fn(async (a: { create: { evidence_key: string; weight_pct: number } }) => { calls.push(`weight.${a.create.evidence_key}.${a.create.weight_pct}`); return {}; }),
    },
    client: { findMany: vi.fn(async () => [{ id: CLIENT_X, name: 'Nerd Herd' }]) },
    sop: { findMany: vi.fn(async () => []) },
    task: {
      update: rec('task.update', {}),
      updateMany: rec('task.updateMany', {}),
      findMany: vi.fn(async () => [T1, T2, T3].map((id) => ({ id, client_id: CLIENT_X, project_id: null, sop_id: null, tags: [] }))),
    },
    // Work stage D: the measures line counts what the guard keeps off his list (nothing here)
    emailAsk: { update: rec('ask.update', {}), updateMany: rec('ask.updateMany', {}), count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    oracleSession: { findMany: vi.fn(async () => []) },
    wait: { update: rec('wait.update', {}), updateMany: rec('wait.updateMany', {}) },
    project: { update: rec('project.update', {}), updateMany: rec('project.updateMany', {}), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { db: db as unknown as PrismaClient, calls, raw: db };
}

const week = (n: number) => ({
  emergencies: [],
  snapshots: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].slice(0, n).map((date) => ({ date, open_items: 20, past_day: 2, owed: [] })),
  prev_snapshot: null,
  task_changes: [],
  first_action_day: '2026-11-10',
  hard_dates: [],
  today_days: [],
  guard_rows: [] as { item_key: string; did: string; gap_ms: number | null }[],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildDailySnapshot).mockImplementation(async (_db, _o, _n, _tz, date) => ({ date, open_items: 20, past_day: 2, owed: [] }));
  vi.mocked(loadWeekReads).mockImplementation(async (_db, _o, _tz, start, end) => ({ week_start: start, week_end: end, ...week(5) }));
  vi.mocked(writeGuesses).mockResolvedValue({ considered: 3, written: 3, history: 1, energy: 0, kind: 2 });
});

describe('runLearn', () => {
  it('skips when the owner is not on the home view', async () => {
    const { db, calls } = fakeDb({ onHome: false });
    expect(await runLearn(db, OWNER, MONDAY, { dryRun: false })).toEqual({ dry_run: false, skipped: 'home_off', action_ids: [] });
    expect(calls).toEqual([]);
    expect(buildDailySnapshot).not.toHaveBeenCalled();
  });

  it('a dry run writes nothing at all', async () => {
    const { db, calls, raw } = fakeDb();
    const res = await runLearn(db, OWNER, MONDAY, { dryRun: true });
    expect(res.dry_run).toBe(true);
    expect(res.monday).toBe(true);
    expect(res.lines?.[0].action).toBe('keeper_measures');
    expect(calls).toEqual([]);
    expect(raw.$transaction).not.toHaveBeenCalled();
  });

  it('a Tuesday run writes the daily snapshot only and no line', async () => {
    const { db, calls } = fakeDb();
    const res = await runLearn(db, OWNER, TUESDAY, { dryRun: false });
    expect(res.monday).toBe(false);
    expect(res.week).toBeNull();
    expect(res.lines).toEqual([]);
    expect(calls).toEqual(['run.create', 'measure.daily', 'run.update']);
    expect(loadWeekReads).not.toHaveBeenCalled();
  });

  it('a Monday run writes the daily and week rows and one line, no Undo, source keeper, nothing else', async () => {
    const { db, calls } = fakeDb();
    const res = await runLearn(db, OWNER, MONDAY, { dryRun: false });
    expect(res.lines).toHaveLength(1);
    expect(res.lines?.[0].line).toMatch(/^Last week: /);
    expect(calls).toEqual(['run.create', 'measure.daily', 'measure.week', 'action.keeper_measures.keeper.null', 'run.update']);
    expect(res.action_ids).toHaveLength(1);
    expect(calls.some((c) => /^(task|ask|wait|project)\./.test(c))).toBe(false);
  });

  it('a Monday with too little data writes the week row but no line', async () => {
    vi.mocked(loadWeekReads).mockImplementation(async (_db, _o, _tz, start, end) => ({ week_start: start, week_end: end, ...week(4), first_action_day: '2026-11-19' }));
    const { db, calls } = fakeDb();
    const res = await runLearn(db, OWNER, MONDAY, { dryRun: false });
    expect(res.lines).toEqual([]);
    expect(calls).toEqual(['run.create', 'measure.daily', 'measure.week', 'run.update']);
  });

  it('the guard line is written as keeper_guard when it fires', async () => {
    vi.mocked(loadWeekReads).mockImplementation(async (_db, _o, _tz, start, end) => ({
      week_start: start,
      week_end: end,
      ...week(5),
      guard_rows: Array.from({ length: 24 }, (_, i) => ({ item_key: `review:${i}`, did: i < 23 ? 'approve_all' : 'let_it_go', gap_ms: 3000 })),
    }));
    const { db, calls } = fakeDb();
    const res = await runLearn(db, OWNER, MONDAY, { dryRun: false });
    expect(res.lines?.map((l) => l.action)).toEqual(['keeper_measures', 'keeper_guard']);
    expect(res.lines?.[1].line).toContain('23 of 24');
    expect(calls).toContain('action.keeper_guard.keeper.null');
  });

  it('a second run the same day answers already_ran and writes nothing', async () => {
    const { db, calls } = fakeDb({ prior: { finished_at: new Date('2026-11-23T10:00:00Z'), started_at: new Date('2026-11-23T10:00:00Z') } });
    expect(await runLearn(db, OWNER, MONDAY, { dryRun: false })).toEqual({ dry_run: false, already_ran: true, action_ids: [] });
    expect(calls).toEqual([]);
    expect(buildDailySnapshot).not.toHaveBeenCalled();
  });

  it('every line it writes is clean text', async () => {
    const { db } = fakeDb();
    const res = await runLearn(db, OWNER, MONDAY, { dryRun: true });
    for (const l of res.lines ?? []) expect(l.line).not.toMatch(/[–—]|priorit|overdue/i);
  });

  describe('Slice 7b: the Monday weight step', () => {
    it('five taps on three of one client\'s tasks over three days, with 20 days of history, shift that client up by one step: one Learned line with Undo, one weight row', async () => {
      const { db, calls } = fakeDb({ taps: XTAPS, firstTapAt: new Date('2026-11-03T15:00:00Z') });
      const res = await runLearn(db, OWNER, MONDAY, { dryRun: false });
      expect(res.learned?.map((l) => [l.evidence_key, l.dir, l.line])).toEqual(
        expect.arrayContaining([[`client:${CLIENT_X}`, 'up', 'Learned: Nerd Herd work now comes up a little sooner.']]),
      );
      expect(calls.some((c) => /^action\.keeper_learned\.keeper\.\w/.test(c) && !c.endsWith('.null'))).toBe(true);
      expect(calls).toContain(`weight.client:${CLIENT_X}.105`);
      // Never more than three shifts, and no write outside the owner's own home rows.
      expect(calls.filter((c) => c.startsWith('weight.'))).toEqual([`weight.client:${CLIENT_X}.105`]);
      expect(res.learned).toHaveLength(1);
      expect(calls.some((c) => /^(task|ask|wait|project)\./.test(c))).toBe(false);
    });

    it('a Tuesday run never shifts, whatever the taps', async () => {
      const { db, calls } = fakeDb({ taps: XTAPS });
      const res = await runLearn(db, OWNER, TUESDAY, { dryRun: false });
      expect(res.learned ?? []).toEqual([]);
      expect(calls.some((c) => c.startsWith('weight.'))).toBe(false);
    });

    it('with Learn from my taps off, nothing shifts', async () => {
      const { db, calls } = fakeDb({ taps: XTAPS, learnOff: true });
      const res = await runLearn(db, OWNER, MONDAY, { dryRun: false });
      expect(res.learned).toEqual([]);
      expect(calls.some((c) => c.startsWith('weight.') || c.includes('keeper_learned'))).toBe(false);
    });

    it('under 14 days of history nothing shifts', async () => {
      const { db, calls } = fakeDb({ taps: XTAPS, firstTapAt: new Date('2026-11-12T15:00:00Z') });
      const res = await runLearn(db, OWNER, MONDAY, { dryRun: false });
      expect(res.learned).toEqual([]);
      expect(calls.some((c) => c.startsWith('weight.'))).toBe(false);
    });

    it('a held key does not shift', async () => {
      const { db, calls } = fakeDb({ taps: XTAPS });
      (db as unknown as { homeScoreWeight: { findMany: unknown } }).homeScoreWeight.findMany = vi.fn(async () => [
        { evidence_key: `client:${CLIENT_X}`, weight_pct: 100, held_until: new Date('2026-12-10T00:00:00Z') },
      ]);
      const res = await runLearn(db, OWNER, MONDAY, { dryRun: false });
      expect(res.learned).toEqual([]);
      expect(calls.some((c) => c.startsWith('weight.'))).toBe(false);
    });

    it('a dry run lists the would-learn lines and writes nothing', async () => {
      const { db, calls, raw } = fakeDb({ taps: XTAPS });
      const res = await runLearn(db, OWNER, MONDAY, { dryRun: true });
      expect(res.lines?.some((l) => l.action === 'keeper_learned')).toBe(true);
      expect(calls).toEqual([]);
      expect(raw.$transaction).not.toHaveBeenCalled();
    });

    it('the Learned line is clean text', async () => {
      const { db } = fakeDb({ taps: XTAPS });
      const res = await runLearn(db, OWNER, MONDAY, { dryRun: true });
      for (const l of res.lines ?? []) {
        expect(l.line).not.toMatch(/[–—]|priorit|overdue/i);
        for (const x of l.details) expect(x).not.toMatch(/[–—]|priorit|overdue/i);
      }
    });
  });

  describe('Slice 7c: the guess step', () => {
    it('runs after the others and reports its counts', async () => {
      const { db } = fakeDb();
      const res = await runLearn(db, OWNER, TUESDAY, { dryRun: false });
      expect(writeGuesses).toHaveBeenCalledTimes(1);
      expect(res.guesses).toEqual({ considered: 3, written: 3, history: 1, energy: 0, kind: 2 });
    });

    it('its failure does not fail the others', async () => {
      vi.mocked(writeGuesses).mockRejectedValue(new Error('boom'));
      const { db, calls } = fakeDb();
      const res = await runLearn(db, OWNER, TUESDAY, { dryRun: false });
      expect(res.guesses).toEqual({ error: 'boom' });
      expect(calls).toContain('measure.daily');
      expect(res.daily).toBeTruthy();
    });

    it('a dry run and an already-ran night write no guesses', async () => {
      const a = fakeDb();
      await runLearn(a.db, OWNER, TUESDAY, { dryRun: true });
      const b = fakeDb({ prior: { finished_at: new Date('2026-11-24T05:00:00Z'), started_at: new Date('2026-11-24T05:00:00Z') } });
      const res = await runLearn(b.db, OWNER, TUESDAY, { dryRun: false });
      expect(res.already_ran).toBe(true);
      expect(writeGuesses).not.toHaveBeenCalled();
    });
  });
});
