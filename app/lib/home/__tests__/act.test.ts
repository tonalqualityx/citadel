import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../load', () => ({
  loadHomeInputs: vi.fn(async () => ({ calendar_events: [] })),
}));
vi.mock('../select', () => ({
  selectHome: vi.fn(() => ({ sel: true })),
}));
vi.mock('../today', () => ({
  dayForGroup: vi.fn(),
}));

import { dayForGroup } from '../today';
import {
  HomeActError,
  homeActSchema,
  nextBusinessDayMorning,
  PIN_CONFLICT_TEXT,
  planAct,
  runHomeAct,
  runHomeUndo,
  zonedDateString,
} from '../act';
import type { HomeActRequest } from '../types';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const T1 = 'task:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'task:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T3 = 'task:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const G = 'arc:dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const G2 = 'client:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DATE = '2026-11-10';
// Tuesday 2026-11-10 10:00 New York
const NOW = new Date('2026-11-10T15:00:00.000Z');
const TZ = 'America/New_York';
const OPTS = { now: NOW, timezone: TZ, date: DATE };

type Row = Record<string, unknown>;

/** An in-memory stand-in for the three home tables, plus guarded shared models. */
function makeDb() {
  const states: Row[] = [];
  const days: Row[] = [];
  const actions: Row[] = [];
  let seq = 0;
  const stateDefaults = {
    park_count: 0,
    view_at: null,
    boosted_at: null,
    not_emergency_at: null,
    working_since: null,
    left_off_note: null,
    arc_added_at: null,
    arc_added_group: null,
    arc_removed_at: null,
    arc_removed_group: null,
    view_set_by: null,
    keeper_hold_until: null,
    read_hard_due_at: null,
    read_hard_due_source: null,
    dates_read_at: null,
    card_summary: null,
    card_checklist: null,
    card_summary_hash: null,
    card_summary_at: null,
    first_seen_at: new Date('2026-11-01T00:00:00Z'),
    last_shown_at: null,
  };
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date) && 'not' in (v as Row)) return row[k] !== (v as Row).not;
      if (v instanceof Date) return (row[k] as Date | null)?.getTime() === v.getTime();
      return row[k] === v;
    });
  const shared = () => ({
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  });
  const db = {
    states,
    days,
    actions,
    task: shared(),
    arc: shared(),
    wait: shared(),
    emailAsk: shared(),
    homeItemState: {
      findMany: vi.fn(async ({ where }: { where: Row }) => states.filter((r) => matches(r, where)).map((r) => ({ ...r }))),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const r = states.find((x) => matches(x, where));
        return r ? { ...r } : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { user_id_item_key: Row }; create: Row; update: Row }) => {
        const key = where.user_id_item_key;
        const found = states.find((r) => r.user_id === key.user_id && r.item_key === key.item_key);
        if (found) {
          Object.assign(found, update);
          return { ...found };
        }
        const row = { ...stateDefaults, ...create };
        states.push(row);
        return { ...row };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const keep = states.filter((r) => !matches(r, where));
        const count = states.length - keep.length;
        states.splice(0, states.length, ...keep);
        return { count };
      }),
    },
    homeDay: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const r = days.find((x) => matches(x, where));
        return r ? { ...r, step_item_keys: [...(r.step_item_keys as string[])], quick_item_keys: [...(r.quick_item_keys as string[])] } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const found = days.filter((r) => matches(r, where));
        found.forEach((r) => Object.assign(r, data));
        return { count: found.length };
      }),
    },
    homeAction: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        seq += 1;
        const row = {
          id: `action-${seq}`,
          before: null,
          after: null,
          undo_until: null,
          undone_at: null,
          source: 'home',
          created_at: new Date(),
          ...JSON.parse(JSON.stringify(data)),
        };
        if (data.undo_until) row.undo_until = data.undo_until;
        actions.push(row);
        return { ...row };
      }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const r = actions.find((a) => matches(a, where));
        return r ? { ...r } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const found = actions.filter((a) => a.user_id === where.user_id && a.id === where.id && a.undone_at === null);
        found.forEach((a) => Object.assign(a, data));
        return { count: found.length };
      }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  return db;
}
type Db = ReturnType<typeof makeDb>;
const asPrisma = (db: Db) => db as unknown as PrismaClient;

function addDay(db: Db, over: Row = {}) {
  const row = {
    id: 'day-1',
    user_id: U,
    date: new Date(`${DATE}T00:00:00.000Z`),
    group_key: G,
    group_label: 'Grok',
    arc_id: null,
    quick_item_keys: [] as string[],
    step_item_keys: [T1, T2],
    sized_minutes: 60,
    proposed_at: NOW,
    started_at: null,
    swapped_from_group: null,
    lighter_at: null,
    ...over,
  };
  db.days.push(row);
  return row;
}

