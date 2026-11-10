import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  appendHomeAction,
  dateOnly,
  dateString,
  findPinnedItemState,
  getHomeAction,
  getHomeDay,
  getItemState,
  getOrCreateHomeDay,
  loadItemStates,
  markHomeActionUndone,
  restoreItemState,
  updateHomeDay,
  upsertItemState,
} from '../state';

const U = 'user-1';

function makeDb() {
  return {
    homeItemState: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(async (a: { create: object }) => a.create),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    homeDay: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    homeAction: {
      create: vi.fn().mockImplementation(async (a: { data: object }) => ({ id: 'a1', ...a.data })),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}
type Db = ReturnType<typeof makeDb>;
const asDb = (db: Db) => db as unknown as PrismaClient;

const dayRow = (over: object = {}) => ({
  id: 'd1',
  date: new Date('2026-11-10T00:00:00.000Z'),
  group_key: 'own',
  group_label: 'Indelible',
  arc_id: null,
  quick_item_keys: [],
  step_item_keys: ['task:x'],
  sized_minutes: 60,
  proposed_at: new Date('2026-11-10T14:00:00Z'),
  started_at: null,
  swapped_from_group: null,
  lighter_at: null,
  ...over,
});

const build = () => ({
  group_key: 'own',
  group_label: 'Indelible',
  arc_id: null,
  quick_item_keys: [],
  step_item_keys: [],
  sized_minutes: null,
});

let db: Db;
beforeEach(() => {
  db = makeDb();
});

describe('date helpers', () => {
  it('round trips and rejects bad strings', () => {
    expect(dateOnly('2026-11-10').toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(dateString(dateOnly('2026-11-10'))).toBe('2026-11-10');
    expect(() => dateOnly('2026-13-40')).toThrow();
    expect(() => dateOnly('11/10/2026')).toThrow();
  });
});

describe('home_item_state', () => {
  it('loadItemStates filters by user_id', async () => {
    await loadItemStates(asDb(db), U);
    expect(db.homeItemState.findMany.mock.calls[0][0].where).toEqual({ user_id: U });
  });

  it('getItemState and findPinnedItemState filter by user_id', async () => {
    await getItemState(asDb(db), U, 'task:a');
    expect(db.homeItemState.findFirst.mock.calls[0][0].where).toEqual({ user_id: U, item_key: 'task:a' });
    await findPinnedItemState(asDb(db), U);
    expect(db.homeItemState.findFirst.mock.calls[1][0].where).toEqual({ user_id: U, working_since: { not: null } });
  });

  it('upsertItemState keys on (user_id, item_key) and stamps user_id on create', async () => {
    const now = new Date();
    await upsertItemState(asDb(db), U, 'task:a', { boosted_at: now });
    const arg = db.homeItemState.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ user_id_item_key: { user_id: U, item_key: 'task:a' } });
    expect(arg.create).toEqual({ user_id: U, item_key: 'task:a', boosted_at: now });
    expect(arg.update).toEqual({ boosted_at: now });
  });

  it('restoreItemState writes every undoable field back, clearing nulls', async () => {
    await restoreItemState(asDb(db), U, 'task:a', {
      item_key: 'task:a',
      park_count: 1,
      view_at: null,
      boosted_at: null,
      not_emergency_at: null,
      working_since: null,
      left_off_note: null,
      arc_added_at: null,
      arc_added_group: null,
      arc_removed_at: null,
      arc_removed_group: null,
      first_seen_at: new Date(),
      last_shown_at: null,
    });
    const update = db.homeItemState.upsert.mock.calls[0][0].update;
    expect(update.park_count).toBe(1);
    expect(update.view_at).toBeNull();
    expect(update).not.toHaveProperty('first_seen_at');
  });

  it('restoreItemState deletes the row (scoped to the user) when there was no before-state', async () => {
    await restoreItemState(asDb(db), U, 'task:a', null);
    expect(db.homeItemState.deleteMany).toHaveBeenCalledWith({ where: { user_id: U, item_key: 'task:a' } });
    expect(db.homeItemState.upsert).not.toHaveBeenCalled();
  });
});

describe('home_day', () => {
  it('getHomeDay filters by user and date and returns the date as a string', async () => {
    db.homeDay.findFirst.mockResolvedValue(dayRow());
    const day = await getHomeDay(asDb(db), U, '2026-11-10');
    expect(db.homeDay.findFirst.mock.calls[0][0].where).toEqual({ user_id: U, date: new Date('2026-11-10T00:00:00.000Z') });
    expect(day?.date).toBe('2026-11-10');
  });

  it('getOrCreateHomeDay returns an existing row without building or creating', async () => {
    db.homeDay.findFirst.mockResolvedValue(dayRow());
    const build = vi.fn();
    const r = await getOrCreateHomeDay(asDb(db), U, '2026-11-10', build);
    expect(r.created).toBe(false);
    expect(build).not.toHaveBeenCalled();
    expect(db.homeDay.create).not.toHaveBeenCalled();
  });

  it('getOrCreateHomeDay creates with user_id and the date when none exists', async () => {
    db.homeDay.create.mockResolvedValue(dayRow());
    const r = await getOrCreateHomeDay(asDb(db), U, '2026-11-10', build);
    expect(r.created).toBe(true);
    const data = db.homeDay.create.mock.calls[0][0].data;
    expect(data.user_id).toBe(U);
    expect(data.date).toEqual(new Date('2026-11-10T00:00:00.000Z'));
  });

  it('getOrCreateHomeDay re-reads the winner on P2002', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    db.homeDay.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(dayRow({ id: 'winner' }));
    db.homeDay.create.mockRejectedValue(p2002);
    const r = await getOrCreateHomeDay(asDb(db), U, '2026-11-10', build);
    expect(r.created).toBe(false);
    expect(r.day.id).toBe('winner');
    expect(db.homeDay.findFirst).toHaveBeenCalledTimes(2);
  });

  it('getOrCreateHomeDay rethrows any other error', async () => {
    db.homeDay.create.mockRejectedValue(new Error('boom'));
    await expect(getOrCreateHomeDay(asDb(db), U, '2026-11-10', build)).rejects.toThrow('boom');
  });

  it('getOrCreateHomeDay rethrows P2002 when the re-read finds nothing', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    db.homeDay.create.mockRejectedValue(p2002);
    await expect(getOrCreateHomeDay(asDb(db), U, '2026-11-10', build)).rejects.toBe(p2002);
  });

  it('updateHomeDay is scoped by user_id and date', async () => {
    const n = await updateHomeDay(asDb(db), U, '2026-11-10', { lighter_at: new Date() });
    expect(n).toBe(1);
    expect(db.homeDay.updateMany.mock.calls[0][0].where).toEqual({
      user_id: U,
      date: new Date('2026-11-10T00:00:00.000Z'),
    });
  });
});

