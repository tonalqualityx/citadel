// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { claimTask, releaseClaim, renewClaim, getClaim, type ClaimResult } from '../claims';
import { claimTaskNaive } from './claims.naive.fixture';

// Fleet item 3: the claim race against a real Postgres. Opt in with CLAIMS_RACE_DB=1 and a scratch DATABASE_URL.
// CLAIMS_IMPL=naive swaps in the deliberately non-atomic read-then-write variant: the race round MUST fail there.
const RUN = process.env.CLAIMS_RACE_DB === '1' && /scratch/i.test(process.env.DATABASE_URL ?? '');
const NAIVE = process.env.CLAIMS_IMPL === 'naive';
const ROUNDS = 200;

describe.skipIf(!RUN)(`task claims (real database, ${NAIVE ? 'NAIVE variant' : 'atomic'})`, () => {
  let a: PrismaClient;
  let b: PrismaClient;
  const taskIds: string[] = [];
  const tag = `claimrace${Date.now()}`;

  const claim = (db: PrismaClient, taskId: string, holder: string, ttlSeconds?: number): Promise<ClaimResult> =>
    NAIVE ? claimTaskNaive({ taskId, holder, ttlSeconds }, db) : claimTask({ taskId, holder, ttlSeconds }, db);
  const mk = async (n: number) => {
    const rows = await a.task.createManyAndReturn({ data: Array.from({ length: n }, (_, i) => ({ title: `${tag} ${i}` })), select: { id: true } });
    taskIds.push(...rows.map((r) => r.id));
    return rows.map((r) => r.id);
  };

  beforeAll(() => {
    a = new PrismaClient();
    b = new PrismaClient();
  });
  afterAll(async () => {
    await a.task.deleteMany({ where: { id: { in: taskIds } } });
    await a.$disconnect();
    await b.$disconnect();
  });

  it(`${ROUNDS} rounds: exactly one winner, the loser sees the winner's holder`, async () => {
    const ids = await mk(ROUNDS);
    const bad: string[] = [];
    for (const [i, id] of ids.entries()) {
      const [ra, rb] = await Promise.all([claim(a, id, 'holder-A'), claim(b, id, 'holder-B')]);
      const winners = [ra, rb].filter((r) => r.ok).length;
      if (winners !== 1) {
        bad.push(`round ${i}: ${winners} winners`);
        continue;
      }
      const loser = ra.ok ? rb : ra;
      const winnerHolder = ra.ok ? 'holder-A' : 'holder-B';
      if (loser.ok || loser.reason !== 'taken' || loser.holder !== winnerHolder) bad.push(`round ${i}: loser did not see ${winnerHolder}`);
    }
    expect(bad, bad.slice(0, 5).join('; ')).toEqual([]);
  }, 120_000);

  it.skipIf(NAIVE)('renew with a wrong token fails; the right token extends', async () => {
    const [id] = await mk(1);
    const r = await claimTask({ taskId: id, holder: 'h1', ttlSeconds: 60 }, a);
    if (!r.ok) throw new Error('claim failed');
    expect(await renewClaim({ taskId: id, token: crypto.randomUUID(), ttlSeconds: 600 }, b)).toBeNull();
    expect(await renewClaim({ taskId: id, token: 'not-a-uuid', ttlSeconds: 600 }, b)).toBeNull();
    const renewed = await renewClaim({ taskId: id, token: r.claim.token, ttlSeconds: 600 }, b);
    expect(renewed).not.toBeNull();
    expect(renewed!.lease_until.getTime()).toBeGreaterThan(r.claim.lease_until.getTime() + 400_000);
  });

  it.skipIf(NAIVE)('wrong-token release is a no-op; the right token releases', async () => {
    const [id] = await mk(1);
    const r = await claimTask({ taskId: id, holder: 'h1' }, a);
    if (!r.ok) throw new Error('claim failed');
    expect(await releaseClaim({ taskId: id, token: crypto.randomUUID() }, b)).toBe(false);
    expect((await getClaim(id, b))?.holder).toBe('h1');
    expect(await releaseClaim({ taskId: id, token: r.claim.token }, b)).toBe(true);
    expect((await getClaim(id, b))?.live).toBe(false);
  });

  it.skipIf(NAIVE)('a lapsed lease lets B claim; a live lease does not', async () => {
    const [id] = await mk(1);
    const first = await claimTask({ taskId: id, holder: 'A' }, a);
    if (!first.ok) throw new Error('claim failed');
    const blocked = await claimTask({ taskId: id, holder: 'B' }, b);
    expect(blocked.ok).toBe(false);
    // The TTL floor is 60 s, so expire the lease in the table (a 1 s lease cannot be requested through the API).
    await a.$executeRaw`UPDATE tasks SET lease_until = (now() AT TIME ZONE 'UTC') + interval '1 second' WHERE id = ${id}::uuid`;
    await new Promise((res) => setTimeout(res, 1500));
    const second = await claimTask({ taskId: id, holder: 'B' }, b);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.claim.token).not.toBe(first.claim.token);
    // A's old token is dead.
    expect(await renewClaim({ taskId: id, token: first.claim.token }, a)).toBeNull();
  });

  it.skipIf(NAIVE)('same holder retries keep the token; a claim leaves the status alone; closed tasks refuse', async () => {
    const [id] = await mk(1);
    const one = await claimTask({ taskId: id, holder: 'A' }, a);
    const two = await claimTask({ taskId: id, holder: 'A' }, b);
    if (!one.ok || !two.ok) throw new Error('claim failed');
    expect(two.claim.token).toBe(one.claim.token);
    // A claim never touches the status.
    expect((await a.task.findUniqueOrThrow({ where: { id } })).status).toBe('not_started');
    await a.task.update({ where: { id }, data: { status: 'done' } });
    const closed = await claimTask({ taskId: id, holder: 'C' }, b);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.reason).toBe('closed');
  });
});
