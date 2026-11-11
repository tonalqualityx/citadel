// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/home/load', () => ({ loadHomeInputs: vi.fn(async () => ({ calendar_events: [] })) }));
vi.mock('@/lib/home/state', () => ({ loadItemStates: vi.fn(async () => []), getHomeDay: vi.fn(async () => null) }));
vi.mock('@/lib/home/select', () => ({
  selectHome: vi.fn(() => ({
    candidates: [
      { key: 'task:9', parked: true, parkedBy: 'user', item: { title: 'Parked one' }, state: { view_at: new Date('2026-11-11T14:00:00Z') } },
      { key: 'task:6', parked: true, parkedBy: 'keeper', item: { title: 'Keeper day' }, state: { view_at: new Date('2026-11-12T05:05:00Z') } },
      { key: 'task:8', parked: false, item: { title: 'In view' }, state: undefined },
      { key: 'task:7', parked: true, parkedBy: 'user', item: { title: 'Parked for good' }, state: { view_at: null } },
    ],
  })),
}));
const item = (n: number) => ({ key: `task:${n}`, title: `T${n}`, who: 'Gene', age: '2 days', effort: 'About 10 minutes', why_now: 'secret', reason: 'secret', actions: [{ id: 'done' }], minutes: 10, opened: { summary: 'long' } });
vi.mock('@/lib/home/today', () => ({
  proposeDay: vi.fn(() => ({ group_key: 'own' })),
  assembleHomeResponse: vi.fn(() => ({
    today: {
      group_key: 'arc:abc', arc_name: 'Arc', why: 'Because', size_line: 'About 20 minutes', quick: [item(1)], steps: [item(2)],
      swap: [{ group_key: 'client:c1', name: 'Jill', why: 'secret', minutes: 30, effort: 'About 30 minutes' }],
      lighter: { group_key: 'own', name: 'Indelible', why: 'secret', minutes: 10, effort: 'About 10 minutes' },
    },
    sections: { needs_you_now: [item(3)], working_on: [item(4)], leads: [], mail: [item(5)], next: [], handled: [{ id: 'h' }], handled_more: { count: 2, text: '2 more handled' } },
    everything_else: { count: 7, line: 'x', groups: [] },
  })),
}));

import { ownerToday } from '../route-helpers';

describe('ownerToday', () => {
  it('trims to the arc name and, per item, key, title, who, age and effort', async () => {
    const t = await ownerToday('u1', new Date('2026-11-10T15:00:00Z'), {} as never);
    expect(Object.keys(t).sort()).toEqual(['arc_name', 'counts', 'date', 'emergencies', 'group_key', 'lighter', 'parked', 'pinned', 'quick', 'size_line', 'steps', 'swap', 'why']);
    expect(t.date).toBe('2026-11-10');
    expect(Object.keys(t.quick[0]).sort()).toEqual(['age', 'effort', 'key', 'title', 'who']);
    expect(JSON.stringify(t)).not.toContain('secret');
    expect(t.group_key).toBe('arc:abc');
    expect(t.swap).toEqual([{ group_key: 'client:c1', name: 'Jill', effort: 'About 30 minutes' }]);
    expect(t.lighter).toEqual({ group_key: 'own', name: 'Indelible', effort: 'About 10 minutes' });
    expect(t.pinned).toEqual({ key: 'task:4', title: 'T4' });
    expect(t.emergencies).toEqual([{ key: 'task:3', title: 'T3', emergency: true }]);
    expect(t.parked).toEqual([{ key: 'task:9', title: 'Parked one', until: '2026-11-11T14:00:00.000Z' }, { key: 'task:7', title: 'Parked for good', until: null }]);
    expect(t.counts).toEqual({ needs_you_now: 1, working_on: 1, leads: 0, mail: 1, next: 0, handled: 3, everything_else: 7 });
  });
});
