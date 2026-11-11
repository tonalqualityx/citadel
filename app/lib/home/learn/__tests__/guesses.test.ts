import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { writeGuesses } from '../store';
import { EFFORT } from '../effort';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-24T05:00:00Z');
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fake(taskCount: number, over: Record<string, unknown> = {}) {
  const upserts: Array<{ where: { user_id_item_key: { user_id: string; item_key: string } }; update: Record<string, unknown> }> = [];
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    id: id(i + 1),
    title: i === 0 ? 'Send the quote' : 'Footer',
    description: null,
    sop_id: null,
    estimated_minutes: null,
    energy_estimate: null,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    requirements: null,
    ...(over as object),
  }));
  const db = {
    task: { findMany: vi.fn(async () => tasks), update: vi.fn(), updateMany: vi.fn() },
    homeItemState: { findMany: vi.fn(async () => []), upsert: vi.fn(async (a: never) => { upserts.push(a); return {}; }) },
    timeEntry: { findMany: vi.fn(async () => []) },
  };
  return { db: db as unknown as PrismaClient, raw: db, upserts };
}

describe('writeGuesses', () => {
  it('guesses for at most 300 tasks a night', async () => {
    const { db, upserts } = fake(350);
    const run = await writeGuesses(db, OWNER, NOW);
    expect(run.considered).toBe(EFFORT.nightlyCap);
    expect(upserts).toHaveLength(300);
  });

  it('writes only the owner home_item_state guess columns, and never a Task', async () => {
    const { db, raw, upserts } = fake(2);
    await writeGuesses(db, OWNER, NOW);
    expect(raw.task.update).not.toHaveBeenCalled();
    expect(raw.task.updateMany).not.toHaveBeenCalled();
    for (const u of upserts) {
      expect(u.where.user_id_item_key.user_id).toBe(OWNER);
      expect(Object.keys(u.update).sort()).toEqual(['drain', 'effort_basis_n', 'effort_minutes', 'effort_source', 'guessed_at', 'unknowns']);
    }
    expect(upserts[0].update.drain).toBe('high');
    expect(upserts[0].update.effort_source).toBe('kind');
  });

  it('a set estimate gets no minutes, a non-default mystery or battery gets no unknowns or drain', async () => {
    const { db, upserts } = fake(1, { estimated_minutes: 25, mystery_factor: 'average', battery_impact: 'high_drain' });
    await writeGuesses(db, OWNER, NOW);
    expect(upserts[0].update).toMatchObject({ effort_minutes: null, effort_source: null, effort_basis_n: null, unknowns: null, drain: null });
  });
});
