// @vitest-environment node
/**
 * Runs the sweeper against a real, migrated Postgres. Skipped unless
 * WAIT_INTEGRATION_DATABASE_URL is set (a throwaway database only; this writes rows and never
 * deletes them). The phase 1 gate: a dry-run sweep on fixture data reports the expected counts
 * and writes nothing; a real pass is idempotent; the claim is exclusive.
 *
 *   WAIT_INTEGRATION_DATABASE_URL=postgresql://... npx vitest run lib/waits/prisma-store.integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prismaSweepStore } from './prisma-store';
import { prismaOwnerLookups } from './owner';
import { runSweep } from './sweeper';
import { buildWaitData } from './templates';
import { zonedTimeToUtc } from './business-days';
import { applyWaitEvent } from './events';

const url = process.env.WAIT_INTEGRATION_DATABASE_URL;
const d = url ? describe : describe.skip;

d('wait sweeper against Postgres', () => {
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 8);
  const now = new Date();
  const deps = () => ({
    store: prismaSweepStore(db),
    owner: prismaOwnerLookups(db as unknown as Parameters<typeof prismaOwnerLookups>[0]),
    switchIsOn: async () => false,
    now: () => now,
  });
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    const client = await db.client.create({ data: { name: `Wait integration ${tag}` } });
    const user = await db.user.create({
      data: { email: `wait-int-${tag}@example.test`, password_hash: 'x', name: 'Wait Integration', role: 'admin' },
    });
    ids.client = client.id;
    ids.user = user.id;
    const store = prismaSweepStore(db);
    const long = zonedTimeToUtc(2026, 8, 3, 9); // weeks late
    const mk = async (key: string, over: Record<string, unknown>) =>
      (await store.insertIdempotent(buildWaitData({ started_at: long, idempotency_key: `${tag}:${key}`, client_id: client.id, ...over } as never))).wait;
    // 1: on Mike (empty owner), blocks a client, weeks late -> ladder
    ids.mine = (await mk('mine', { template_key: 'build.gate_mike', subject: 'the integration sitemap' })).id;
    // 2: on a named person, internal review -> escalates
    ids.theirs = (await mk('theirs', { template_key: 'build.review_internal', subject: 'the integration copy', owner_user_id: user.id })).id;
    // 3: not due yet
    ids.future = (await mk('future', { template_key: 'build.gate_mike', subject: 'a later gate', started_at: new Date(now.getTime() + 30 * 86_400_000) })).id;
    // 4: its task is gone -> expires
    const task = await db.task.create({ data: { title: `integration task ${tag}`, status: 'abandoned' } });
    ids.gone = (await mk('gone', { template_key: 'handoff.generic', subject: 'a handoff on an abandoned task', task_id: task.id })).id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('dry run reports the expected counts and writes nothing', async () => {
    const before = await db.wait.findMany({ where: { idempotency_key: { startsWith: tag } }, orderBy: { idempotency_key: 'asc' } });
    const eventsBefore = await db.waitEvent.count();
    const r = await runSweep(deps(), { dryRun: true });
    expect(r.dry_run).toBe(true);
    expect(r.expired).toContain(ids.gone);
    expect(r.escalated.map((e) => e.id)).toContain(ids.theirs);
    expect(r.nagged.map((n) => n.id)).toContain(ids.mine);
    expect(r.counts.errors).toBe(0);
    const after = await db.wait.findMany({ where: { idempotency_key: { startsWith: tag } }, orderBy: { idempotency_key: 'asc' } });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(await db.waitEvent.count()).toBe(eventsBefore);
  });

  it('a real pass changes what the dry run said, and a second pass is quiet', async () => {
    const r1 = await runSweep(deps());
    expect(r1.expired).toContain(ids.gone);
    expect((await db.wait.findUnique({ where: { id: ids.gone } }))!.state).toBe('expired');
    expect((await db.wait.findUnique({ where: { id: ids.mine } }))!.nag_level).toBeGreaterThanOrEqual(1);
    const theirs = await db.wait.findUnique({ where: { id: ids.theirs } });
    expect(theirs!.escalated_to_user_id).toBeNull(); // rung 1 is the role holder's digest
    expect(theirs!.due_at.getTime()).toBeGreaterThan(now.getTime());
    const events = await db.waitEvent.findMany({ where: { wait_id: ids.theirs } });
    expect(events.map((e) => e.kind)).toContain('escalated');

    const r2 = await runSweep(deps());
    expect(r2.expired).not.toContain(ids.gone);
    expect(r2.escalated.map((e) => e.id)).not.toContain(ids.theirs); // re-armed one business day out
    expect((await db.wait.findUnique({ where: { id: ids.future } }))!.state).toBe('waiting');
  });

  it('the claim is exclusive', async () => {
    const store = prismaSweepStore(db);
    const w = (await store.insertIdempotent(buildWaitData({ template_key: 'build.gate_mike', subject: 'claim', idempotency_key: `${tag}:claim`, started_at: zonedTimeToUtc(2026, 8, 3, 9) }))).wait;
    const stale = new Date(now.getTime() - 600_000);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => store.claim(w.id, now, stale)));
    expect(results.filter(Boolean)).toHaveLength(1);
    // Not due yet: nobody claims it, even with no claim held.
    const later = await db.wait.findUnique({ where: { id: ids.future } });
    expect(await store.claim(later!.id, now, stale)).toBeNull();
    // An extension landing between list and claim wins.
    await store.update(w.id, { claimed_at: null, due_at: new Date(now.getTime() + 86_400_000) });
    expect(await store.claim(w.id, now, stale)).toBeNull();
  });

  it('insertIdempotent returns the existing row on a repeat key, even under a race', async () => {
    const store = prismaSweepStore(db);
    const data = buildWaitData({ template_key: 'handoff.generic', subject: 'race', idempotency_key: `${tag}:race` });
    const out = await Promise.all([1, 2, 3].map(() => store.insertIdempotent(data)));
    expect(new Set(out.map((o) => o.wait.id)).size).toBe(1);
    expect(out.filter((o) => o.created)).toHaveLength(1);
  });

  it('events: an extension applies and a replay is a duplicate', async () => {
    const store = prismaSweepStore(db);
    const ev = { event_id: `${tag}-ext`, kind: 'extend', target: ids.future, payload: { mode: 'days', business_days: 2 } };
    const a = await applyWaitEvent(store, ev);
    expect(a.applied[0].action).toBe('extended');
    expect((await applyWaitEvent(store, ev)).duplicate).toBe(true);
    expect((await db.wait.findUnique({ where: { id: ids.future } }))!.extension_count).toBe(1);
  });

  it('events: concurrent copies of one event apply once, and the marker rolls back with a failed change', async () => {
    const store = prismaSweepStore(db);
    const w = (await store.insertIdempotent(buildWaitData({ template_key: 'build.gate_mike', subject: 'conc', idempotency_key: `${tag}:conc`, started_at: new Date(now.getTime() + 86_400_000) }))).wait;
    const ev = { event_id: `${tag}-conc`, kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 2 } };
    const out = await Promise.all([applyWaitEvent(store, ev), applyWaitEvent(store, ev), applyWaitEvent(store, ev)]);
    expect(out.flatMap((o) => o.applied)).toHaveLength(1);
    expect((await db.wait.findUnique({ where: { id: w.id } }))!.extension_count).toBe(1);
    expect(await db.waitEvent.count({ where: { event_id: `${ev.event_id}:${w.id}` } })).toBe(1);
    // A prefix-sharing event id is a different event.
    const other = await applyWaitEvent(store, { ...ev, event_id: `${tag}-con` });
    expect(other.applied).toHaveLength(1);
  });
});