describe('home_actions', () => {
  it('appendHomeAction stamps user_id, leaves null json unset and defaults the source', async () => {
    const until = new Date();
    await appendHomeAction(asDb(db), U, {
      item_key: 'task:a',
      action: 'not_now',
      before: { park_count: 0 },
      after: null,
      undo_until: until,
    });
    const data = db.homeAction.create.mock.calls[0][0].data;
    expect(data.user_id).toBe(U);
    expect(data.before).toEqual({ park_count: 0 });
    expect(data.after).toBeUndefined();
    expect(data.undo_until).toBe(until);
    expect(data).not.toHaveProperty('source');
  });

  it('appendHomeAction passes an explicit source', async () => {
    await appendHomeAction(asDb(db), U, { item_key: null, action: 'swap', source: 'home' });
    expect(db.homeAction.create.mock.calls[0][0].data.source).toBe('home');
  });

  it('getHomeAction only finds the user\'s own row', async () => {
    await getHomeAction(asDb(db), U, 'a1');
    expect(db.homeAction.findFirst.mock.calls[0][0].where).toEqual({ id: 'a1', user_id: U });
  });

  it('markHomeActionUndone only matches a row that is not yet undone, and says whether it did', async () => {
    const now = new Date();
    expect(await markHomeActionUndone(asDb(db), U, 'a1', now)).toBe(true);
    expect(db.homeAction.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'a1', user_id: U, undone_at: null },
      data: { undone_at: now },
    });
    db.homeAction.updateMany.mockResolvedValue({ count: 0 });
    expect(await markHomeActionUndone(asDb(db), U, 'a1', now)).toBe(false);
  });
});
