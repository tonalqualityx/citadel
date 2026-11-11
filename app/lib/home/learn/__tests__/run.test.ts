import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../store', () => ({ buildDailySnapshot: vi.fn(), loadWeekReads: vi.fn() }));

import { buildDailySnapshot, loadWeekReads } from '../store';
import { runLearn } from '../run';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const MONDAY = new Date('2026-11-23T15:00:00Z');
const TUESDAY = new Date('2026-11-24T15:00:00Z');

function fakeDb(opts: { onHome?: boolean; prior?: { finished_at: Date | null; started_at: Date } | null } = {}) {
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
    homeAction: { create: vi.fn(async (a: { data: { action: string; source: string; undo_until: unknown } }) => { calls.push(`action.${a.data.action}.${a.data.source}.${a.data.undo_until}`); return { id: `act-${calls.length}` }; }) },
    task: { update: rec('task.update', {}), updateMany: rec('task.updateMany', {}) },
    emailAsk: { update: rec('ask.update', {}), updateMany: rec('ask.updateMany', {}) },
    wait: { update: rec('wait.update', {}), updateMany: rec('wait.updateMany', {}) },
    project: { update: rec('project.update', {}), updateMany: rec('project.updateMany', {}) },
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
});