function addState(db: Db, key: string, over: Row = {}) {
  const row = {
    user_id: U,
    item_key: key,
    park_count: 0,
    view_at: null,
    boosted_at: null,
    not_emergency_at: null,
    working_since: null,
    left_off_note: null,
    arc_added_at: null,
    arc_added_group: null,
    arc_removed_at: null,
    arc_removed_group: null,
    view_set_by: null,
    keeper_hold_until: null,
    read_hard_due_at: null,
    read_hard_due_source: null,
    dates_read_at: null,
    card_summary: null,
    card_checklist: null,
    card_summary_hash: null,
    card_summary_at: null,
    first_seen_at: new Date('2026-11-01T00:00:00Z'),
    last_shown_at: null,
    ...over,
  };
  db.states.push(row);
  return row;
}

const act = (db: Db, req: HomeActRequest, opts = OPTS) => runHomeAct(asPrisma(db), U, req, opts);
const undo = (db: Db, id: string, now = NOW) => runHomeUndo(asPrisma(db), U, id, now);
const stateOf = (db: Db, key: string) => db.states.find((r) => r.item_key === key);

function expectSharedUntouched(db: Db) {
  for (const model of [db.task, db.arc, db.wait, db.emailAsk]) {
    for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.mocked(dayForGroup).mockReset();
});

