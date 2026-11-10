// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/home/load', () => ({ loadHomeInputs: vi.fn(async () => ({ calendar_events: [] })) }));
vi.mock('@/lib/home/state', () => ({ loadItemStates: vi.fn(async () => []), getHomeDay: vi.fn(async () => null) }));
vi.mock('@/lib/home/select', () => ({ selectHome: vi.fn(() => ({})) }));
const item = (n: number) => ({ key: `task:${n}`, title: `T${n}`, who: 'Gene', age: '2 days', effort: 'About 10 minutes', why_now: 'secret', reason: 'secret', actions: [{ id: 'done' }], minutes: 10, opened: { summary: 'long' } });
vi.mock('@/lib/home/today', () => ({
  proposeDay: vi.fn(() => ({ group_key: 'own' })),
  assembleHomeResponse: vi.fn(() => ({ today: { arc_name: 'Arc', why: 'Because', size_line: 'About 20 minutes', quick: [item(1)], steps: [item(2)], swap: [{ x: 1 }] } })),
}));

import { ownerToday } from '../route-helpers';

describe('ownerToday', () => {
  it('trims to the arc name and, per item, key, title, who, age and effort', async () => {
    const t = await ownerToday('u1', new Date('2026-11-10T15:00:00Z'), {} as never);
    expect(Object.keys(t).sort()).toEqual(['arc_name', 'date', 'quick', 'size_line', 'steps', 'why']);
    expect(t.date).toBe('2026-11-10');
    expect(Object.keys(t.quick[0]).sort()).toEqual(['age', 'effort', 'key', 'title', 'who']);
    expect(JSON.stringify(t)).not.toContain('secret');
  });
});
