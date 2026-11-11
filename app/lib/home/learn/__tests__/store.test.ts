import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { loadWeekReads } from '../store';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const TZ = 'America/New_York';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';
const PROJ = '44444444-4444-4444-8444-444444444444';
const d = (s: string) => new Date(s);

// Monday 2026-11-16 to Sunday 2026-11-22. EST is UTC-5.
function fake(over: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const tasks = [
    { id: T1, title: 'Rotate keys', tags: ['security'], created_at: d('2026-11-16T14:00:00Z'), status: 'in_progress', client: { name: 'Acme' }, project_id: PROJ, hard_due_at: null },
  ];
  const model = (name: string, rows: unknown) => ({
    findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) => (typeof rows === 'function' ? (rows as (a: unknown) => unknown)(args) : rows)),
    findUnique: vi.fn(async () => null),
    aggregate: vi.fn(async () => ({ _min: { created_at: d('2026-11-10T15:00:00Z') } })),
    create: vi.fn(async () => { writes.push(`${name}.create`); }),
    update: vi.fn(async () => { writes.push(`${name}.update`); }),
    updateMany: vi.fn(async () => { writes.push(`${name}.updateMany`); }),
    upsert: vi.fn(async () => { writes.push(`${name}.upsert`); }),
  });
  const db = {
    task: model('task', (a?: { where?: Record<string, unknown> }) => {
      const w = a?.where ?? {};
      if ('hard_due_at' in w) return [{ title: 'Renew domain', hard_due_at: d('2026-11-18T00:00:00Z'), completed_at: d('2026-11-18T20:00:00Z'), status: 'done' }, { title: 'File form', hard_due_at: d('2026-11-19T00:00:00Z'), completed_at: null, status: 'in_progress' }];
      if (w.id && (w.id as { in?: string[] }).in?.includes(T1) && 'project_id' !== undefined && !('assignee_id' in w)) return [{ id: T1, project_id: PROJ }, { id: T2, project_id: null }];
      return tasks;
    }),
    activityLog: model('activityLog', (a?: { where?: Record<string, unknown> }) => {
      const w = a?.where ?? {};
      if (w.entity_id) return [{ entity_id: T1, created_at: d('2026-11-16T15:00:00Z') }]; // first action 1 hour after (10:00 ET)
      return [
        { entity_id: T1, action: 'status_changed', changes: null, created_at: d('2026-11-17T15:00:00Z') },
        { entity_id: T2, action: 'updated', changes: { status: { from: 'a', to: 'b' } }, created_at: d('2026-11-18T15:00:00Z') },
        { entity_id: T2, action: 'updated', changes: { title: { from: 'a', to: 'b' } }, created_at: d('2026-11-18T16:00:00Z') },
      ];
    }),
    emailAsk: model('emailAsk', []),
    homeItemState: model('homeItemState', []),
    timeEntry: model('timeEntry', []),
    homeSiteIncident: model('homeSiteIncident', [{ site_id: SITE, domain: 'x.com', started_at: d('2026-11-17T14:00:00Z'), closed_at: d('2026-11-17T14:30:00Z'), close_reason: 'watchdog_closed' }]),
    wait: model('wait', []),
    homeAction: model('homeAction', [
      { item_key: `task:${T1}`, action: 'record', after: { recorded: { did: 'open_task', undo: false } }, created_at: d('2026-11-17T15:00:30Z') },
      { item_key: `review:${PROJ}`, action: 'record', after: { recorded: { did: 'approve_all', undo: false } }, created_at: d('2026-11-17T15:00:40Z') },
      { item_key: `review:${PROJ}x`, action: 'record', after: { recorded: { did: 'approve_all', undo: false } }, created_at: d('2026-11-17T15:00:42Z') },
    ]),
    homeMeasure: model('homeMeasure', [
      { date: d('2026-11-13T00:00:00Z'), value: { open_items: 90, past_day: 1, owed: [] } },
      { date: d('2026-11-16T00:00:00Z'), value: { open_items: 100, past_day: 3, owed: [{ key: 'thread:a:b', label: 'Quote', age_bd: 5 }] } },
    ]),
    homeDay: model('homeDay', [{ date: d('2026-11-17T00:00:00Z'), swapped_from_group: null, quick_item_keys: [`task:${T1}`], step_item_keys: [`task:${T2}`] }]),
    ...over,
  };
  return { db: db as unknown as PrismaClient, writes };
}

describe('loadWeekReads', () => {
  it('reads the week and never writes', async () => {
    const { db, writes } = fake();
    const r = await loadWeekReads(db, OWNER, TZ, '2026-11-16', '2026-11-22');
    expect(writes).toEqual([]);
    expect(r.week_start).toBe('2026-11-16');
  });

  it('a security task created in the week is an emergency with its first action', async () => {
    const { db } = fake();
    const r = await loadWeekReads(db, OWNER, TZ, '2026-11-16', '2026-11-22');
    const t = r.emergencies.find((e) => e.kind === 'task');
    expect(t?.key).toBe(`task:${T1}`);
    expect(t?.first_action_at?.toISOString()).toBe('2026-11-16T15:00:00.000Z');
    expect(t?.label).toBe('Acme: Rotate keys');
  });

  it('a site incident that closed with no tap of his is cleared on its own', async () => {
    const { db } = fake();
    const r = await loadWeekReads(db, OWNER, TZ, '2026-11-16', '2026-11-22');
    const s = r.emergencies.find((e) => e.kind === 'site');
    expect(s?.cleared_on_own).toBe(true);
    expect(s?.label).toBe('x.com down');
  });

  it('task changes are distinct tasks; here means a tap within 2 minutes on the task or its review fold', async () => {
    const { db } = fake();
    const r = await loadWeekReads(db, OWNER, TZ, '2026-11-16', '2026-11-22');
    const byId = Object.fromEntries(r.task_changes.map((c) => [c.task_id, c.here]));
    expect(byId).toEqual({ [T1]: true, [T2]: false });
  });

  it('hard dates: done by the end of a date-only day is met, open is missed', async () => {
    const { db } = fake();
    const r = await loadWeekReads(db, OWNER, TZ, '2026-11-16', '2026-11-22');
    expect(r.hard_dates).toEqual([{ label: 'Renew domain', met: true }, { label: 'File form', met: false }]);
  });

  it('snapshots split into the week and the last weekday before it; his first tap sets the log start', async () => {
    const { db } = fake();
    const r = await loadWeekReads(db, OWNER, TZ, '2026-11-16', '2026-11-22');
    expect(r.snapshots.map((s) => s.date)).toEqual(['2026-11-16']);
    expect(r.prev_snapshot?.open_items).toBe(90);
    expect(r.first_action_day).toBe('2026-11-10');
    expect(r.snapshots[0].owed[0].age_bd).toBe(5);
  });

  it('guard rows are first taps on sign-offs and waits only, with the gap to the tap before', async () => {
    const { db } = fake();
    const r = await loadWeekReads(db, OWNER, TZ, '2026-11-16', '2026-11-22');
    expect(r.guard_rows.map((g) => [g.item_key, g.did, g.gap_ms])).toEqual([
      [`review:${PROJ}`, 'approve_all', 10_000],
      [`review:${PROJ}x`, 'approve_all', 2_000],
    ]);
  });

  it('today days count the kept day and the steps done by its end', async () => {
    const { db } = fake();
    const r = await loadWeekReads(db, OWNER, TZ, '2026-11-16', '2026-11-22');
    expect(r.today_days).toEqual([{ date: '2026-11-17', kept: true, proposed: 2, done: 0 }]);
  });
});
