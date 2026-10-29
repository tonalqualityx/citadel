import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { createOrGetSession, transitionSession } from '../sessions';
import { appendDesignerEvent, appendWorkerEvents, feed, pendingDesignerEvents, MAX_EVENT_PAYLOAD_BYTES } from '../events';
import { raiseBudget, monthSpend, budgetStatus } from '../budget';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';

describe.skipIf(!SCRATCH)('events and budget (real database)', () => {
  let f: DesignFixture;
  const mkSession = async () => {
    const { session } = await createOrGetSession(f.designer, await seedTask(f));
    await transitionSession(session.id, 'awaiting_input', 'worker');
    return session;
  };
  beforeAll(async () => {
    f = await seedDesign(`ev${Date.now()}`);
  });
  afterAll(async () => {
    await teardownDesign(f);
    await prisma.$disconnect();
  });

  it('20 parallel appends (mixed designer and worker) produce seqs 1..20 with no gap', async () => {
    const s = await mkSession();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0
          ? appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'text', payload: { text: `m${i}` }, clientRef: `ref-${i}` })
          : appendWorkerEvents(s.id, { events: [{ role: 'assistant', kind: 'text', payload: { text: `a${i}` } }] }),
      ),
    );
    const rows = await prisma.designEvent.findMany({ where: { session_id: s.id }, orderBy: { seq: 'asc' }, select: { seq: true } });
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: s.id } })).last_seq).toBe(20);
  });

  it('batches allocate contiguous blocks under concurrency', async () => {
    const s = await mkSession();
    await Promise.all(Array.from({ length: 6 }, () => appendWorkerEvents(s.id, { events: Array.from({ length: 5 }, () => ({ role: 'tool' as const, kind: 'result' as const, payload: { ok: true } })) })));
    const seqs = (await prisma.designEvent.findMany({ where: { session_id: s.id }, orderBy: { seq: 'asc' }, select: { seq: true } })).map((r) => r.seq);
    expect(seqs).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('same client_ref twice is a no-op returning the first seq', async () => {
    const s = await mkSession();
    const a = await appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'hi' }, clientRef: 'dup' });
    const b = await appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'hi' }, clientRef: 'dup' });
    expect(b).toEqual({ seq: a.seq, duplicate: true });
    expect(await prisma.designEvent.count({ where: { session_id: s.id } })).toBe(1);
  });

  it('designer events start pending; the worker ack sets delivered_at once; held statuses are not in the inbox', async () => {
    const s = await mkSession();
    const { seq } = await appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'steer' }, clientRef: 'p1' });
    expect((await pendingDesignerEvents(200)).some((m) => m.session_id === s.id && m.seq === seq)).toBe(true);
    await transitionSession(s.id, 'paused_budget', 'server');
    expect((await pendingDesignerEvents(200)).some((m) => m.session_id === s.id)).toBe(false);
    await transitionSession(s.id, 'awaiting_input', 'worker');
    const r1 = await appendWorkerEvents(s.id, { acks: [seq], events: [{ role: 'system', kind: 'status', payload: { text: 'Got it' } }] });
    expect(r1.acked).toBe(1);
    expect((await appendWorkerEvents(s.id, { acks: [seq] })).acked).toBe(0);
    expect((await pendingDesignerEvents(200)).some((m) => m.session_id === s.id)).toBe(false);
    expect((await prisma.designEvent.findFirstOrThrow({ where: { session_id: s.id, seq } })).delivered_at).not.toBeNull();
  });

  it('caps: 32 KB payload, 20 KB text, 100 per batch, bad worker role; closed session refuses designer events', async () => {
    const s = await mkSession();
    await expect(appendWorkerEvents(s.id, { events: [{ role: 'tool', kind: 'result', payload: { blob: 'x'.repeat(MAX_EVENT_PAYLOAD_BYTES) } }] })).rejects.toMatchObject({ statusCode: 413 });
    await expect(appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'x'.repeat(21 * 1024) }, clientRef: 'big' })).rejects.toMatchObject({ statusCode: 413 });
    await expect(appendWorkerEvents(s.id, { events: Array.from({ length: 101 }, () => ({ role: 'tool' as const, kind: 'result' as const, payload: {} })) })).rejects.toMatchObject({ statusCode: 413 });
    await expect(appendWorkerEvents(s.id, { events: [{ role: 'designer' as never, kind: 'text', payload: {} }] })).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.designEvent.count({ where: { session_id: s.id } })).toBe(0);
    await transitionSession(s.id, 'abandoned', 'worker');
    await expect(appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'late' }, clientRef: 'late' })).rejects.toMatchObject({ code: 'session_closed' });
  });

  it('feed cursor never skips while appends run concurrently', async () => {
    const s = await mkSession();
    let done = false;
    const writers = Promise.all(
      Array.from({ length: 4 }, async (_, w) => {
        for (let i = 0; i < 15; i++) await appendWorkerEvents(s.id, { events: [{ role: 'assistant', kind: 'text', payload: { text: `w${w}-${i}` } }] });
      }),
    ).then(() => { done = true; });
    const seen: number[] = [];
    let cursor = 0;
    while (!done || (await feed(s.id, { after: cursor, limit: 7 })).events.length > 0) {
      const r = await feed(s.id, { after: cursor, limit: 7 });
      for (const e of r.events) seen.push(e.seq);
      cursor = r.last_seq;
    }
    await writers;
    expect(seen).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  }, 60_000);

  it('budget: month spend from cost events, ceiling predicate, raise caps and auto-resume', async () => {
    const s = await mkSession();
    await appendWorkerEvents(s.id, { events: [
      { role: 'system', kind: 'cost', payload: { turn_usd: 1.25, total_usd: 1.25, budget_usd: 25 } },
      { role: 'system', kind: 'cost', payload: { turn_usd: 2, total_usd: 3.25, budget_usd: 25 } },
      { role: 'system', kind: 'cost', payload: { turn_usd: 'junk' } },
    ] });
    expect(await monthSpend(f.designer.userId)).toBeCloseTo(3.25, 4);
    await prisma.designSession.update({ where: { id: s.id }, data: { cost_usd: 25 } });
    expect((await budgetStatus(await prisma.designSession.findUniqueOrThrow({ where: { id: s.id } }))).reason).toBe('session_ceiling');
    await prisma.designBudget.upsert({ where: { user_id: f.designer.userId }, update: { monthly_cap_usd: 3 }, create: { user_id: f.designer.userId, monthly_cap_usd: 3 } });
    expect((await budgetStatus({ designer_id: f.designer.userId, cost_usd: 1 as never, budget_usd: 25 as never })).reason).toBe('monthly_cap');
    await prisma.designBudget.update({ where: { user_id: f.designer.userId }, data: { monthly_cap_usd: null } });

    await transitionSession(s.id, 'paused_budget', 'server');
    await expect(raiseBudget(f.designer, s.id, 25)).rejects.toMatchObject({ code: 'not_a_raise' });
    await expect(raiseBudget(f.designer, s.id, 60)).rejects.toMatchObject({ code: 'raise_cap' });
    await expect(raiseBudget(f.other, s.id, 30)).rejects.toMatchObject({ statusCode: 404 });
    const r = await raiseBudget(f.designer, s.id, 40);
    expect(Number(r.session.budget_usd)).toBe(40);
    expect(r.resume_command_id).not.toBeNull();
    const adm = await raiseBudget(f.admin, s.id, 150);
    expect(Number(adm.session.budget_usd)).toBe(150);
    await expect(raiseBudget(f.admin, s.id, 151)).rejects.toMatchObject({ code: 'raise_cap' });
  });
});