describe('time helpers', () => {
  it('gives the date on his wall clock', () => {
    expect(zonedDateString(new Date('2026-11-10T03:30:00Z'), TZ)).toBe('2026-11-09');
    expect(zonedDateString(new Date('2026-11-10T15:00:00Z'), TZ)).toBe('2026-11-10');
  });

  it('next business day is tomorrow at 9:00 on a weekday', () => {
    const r = nextBusinessDayMorning(NOW, TZ);
    expect(r.daysAhead).toBe(1);
    expect(r.at.toISOString()).toBe('2026-11-11T14:00:00.000Z');
  });

  it('skips the weekend and handles the DST change', () => {
    // Friday 2026-11-06 14:00 NY, EST, so Monday 9:00 = 14:00Z
    const fri = nextBusinessDayMorning(new Date('2026-11-06T19:00:00Z'), TZ);
    expect(fri.weekday).toBe('Monday');
    expect(fri.at.toISOString()).toBe('2026-11-09T14:00:00.000Z');
    // Friday 2026-03-06 (before DST on 03-08): Monday 03-09 is EDT, 9:00 = 13:00Z
    const dst = nextBusinessDayMorning(new Date('2026-03-06T19:00:00Z'), TZ);
    expect(dst.at.toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });
});

describe('request schema', () => {
  it('rejects a field that names a user', () => {
    expect(homeActSchema.safeParse({ action: 'not_now', item_key: T1, user_id: OTHER }).success).toBe(false);
  });
  it('rejects a bad item key and a long note', () => {
    expect(homeActSchema.safeParse({ action: 'not_now', item_key: 'nope' }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'stop', item_key: T1, note: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('accepts a valid body', () => {
    expect(homeActSchema.safeParse({ action: 'pin', item_key: T1, switch: true }).success).toBe(true);
  });
});

describe('not_now', () => {
  it('first tap: back the next business day at 9:00, then undo removes the row it created', async () => {
    const db = makeDb();
    const res = await act(db, { action: 'not_now', item_key: T1 });
    expect(res.message).toBe('Back tomorrow at 9:00.');
    expect(res.undo_until).toBe(new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString());
    const s = stateOf(db, T1)!;
    expect(s.park_count).toBe(1);
    expect(s.view_set_by).toBe('user');
    expect((s.view_at as Date).toISOString()).toBe('2026-11-11T14:00:00.000Z');
    await undo(db, res.action_id);
    expect(stateOf(db, T1)).toBeUndefined();
    expectSharedUntouched(db);
  });

  it('second tap: back in 7 days; undo restores the first park', async () => {
    const db = makeDb();
    const first = new Date('2026-11-11T14:00:00.000Z');
    addState(db, T1, { park_count: 1, view_at: first });
    const res = await act(db, { action: 'not_now', item_key: T1 });
    expect(res.message).toBe('Back in 7 days.');
    const s = stateOf(db, T1)!;
    expect(s.park_count).toBe(2);
    expect((s.view_at as Date).getTime()).toBe(NOW.getTime() + 7 * 24 * 3600 * 1000);
    await undo(db, res.action_id);
    expect(stateOf(db, T1)!.park_count).toBe(1);
    expect((stateOf(db, T1)!.view_at as Date).getTime()).toBe(first.getTime());
  });

  it('third tap: stays in view with choices only', async () => {
    const db = makeDb();
    addState(db, T1, { park_count: 2, view_at: new Date('2026-11-17T15:00:00Z') });
    const res = await act(db, { action: 'not_now', item_key: T1 });
    expect(stateOf(db, T1)!.park_count).toBe(3);
    expect(stateOf(db, T1)!.view_at).toBeNull();
    expect(res.message).toBe('It stays here. Pick what to do with it.');
    const again = await act(db, { action: 'not_now', item_key: T1 });
    expect(again.ok).toBe(true);
    expect(stateOf(db, T1)!.park_count).toBe(3);
  });
});

describe('bring_forward', () => {
  it('boosts, clears the date and who set it, answers the message, and undo puts the keeper date back', async () => {
    const db = makeDb();
    const keeperDay = new Date('2026-11-12T05:05:00.000Z');
    addState(db, T1, { view_at: keeperDay, view_set_by: 'keeper' });
    const res = await act(db, { action: 'bring_forward', item_key: T1 });
    expect(res.message).toBe('Moved to the front of Next.');
    const s = stateOf(db, T1)!;
    expect((s.boosted_at as Date).getTime()).toBe(NOW.getTime());
    expect(s.view_at).toBeNull();
    expect(s.view_set_by).toBeNull();
    expect(db.actions[0].before).toEqual({
      states: [{ item_key: T1, existed: true, fields: { boosted_at: null, view_at: keeperDay.toISOString(), view_set_by: 'keeper' } }],
    });
    await undo(db, res.action_id);
    const back = stateOf(db, T1)!;
    expect(back.boosted_at).toBeNull();
    expect((back.view_at as Date).getTime()).toBe(keeperDay.getTime());
    expect(back.view_set_by).toBe('keeper');
  });

  it('is in the request schema and strict', () => {
    expect(homeActSchema.safeParse({ action: 'bring_forward', item_key: T1 }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'bring_forward', item_key: T1, user_id: OTHER }).success).toBe(false);
  });
});

describe('keeper undo (compare-and-set)', () => {
  const DAY1 = new Date('2026-11-12T05:05:00.000Z');
  const NOW_K = new Date('2026-11-10T04:00:00.000Z');

  function keeperRow(db: Db, items: { key: string; before: Row; after: Row; existed?: boolean }[], over: Row = {}) {
    db.actions.push({
      id: 'k-1',
      user_id: U,
      item_key: null,
      action: 'keeper_stagger',
      before: { states: items.map((i) => ({ item_key: i.key, existed: i.existed ?? true, fields: i.before })) },
      after: { states: items.map((i) => ({ item_key: i.key, fields: i.after })), line: 'x', details: [] },
      undo_until: new Date(NOW_K.getTime() + 72 * 3600 * 1000),
      undone_at: null,
      source: 'keeper',
      created_at: NOW_K,
      ...over,
    });
  }

  it('puts back an unchanged field, skips one Mike changed, sets a 30 day hold on both, leaves markers alone', async () => {
    const db = makeDb();
    addState(db, T1, { view_at: DAY1, view_set_by: 'keeper' });
    const mikeDay = new Date('2026-11-20T14:00:00.000Z');
    addState(db, T2, { view_at: mikeDay, view_set_by: 'user', park_count: 1, dates_read_at: NOW_K });
    keeperRow(db, [
      { key: T1, before: { view_at: null, view_set_by: null }, after: { view_at: DAY1.toISOString(), view_set_by: 'keeper' } },
      { key: T2, before: { view_at: null, view_set_by: null }, after: { view_at: DAY1.toISOString(), view_set_by: 'keeper' } },
    ]);
    const res = await undo(db, 'k-1', NOW_K);
    expect(res.ok).toBe(true);
    const a = stateOf(db, T1)!;
    expect(a.view_at).toBeNull();
    expect(a.view_set_by).toBeNull();
    const b = stateOf(db, T2)!;
    expect((b.view_at as Date).getTime()).toBe(mikeDay.getTime());
    expect(b.view_set_by).toBe('user');
    expect(b.dates_read_at).toEqual(NOW_K);
    const hold = NOW_K.getTime() + 30 * 24 * 3600 * 1000;
    expect((a.keeper_hold_until as Date).getTime()).toBe(hold);
    expect((b.keeper_hold_until as Date).getTime()).toBe(hold);
    expect(db.actions[0].undone_at).toEqual(NOW_K);
    expectSharedUntouched(db);
  });

  it('reverts a date reading, never the dates_read_at marker', async () => {
    const db = makeDb();
    const due = new Date('2026-11-25T00:00:00.000Z');
    addState(db, T1, { read_hard_due_at: due, read_hard_due_source: 'date from the task, source unclear', dates_read_at: NOW_K });
    keeperRow(db, [
      {
        key: T1,
        before: { read_hard_due_at: null, read_hard_due_source: null, dates_read_at: null },
        after: { read_hard_due_at: due.toISOString(), read_hard_due_source: 'date from the task, source unclear', dates_read_at: NOW_K.toISOString() },
      },
    ], { action: 'keeper_dates' });
    await undo(db, 'k-1', NOW_K);
    const s = stateOf(db, T1)!;
    expect(s.read_hard_due_at).toBeNull();
    expect(s.read_hard_due_source).toBeNull();
    expect(s.dates_read_at).toEqual(NOW_K);
    expect(s.keeper_hold_until).not.toBeNull();
  });

  it('keeps the row (with its hold) when the keeper created it, and refuses after 72 hours', async () => {
    const db = makeDb();
    addState(db, T1, { view_at: DAY1, view_set_by: 'keeper' });
    keeperRow(db, [{ key: T1, existed: false, before: { view_at: null, view_set_by: null }, after: { view_at: DAY1.toISOString(), view_set_by: 'keeper' } }]);
    await expect(undo(db, 'k-1', new Date(NOW_K.getTime() + 73 * 3600 * 1000))).rejects.toMatchObject({ code: 'undo_expired' });
    await undo(db, 'k-1', new Date(NOW_K.getTime() + 71 * 3600 * 1000));
    expect(stateOf(db, T1)).toBeDefined();
    expect(stateOf(db, T1)!.view_at).toBeNull();
    expect(stateOf(db, T1)!.keeper_hold_until).not.toBeNull();
    await expect(undo(db, 'k-1', NOW_K)).rejects.toMatchObject({ code: 'undo_used' });
  });
});

describe('matters_more and not_emergency', () => {
  it('matters_more sets boosted_at and undoes', async () => {
    const db = makeDb();
    const res = await act(db, { action: 'matters_more', item_key: T1 });
    expect((stateOf(db, T1)!.boosted_at as Date).getTime()).toBe(NOW.getTime());
    await undo(db, res.action_id);
    expect(stateOf(db, T1)).toBeUndefined();
  });

  it('not_emergency sets not_emergency_at and undoes without touching a later boost', async () => {
    const db = makeDb();
    const res = await act(db, { action: 'not_emergency', item_key: T1 });
    expect((stateOf(db, T1)!.not_emergency_at as Date).getTime()).toBe(NOW.getTime());
    await act(db, { action: 'matters_more', item_key: T1 });
    await undo(db, res.action_id);
    expect(stateOf(db, T1)!.not_emergency_at).toBeNull();
    expect(stateOf(db, T1)!.boosted_at).not.toBeNull();
  });
});

describe('pin', () => {
  it('pins when nothing else is pinned', async () => {
    const db = makeDb();
    const res = await act(db, { action: 'pin', item_key: T1 });
    expect(res.message).toBe('Working on this now.');
    expect((stateOf(db, T1)!.working_since as Date).getTime()).toBe(NOW.getTime());
  });

  it('refuses a second pin with the exact sentence and code, and writes nothing', async () => {
    const db = makeDb();
    addState(db, T2, { working_since: new Date('2026-11-10T14:00:00Z') });
    const writes = db.homeAction.create.mock.calls.length;
    await expect(act(db, { action: 'pin', item_key: T1 })).rejects.toMatchObject({
      message: 'Switch to this one? The other goes back to its place.',
      code: 'pin_conflict',
      statusCode: 409,
    });
    expect(PIN_CONFLICT_TEXT).toBe('Switch to this one? The other goes back to its place.');
    expect(stateOf(db, T1)).toBeUndefined();
    expect(db.homeAction.create.mock.calls.length).toBe(writes);
  });

  it('switch moves the pin and undo puts the other back', async () => {
    const db = makeDb();
    const was = new Date('2026-11-10T14:00:00Z');
    addState(db, T2, { working_since: was });
    const res = await act(db, { action: 'pin', item_key: T1, switch: true });
    expect(stateOf(db, T2)!.working_since).toBeNull();
    expect(stateOf(db, T1)!.working_since).not.toBeNull();
    await undo(db, res.action_id);
    expect((stateOf(db, T2)!.working_since as Date).getTime()).toBe(was.getTime());
    expect(stateOf(db, T1)).toBeUndefined();
  });

  it('pinning the item already pinned is not a conflict', async () => {
    const db = makeDb();
    const was = new Date('2026-11-10T14:00:00Z');
    addState(db, T1, { working_since: was });
    await act(db, { action: 'pin', item_key: T1 });
    expect((stateOf(db, T1)!.working_since as Date).getTime()).toBe(was.getTime());
  });
});

describe('stop and done_pin', () => {
  it('stop clears the pin and keeps a trimmed note; undo restores both', async () => {
    const db = makeDb();
    const was = new Date('2026-11-10T14:00:00Z');
    addState(db, T1, { working_since: was });
    const res = await act(db, { action: 'stop', item_key: T1, note: '  at step 3  ' });
    expect(stateOf(db, T1)!.working_since).toBeNull();
    expect(stateOf(db, T1)!.left_off_note).toBe('at step 3');
    await undo(db, res.action_id);
    expect((stateOf(db, T1)!.working_since as Date).getTime()).toBe(was.getTime());
    expect(stateOf(db, T1)!.left_off_note).toBeNull();
  });

  it('stop with an empty note clears the note', async () => {
    const db = makeDb();
    addState(db, T1, { working_since: NOW, left_off_note: 'old' });
    await act(db, { action: 'stop', item_key: T1, note: '' });
    expect(stateOf(db, T1)!.left_off_note).toBeNull();
    await act(db, { action: 'stop', item_key: T1, note: null });
    expect(stateOf(db, T1)!.left_off_note).toBeNull();
  });

  it('done_pin clears the pin and undoes', async () => {
    const db = makeDb();
    addState(db, T1, { working_since: NOW });
    const res = await act(db, { action: 'done_pin', item_key: T1 });
    expect(stateOf(db, T1)!.working_since).toBeNull();
    await undo(db, res.action_id);
    expect(stateOf(db, T1)!.working_since).not.toBeNull();
  });
});

describe('arc_add', () => {
  it('appends the step, marks the item, lifts a removal mark for the group, and undoes', async () => {
    const db = makeDb();
    const day = addDay(db);
    addState(db, T3, { arc_removed_at: NOW, arc_removed_group: G });
    const res = await act(db, { action: 'arc_add', item_key: T3, group_key: G, origin: 'in_view' });
    expect(day.step_item_keys).toEqual([T1, T2, T3]);
    const s = stateOf(db, T3)!;
    expect(s.arc_added_group).toBe(G);
    expect(s.arc_removed_at).toBeNull();
    await undo(db, res.action_id);
    expect(day.step_item_keys).toEqual([T1, T2]);
    expect(stateOf(db, T3)!.arc_removed_group).toBe(G);
    expect(stateOf(db, T3)!.arc_added_at).toBeNull();
  });

  it('keeps a removal mark for a different group', async () => {
    const db = makeDb();
    addDay(db);
    addState(db, T3, { arc_removed_at: NOW, arc_removed_group: G2 });
    await act(db, { action: 'arc_add', item_key: T3, group_key: G, origin: 'search' });
    expect(stateOf(db, T3)!.arc_removed_group).toBe(G2);
  });

  it('answers stale_day, already_in_arc and stale_day without a day', async () => {
    const db = makeDb();
    await expect(act(db, { action: 'arc_add', item_key: T3, group_key: G, origin: 'in_view' })).rejects.toMatchObject({ code: 'stale_day' });
    addDay(db);
    await expect(act(db, { action: 'arc_add', item_key: T3, group_key: G2, origin: 'in_view' })).rejects.toMatchObject({ code: 'stale_day', statusCode: 409 });
    await expect(act(db, { action: 'arc_add', item_key: T1, group_key: G, origin: 'in_view' })).rejects.toMatchObject({ code: 'already_in_arc' });
    expect(db.homeAction.create).not.toHaveBeenCalled();
  });

  it('the cap of 4 does not apply to added steps', async () => {
    const db = makeDb();
    addDay(db, { step_item_keys: [T1, T2, 'task:11111111-1111-4111-8111-111111111112', 'task:11111111-1111-4111-8111-111111111113'] });
    await act(db, { action: 'arc_add', item_key: T3, group_key: G, origin: 'created' });
    expect(db.days[0].step_item_keys).toHaveLength(5);
  });
});

describe('arc_remove', () => {
  it('removes the step, sets the removal mark, clears the add mark, and undoes in place', async () => {
    const db = makeDb();
    const day = addDay(db, { step_item_keys: [T1, T2, T3] });
    addState(db, T2, { arc_added_at: NOW, arc_added_group: G });
    const res = await act(db, { action: 'arc_remove', item_key: T2, group_key: G });
    expect(day.step_item_keys).toEqual([T1, T3]);
    const s = stateOf(db, T2)!;
    expect(s.arc_removed_group).toBe(G);
    expect(s.arc_added_at).toBeNull();
    await undo(db, res.action_id);
    expect(day.step_item_keys).toEqual([T1, T2, T3]);
    expect(stateOf(db, T2)!.arc_added_group).toBe(G);
    expect(stateOf(db, T2)!.arc_removed_at).toBeNull();
  });

  it('undoing a removal also takes the item out of Quick, and every undo brings back the original day', async () => {
    const db = makeDb();
    const day = addDay(db, { quick_item_keys: ['task:q1'], step_item_keys: [T1, T2, T3] });
    const original = JSON.parse(JSON.stringify({ q: day.quick_item_keys, s: day.step_item_keys }));
    const res = await act(db, { action: 'arc_remove', item_key: T2, group_key: G });
    const res2 = await act(db, { action: 'arc_remove', item_key: T3, group_key: G });
    // A load in between put T2 into Quick (the old behaviour); the undo must clear it.
    day.quick_item_keys = [T2, ...(day.quick_item_keys as string[])];
    await undo(db, res2.action_id);
    await undo(db, res.action_id);
    expect(day.step_item_keys).toEqual(original.s);
    expect(day.quick_item_keys).toEqual(original.q);
  });

  it('answers not_in_arc and stale_day', async () => {
    const db = makeDb();
    addDay(db);
    await expect(act(db, { action: 'arc_remove', item_key: T3, group_key: G })).rejects.toMatchObject({ code: 'not_in_arc' });
    await expect(act(db, { action: 'arc_remove', item_key: T1, group_key: G2 })).rejects.toMatchObject({ code: 'stale_day' });
  });
});

describe('arc_reorder', () => {
  it('stores the new order and undoes to the old one', async () => {
    const db = makeDb();
    const day = addDay(db, { step_item_keys: [T1, T2, T3] });
    const res = await act(db, { action: 'arc_reorder', group_key: G, step_keys: [T3, T1, T2] });
    expect(day.step_item_keys).toEqual([T3, T1, T2]);
    expect(res.item_key).toBeNull();
    await undo(db, res.action_id);
    expect(day.step_item_keys).toEqual([T1, T2, T3]);
  });

  it('refuses a different set, a duplicate, and a wrong group', async () => {
    const db = makeDb();
    addDay(db, { step_item_keys: [T1, T2] });
    await expect(act(db, { action: 'arc_reorder', group_key: G, step_keys: [T1] })).rejects.toMatchObject({ code: 'stale_day' });
    await expect(act(db, { action: 'arc_reorder', group_key: G, step_keys: [T1, T3] })).rejects.toMatchObject({ code: 'stale_day' });
    await expect(act(db, { action: 'arc_reorder', group_key: G, step_keys: [T1, T1] })).rejects.toMatchObject({ code: 'stale_day' });
    await expect(act(db, { action: 'arc_reorder', group_key: G2, step_keys: [T1, T2] })).rejects.toMatchObject({ code: 'stale_day' });
  });
});

describe('swap and lighter', () => {
  const target = {
    group_key: G2,
    group_label: 'Other',
    arc_id: null,
    quick_item_keys: [] as string[],
    step_item_keys: [T3],
    sized_minutes: 20,
  };

  it('swap rewrites the day, records where it came from, and undoes', async () => {
    const db = makeDb();
    const day = addDay(db, { quick_item_keys: [] });
    vi.mocked(dayForGroup).mockReturnValue(target);
    const res = await act(db, { action: 'swap', to_group_key: G2 });
    expect(day.group_key).toBe(G2);
    expect(day.step_item_keys).toEqual([T3]);
    expect(day.swapped_from_group).toBe(G);
    expect(res.item_key).toBeNull();
    await undo(db, res.action_id);
    expect(day.group_key).toBe(G);
    expect(day.step_item_keys).toEqual([T1, T2]);
    expect(day.swapped_from_group).toBeNull();
  });

  it('lighter sets lighter_at', async () => {
    const db = makeDb();
    const day = addDay(db);
    vi.mocked(dayForGroup).mockReturnValue(target);
    await act(db, { action: 'lighter', to_group_key: G2 });
    expect((day.lighter_at as unknown as Date).getTime()).toBe(NOW.getTime());
    expect(day.swapped_from_group).toBeNull();
  });

  it('unknown group is unknown_group; no day is stale_day', async () => {
    const db = makeDb();
    await expect(act(db, { action: 'swap', to_group_key: G2 })).rejects.toMatchObject({ code: 'stale_day' });
    addDay(db);
    vi.mocked(dayForGroup).mockReturnValue(null);
    await expect(act(db, { action: 'swap', to_group_key: G2 })).rejects.toMatchObject({ code: 'unknown_group', statusCode: 409 });
  });

  it('undo of a swap is refused when the day moved on since', async () => {
    const db = makeDb();
    const day = addDay(db);
    vi.mocked(dayForGroup).mockReturnValue(target);
    const res = await act(db, { action: 'swap', to_group_key: G2 });
    day.group_key = G;
    await expect(undo(db, res.action_id)).rejects.toMatchObject({ code: 'not_undoable' });
    expect(db.actions[0].undone_at).toBeNull();
  });
});

describe('record', () => {
  it('logs only a home_actions row, offers no undo, and cannot be undone', async () => {
    const db = makeDb();
    const res = await act(db, { action: 'record', item_key: T1, did: 'done' });
    expect(res.undo_until).toBeNull();
    expect(res.message).toBeNull();
    expect(db.actions).toHaveLength(1);
    expect(db.actions[0].action).toBe('record');
    expect(db.states).toHaveLength(0);
    await expect(undo(db, res.action_id)).rejects.toMatchObject({ code: 'not_undoable' });
    expectSharedUntouched(db);
  });

  it('logs an existing-endpoint undo', async () => {
    const db = makeDb();
    await act(db, { action: 'record', item_key: T1, did: 'done', undo: true });
    expect(db.actions[0].after).toEqual({ recorded: { did: 'done', undo: true } });
  });
});

describe('undo rules', () => {
  it('refuses after the window', async () => {
    const db = makeDb();
    const res = await act(db, { action: 'matters_more', item_key: T1 });
    const late = new Date(NOW.getTime() + 24 * 3600 * 1000 + 1000);
    await expect(undo(db, res.action_id, late)).rejects.toMatchObject({ code: 'undo_expired', statusCode: 409 });
    expect(stateOf(db, T1)!.boosted_at).not.toBeNull();
  });

  it('refuses a second undo', async () => {
    const db = makeDb();
    const res = await act(db, { action: 'matters_more', item_key: T1 });
    await undo(db, res.action_id);
    await expect(undo(db, res.action_id)).rejects.toMatchObject({ code: 'undo_used', statusCode: 409 });
  });

  it('answers not_found for an unknown id and for another user\'s action', async () => {
    const db = makeDb();
    const res = await act(db, { action: 'matters_more', item_key: T1 });
    await expect(undo(db, 'nope')).rejects.toMatchObject({ code: 'not_found', statusCode: 404 });
    await expect(runHomeUndo(asPrisma(db), OTHER, res.action_id, NOW)).rejects.toMatchObject({ code: 'not_found' });
    expect(stateOf(db, T1)!.boosted_at).not.toBeNull();
  });

  it('undo of an action on an existing row never deletes it', async () => {
    const db = makeDb();
    addState(db, T1, { park_count: 1, view_at: NOW });
    const res = await act(db, { action: 'matters_more', item_key: T1 });
    await undo(db, res.action_id);
    expect(stateOf(db, T1)).toBeDefined();
    expect(stateOf(db, T1)!.park_count).toBe(1);
  });

  it('undo of an action that created a row keeps the row when a later action used it', async () => {
    const db = makeDb();
    const first = await act(db, { action: 'matters_more', item_key: T1 });
    await act(db, { action: 'pin', item_key: T1 });
    await undo(db, first.action_id);
    expect(stateOf(db, T1)).toBeDefined();
    expect(stateOf(db, T1)!.boosted_at).toBeNull();
    expect(stateOf(db, T1)!.working_since).not.toBeNull();
  });

  it('undo never touches another user\'s rows', async () => {
    const db = makeDb();
    addState(db, T1, { user_id: OTHER, boosted_at: NOW });
    const res = await act(db, { action: 'matters_more', item_key: T1 });
    await undo(db, res.action_id);
    const mine = db.states.filter((r) => r.user_id === U);
    expect(mine).toHaveLength(0);
    expect(db.states.find((r) => r.user_id === OTHER)!.boosted_at).toEqual(NOW);
  });
});

describe('writes stay in the home tables, in one transaction', () => {
  const requests: HomeActRequest[] = [
    { action: 'not_now', item_key: T1 },
    { action: 'bring_forward', item_key: T1 },
    { action: 'matters_more', item_key: T1 },
    { action: 'not_emergency', item_key: T1 },
    { action: 'pin', item_key: T1 },
    { action: 'stop', item_key: T1, note: 'n' },
    { action: 'done_pin', item_key: T1 },
    { action: 'arc_add', item_key: T3, group_key: G, origin: 'created' },
    { action: 'arc_remove', item_key: T3, group_key: G },
    { action: 'arc_reorder', group_key: G, step_keys: [T2, T1] },
    { action: 'swap', to_group_key: G2 },
    { action: 'lighter', to_group_key: G2 },
    { action: 'record', item_key: T1, did: 'let_it_go' },
  ];

  it('no action, and no undo, calls a task, arc, wait or email ask model; each runs in one transaction', async () => {
    const db = makeDb();
    addDay(db, { step_item_keys: [T1, T2] });
    vi.mocked(dayForGroup).mockReturnValue({
      group_key: G2,
      group_label: 'Other',
      arc_id: null,
      quick_item_keys: [],
      step_item_keys: [T3],
      sized_minutes: 5,
    });
    const ids: string[] = [];
    for (const req of requests) {
      const before = db.$transaction.mock.calls.length;
      const res = await act(db, req);
      expect(db.$transaction.mock.calls.length - before).toBe(1);
      ids.push(res.action_id);
    }
    expect(db.actions).toHaveLength(requests.length);
    for (const id of ids.slice(0, -1).reverse()) {
      await undo(db, id).catch((e) => {
        if (!(e instanceof HomeActError)) throw e;
      });
    }
    expectSharedUntouched(db);
  });

  it('every write carries the caller\'s user id', async () => {
    const db = makeDb();
    addDay(db);
    await act(db, { action: 'arc_add', item_key: T3, group_key: G, origin: 'in_view' });
    await act(db, { action: 'pin', item_key: T1 });
    expect(db.states.every((r) => r.user_id === U)).toBe(true);
    expect(db.actions.every((r) => r.user_id === U)).toBe(true);
    for (const call of db.homeDay.updateMany.mock.calls) expect(call[0].where.user_id).toBe(U);
  });
});

describe('planAct is pure', () => {
  it('does not mutate the day it is given', () => {
    const day = {
      id: 'd',
      date: DATE,
      group_key: G,
      group_label: 'Grok',
      arc_id: null,
      quick_item_keys: [],
      step_item_keys: [T1, T2],
      sized_minutes: null,
      proposed_at: NOW,
      started_at: null,
      swapped_from_group: null,
      lighter_at: null,
    };
    planAct({ action: 'arc_add', item_key: T3, group_key: G, origin: 'in_view' }, { now: NOW, timezone: TZ, state: null, pinned: null, day });
    expect(day.step_item_keys).toEqual([T1, T2]);
  });
});

describe('reader-facing sentences', () => {
  it('have no em dash, en dash, or the words priority or overdue', async () => {
    const db = makeDb();
    addDay(db);
    vi.mocked(dayForGroup).mockReturnValue({
      group_key: G2,
      group_label: 'x',
      arc_id: null,
      quick_item_keys: [],
      step_item_keys: [T3],
      sized_minutes: 1,
    });
    const messages: string[] = [];
    for (const req of [
      { action: 'not_now', item_key: T1 },
      { action: 'not_now', item_key: T1 },
      { action: 'not_now', item_key: T1 },
      { action: 'bring_forward', item_key: T2 },
      { action: 'matters_more', item_key: T2 },
      { action: 'not_emergency', item_key: T2 },
      { action: 'pin', item_key: T1 },
      { action: 'stop', item_key: T1, note: 'x' },
      { action: 'done_pin', item_key: T1 },
      { action: 'arc_add', item_key: T3, group_key: G, origin: 'in_view' },
      { action: 'arc_remove', item_key: T3, group_key: G },
      { action: 'arc_reorder', group_key: G, step_keys: [T2, T1] },
      { action: 'swap', to_group_key: G2 },
    ] as HomeActRequest[]) {
      const res = await act(db, req);
      if (res.message) messages.push(res.message);
      if (req.action === 'swap') db.days[0].group_key = G;
    }
    for (const code of ['pin_conflict', 'stale_day', 'already_in_arc', 'not_in_arc', 'unknown_group', 'undo_expired', 'undo_used', 'not_undoable', 'not_found'] as const) {
      messages.push(new HomeActError(code).message);
    }
    expect(messages.length).toBeGreaterThan(15);
    for (const m of messages) {
      expect(m).not.toMatch(new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']'));
      expect(m).not.toMatch(/priority|overdue/i);
    }
  });
});
