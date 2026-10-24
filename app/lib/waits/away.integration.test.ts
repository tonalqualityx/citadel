// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { prismaAwayLookups } from './away';
import { prismaSweepStore } from './prisma-store';
import { prismaOwnerLookups, MIKE_USER_ID } from './owner';
import { runSweep } from './sweeper';
import { buildWaitData } from './templates';

// The out of office pass against a real Postgres. Skips unless DATABASE_URL names a scratch
// database, because it writes rows.
const SCRATCH = /scratch/i.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('out of office stand-ins (real database)', () => {
  const tag = `ooo-${Date.now()}`;
  let standIn = '';
  let waitId = '';
  let paidId = '';
  const created: string[] = [];
  const prevFlag = process.env.OOO_STANDINS;

  beforeAll(async () => {
    standIn = (await prisma.user.create({ data: { email: `${tag}@example.test`, password_hash: 'x', name: 'OOO Test', role: 'pm' } })).id;
    created.push(standIn);
    await prisma.user.upsert({
      where: { id: MIKE_USER_ID },
      update: {},
      create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' },
    });
    const start = new Date(Date.now() - 86_400_000);
    const end = new Date(Date.now() + 3 * 86_400_000);
    await prisma.awayWindow.create({ data: { user_id: MIKE_USER_ID, starts_at: start, ends_at: end, source: 'manual', note: tag } });
    await prisma.standIn.create({ data: { for_user_id: MIKE_USER_ID, role_key: 'wordpress', stand_in_user_id: standIn } });
    const w = await prisma.wait.create({
      data: { ...buildWaitData({ template_key: 'change.needs_human', subject: tag, owner_user_id: MIKE_USER_ID }), idempotency_key: `${tag}:a` } as unknown as Prisma.WaitUncheckedCreateInput,
    });
    waitId = w.id;
    const p = await prisma.wait.create({
      data: { ...buildWaitData({ template_key: 'handoff.generic', subject: `${tag} paid`, owner_user_id: MIKE_USER_ID, mike_only: true }), idempotency_key: `${tag}:b` } as unknown as Prisma.WaitUncheckedCreateInput,
    });
    paidId = p.id;
  });

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.OOO_STANDINS;
    else process.env.OOO_STANDINS = prevFlag;
    await prisma.awayWindow.deleteMany({ where: { note: tag } });
    await prisma.standIn.deleteMany({ where: { stand_in_user_id: standIn } });
  });

  const sweep = () =>
    runSweep({
      store: prismaSweepStore(prisma),
      owner: prismaOwnerLookups(prisma as unknown as Parameters<typeof prismaOwnerLookups>[0]),
      switchIsOn: async () => false,
      away: prismaAwayLookups(prisma as unknown as Parameters<typeof prismaAwayLookups>[0]),
    });

  it('flag off: the rows are there and the sweeper ignores them', async () => {
    delete process.env.OOO_STANDINS;
    await sweep();
    expect((await prisma.wait.findUnique({ where: { id: waitId } }))!.stand_in_user_id).toBeNull();
    expect((await prisma.wait.findUnique({ where: { id: paidId } }))!.state).toBe('waiting');
  });

  it('flag on: routes by role, pauses the Mike-only row, then is idempotent', async () => {
    process.env.OOO_STANDINS = 'true';
    await sweep();
    const routed = (await prisma.wait.findUnique({ where: { id: waitId } }))!;
    expect(routed.stand_in_user_id).toBe(standIn);
    const paused = (await prisma.wait.findUnique({ where: { id: paidId } }))!;
    expect(paused.state).toBe('paused');
    expect(paused.mike_only).toBe(true);
    expect(paused.paused_until!.getTime()).toBeGreaterThan(Date.now() + 3 * 86_400_000);
    const n = await prisma.waitEvent.count({ where: { wait_id: { in: [waitId, paidId] }, source: 'ooo' } });
    expect(n).toBe(2);
    await sweep();
    expect(await prisma.waitEvent.count({ where: { wait_id: { in: [waitId, paidId] }, source: 'ooo' } })).toBe(2);
  });
});
