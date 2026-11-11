/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
/**
 * closeAsksForTask against an in-memory stand-in for the few tables it touches. The real-database run of the same rules is
 * lib/work/__tests__/stage-a.integration.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { closeAsksForTask, closeAsksForTasks, undoWorkClose, readWorkCloseRecord } from '../ask-closure';

const OWNER = 'owner-1';
const NOW = new Date('2026-11-11T15:00:00Z');
let asks: any[];
let tasks: any[];
let actions: any[];
let holds: any[];
let owner: boolean;

function match(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((w: any) => match(row, w));
    const x = row[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(x);
      if ('lte' in v) return x.getTime() <= v.lte.getTime();
      if ('gt' in v) return x.getTime() > v.gt.getTime();
      if ('not' in v) return x !== v.not;
    }
    return x === v;
  });
}

function makeDb() {
  const db: any = {
    emailAsk: {
      findFirst: async ({ where }: any) => asks.find((a) => match(a, where)) ?? null,
      findMany: async ({ where }: any) => asks.filter((a) => match(a, where)),
      updateMany: async ({ where, data }: any) => {
        const rows = asks.filter((a) => match(a, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    task: { findMany: async ({ where }: any) => tasks.filter((t) => match(t, where)) },
    bastChatSettings: { findUnique: async () => (owner ? { owner_user_id: OWNER } : null) },
    user: { findUnique: async () => ({ is_active: true, role: 'admin', preferences: { home_view: 'home', timezone: 'America/New_York' } }) },
    homeReconcileHold: {
      findMany: async ({ where }: any) => holds.filter((h) => where.target_key.in.includes(h.target_key) && h.until.getTime() > where.until.gt.getTime()),
      findUnique: async ({ where }: any) => holds.find((h) => h.target_key === where.user_id_target_key.target_key) ?? null,
      upsert: async ({ create }: any) => { holds.push(create); return create; },
    },
    homeAction: { create: async ({ data }: any) => { const r = { id: `a${actions.length + 1}`, created_at: NOW, undone_at: null, ...data }; actions.push(r); return r; } },
  };
  return db;
}

const ask = (id: string, over: any = {}) => ({
  id, task_id: 't1', state: 'open', is_urgent: false, received_at: new Date('2026-11-02T15:00:00Z'), from_name: 'Jeffrey Knisely', from_email: 'j@x.test',
  subject: 'Website update', deep_link: `https://mail.google.com/${id}`, closed_at: null, closed_reason: null, closed_by: null, draft_started_at: new Date(), draft_url: 'u', ...over,
});

beforeEach(() => {
  asks = [ask('a1'), ask('a2')];
  tasks = [{ id: 't1', title: 'Add the blurb', tags: [], status: 'done', is_deleted: false }];
  actions = [];
  holds = [];
  owner = true;
});

describe('closeAsksForTask', () => {
  it('closes the open linked asks, writes one line with Undo for 72 hours, and records what it closed', async () => {
    const r = await closeAsksForTask(makeDb(), 't1', 'done', { now: NOW });
    expect(r.closed.sort()).toEqual(['a1', 'a2']);
    expect(asks.every((a) => a.state === 'handled' && a.closed_reason === 'task_done' && a.closed_by === 'task' && a.draft_url === null)).toBe(true);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ action: 'work_close', source: 'keeper', user_id: OWNER });
    expect(actions[0].after.line).toBe('Closed 2 emails from Jeffrey Knisely: done in "Add the blurb" (Nov 2).');
    expect(actions[0].undo_until.getTime() - NOW.getTime()).toBe(72 * 3600 * 1000);
    const rec = readWorkCloseRecord(actions[0].before)!;
    expect(rec.asks.map((a) => a.previous_state)).toEqual(['open', 'open']);
  });

  it('is idempotent: a second call closes nothing and writes no line', async () => {
    await closeAsksForTask(makeDb(), 't1', 'done', { now: NOW });
    const again = await closeAsksForTask(makeDb(), 't1', 'done', { now: NOW });
    expect(again.closed).toEqual([]);
    expect(actions).toHaveLength(1);
  });

  it('does nothing for a status that is not finished', async () => {
    tasks[0].status = 'review';
    expect((await closeAsksForTask(makeDb(), 't1', 'review', { now: NOW })).closed).toEqual([]);
    expect(asks.every((a) => a.state === 'open')).toBe(true);
  });

  it('never closes a security task\'s asks, an urgent ask, or one that arrived after the task finished', async () => {
    tasks[0].tags = ['security'];
    expect((await closeAsksForTask(makeDb(), 't1', 'done', { now: NOW })).held.security).toEqual(['t1']);
    expect(asks.every((a) => a.state === 'open')).toBe(true);
    tasks[0].tags = [];
    asks[0].is_urgent = true;
    asks[1].received_at = new Date('2026-11-12T00:00:00Z');
    const r = await closeAsksForTask(makeDb(), 't1', 'done', { now: NOW, finishedAt: NOW });
    expect(r.closed).toEqual([]);
  });

  it('compare-and-set: an ask Mike already handled is left as he left it', async () => {
    asks[0].state = 'dismissed';
    const r = await closeAsksForTask(makeDb(), 't1', 'done', { now: NOW });
    expect(r.closed).toEqual(['a2']);
    expect(asks[0].state).toBe('dismissed');
  });

  it('writes nothing when no home owner is on the home view', async () => {
    owner = false;
    const r = await closeAsksForTask(makeDb(), 't1', 'done', { now: NOW });
    expect(r.skipped).toBe('home_off');
    expect(asks.every((a) => a.state === 'open')).toBe(true);
    expect(actions).toHaveLength(0);
  });

  it('a batch writes one line per task that closed emails', async () => {
    tasks.push({ id: 't2', title: 'Other job', tags: [], status: 'done', is_deleted: false });
    asks.push(ask('b1', { task_id: 't2' }));
    const r = await closeAsksForTasks(makeDb(), ['t1', 't2'], 'done', { now: NOW });
    expect(r.closed).toHaveLength(3);
    expect(actions).toHaveLength(2);
  });
});

describe('undoWorkClose', () => {
  it('reopens exactly the asks it closed and holds the task 30 days so nothing closes them again', async () => {
    await closeAsksForTask(makeDb(), 't1', 'done', { now: NOW });
    asks[1].state = 'dismissed'; // Mike changed this one since
    const rec = readWorkCloseRecord(actions[0].before)!;
    const out = await undoWorkClose(makeDb(), OWNER, rec, NOW);
    expect(out.reopened).toEqual(['a1']);
    expect(asks[0]).toMatchObject({ state: 'open', closed_at: null, closed_reason: null, closed_by: null });
    expect(asks[1].state).toBe('dismissed');
    expect(holds).toHaveLength(1);
    expect(holds[0].until.getTime() - NOW.getTime()).toBe(30 * 24 * 3600 * 1000);
    // The hold keeps a second close away.
    const again = await closeAsksForTask(makeDb(), 't1', 'done', { now: new Date(NOW.getTime() + 3600_000) });
    expect(again.closed).toEqual([]);
    expect(again.held.undone).toEqual(['t1']);
    expect(asks[0].state).toBe('open');
  });
});
