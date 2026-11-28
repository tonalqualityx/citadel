/**
 * The health tiles against the real schema (task 183ec7a8): every source query runs on Postgres, today's readings are stored once per
 * measure and a second load the same day updates them in place. Skips unless DATABASE_URL names the scratch Postgres.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { loadHomeHealth } from '../load';

const SCRATCH = /scratch/.test(process.env.DATABASE_URL ?? '');
// A day no other test or real reading uses, so the rows this test writes are its own.
const NOW = new Date('2031-01-15T15:00:00.000Z');
const DAY = new Date('2031-01-15T00:00:00.000Z');

describe.skipIf(!SCRATCH)('health tiles (real database)', () => {
  afterAll(async () => {
    await prisma.healthSnapshot.deleteMany({ where: { day: DAY } });
  });

  it('reads every source without error and keeps one reading per measure per day', async () => {
    const input = {
      now: NOW,
      timezone: 'America/New_York',
      clients: { sites_down: [], mail_waiting: [] },
      projects: async () => [{ name: 'P', stale: false, days_quiet: 1 }],
    };
    const first = await loadHomeHealth(prisma, input);
    expect(first.tiles).toHaveLength(6);
    expect(first.tiles.filter((t) => t.state === 'unknown').map((t) => t.id)).toEqual([]);
    await loadHomeHealth(prisma, input);
    const rows = await prisma.healthSnapshot.findMany({ where: { day: DAY }, orderBy: { measure: 'asc' } });
    expect(rows.map((r) => r.measure)).toEqual(['clients_issues', 'owed_to_us', 'projects_stuck', 'ready_to_invoice', 'sales_out']);
  });
});
