import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { createOrGetSession, transitionSession } from '../sessions';
import { appendDesignerEvent, appendWorkerEvents, feed, pendingDesignerEvents, MAX_EVENT_PAYLOAD_BYTES, DESIGNER_MESSAGES_PER_MINUTE } from '../events';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';
import { seedWorld, teardownWorlds, type TrackWorld } from './track-world';

describe.skipIf(!SCRATCH)('events (real database)', () => {
  let f: DesignFixture;
  const mkSession = async () => {
    const { session } = await createOrGetSession(f.designer, await seedTask(f));
    await transitionSession(session.id, 'awaiting_input', 'worker');
    return session;
  };
  beforeAll(async () => {
    f = await seedDesign(`ev${Date.now()}`);
  });
  const worlds: TrackWorld[] = [];
  afterAll(async () => {
    await teardownWorlds(f, worlds);
    await teardownDesign(f);
    await prisma.$disconnect();
  });

  it('W8.2 H5: 30 designer messages a minute per session; the 31st is 429 and writes nothing; a repeat is still 200; it resets after the window', async () => {
    const s = await mkSession();
    const other = await mkSession();
    const send = (sessionId: string, i: number | string) =>
      appendDesignerEvent({ sessionId, authorId: f.designer.userId, kind: 'text', payload: { text: `m${i}` }, clientRef: `rl-${i}` });
    expect(DESIGNER_MESSAGES_PER_MINUTE).toBe(30);
    // 30 in parallel all land (the count is taken under the session row lock).
    const firsts = await Promise.all(Array.from({ length: 30 }, (_, i) => send(s.id, i)));
    expect(firsts.every((r) => !r.duplicate)).toBe(true);
    await expect(send(s.id, 30)).rejects.toMatchObject({ statusCode: 429, code: 'rate_limited' });
    expect(await prisma.designEvent.count({ where: { session_id: s.id, role: 'designer' } })).toBe(30);
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: s.id } })).last_seq).toBe(30);
    // A retry of an accepted message is answered from the stored row, never 429.
    expect(await send(s.id, 5)).toMatchObject({ duplicate: true });
    // Worker events do not count, and the limit is per session.
    await appendWorkerEvents(s.id, { events: [{ role: 'assistant', kind: 'text', payload: { text: 'ok' } }] });
    expect((await send(other.id, 'x')).duplicate).toBe(false);
    // An Apply counts like a message.
    await expect(
      appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'apply', payload: { pins: [] }, clientRef: 'rl-apply' }),
    ).rejects.toMatchObject({ statusCode: 429 });
    // The window rolls: once those 30 are older than a minute, she can send again.
    await prisma.designEvent.updateMany({ where: { session_id: s.id, role: 'designer' }, data: { created_at: new Date(Date.now() - 61_000) } });
    expect((await send(s.id, 31)).duplicate).toBe(false);
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
    await transitionSession(s.id, 'stopped', 'worker');
    expect((await pendingDesignerEvents(200)).some((m) => m.session_id === s.id)).toBe(false);
    await transitionSession(s.id, 'awaiting_input', 'worker');
    const r1 = await appendWorkerEvents(s.id, { acks: [seq], events: [{ role: 'system', kind: 'status', payload: { text: 'Got it' } }] });
    expect(r1.acked).toBe(1);
    expect((await appendWorkerEvents(s.id, { acks: [seq] })).acked).toBe(0);
    expect((await pendingDesignerEvents(200)).some((m) => m.session_id === s.id)).toBe(false);
    expect((await prisma.designEvent.findFirstOrThrow({ where: { session_id: s.id, seq } })).delivered_at).not.toBeNull();
  });

  it('v2: designer events are held while the track is busy and delivered once it is free; an untracked session is never held', async () => {
    const w = await seedWorld(f, 'busy');
    worlds.push(w);
    const slug = 'qazwsxedcrfvtgby';
    const track = await prisma.designTrack.create({ data: { site_id: w.siteId, project_id: w.projectId, slug, stage: 'refine', branch: `design/t-${slug}`, preview_alias: `design-t-${slug}` } });
    const { session: ts } = await createOrGetSession(f.designer, w.t.refine);
    await transitionSession(ts.id, 'awaiting_input', 'worker');
    const plain = await mkSession();
    const inbox = async () => (await pendingDesignerEvents(200)).filter((m) => m.session_id === ts.id || m.session_id === plain.id);

    const a = await appendDesignerEvent({ sessionId: ts.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'before' }, clientRef: 'tb1' });
    const p = await appendDesignerEvent({ sessionId: plain.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'plain' }, clientRef: 'pb1' });
    expect((await inbox()).map((m) => m.seq).sort()).toEqual([a.seq, p.seq].sort());

    // the track turns busy: events stored before AND during are held, not lost; the untracked session still delivers
    const job = await prisma.designJob.create({ data: { track_id: track.id, kind: 'rest_build', status: 'running', payload: {} } });
    await prisma.designTrack.update({ where: { id: track.id }, data: { busy_job_id: job.id, stage: 'rest_build' } });
    const b = await appendDesignerEvent({ sessionId: ts.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'during' }, clientRef: 'tb2' });
    expect((await inbox()).filter((m) => m.session_id === ts.id)).toEqual([]);
    expect((await inbox()).filter((m) => m.session_id === plain.id).map((m) => m.seq)).toEqual([p.seq]);
    expect(await prisma.designEvent.count({ where: { session_id: ts.id, role: 'designer', delivered_at: null } })).toBe(2);

    // free again: both go out, oldest first
    await prisma.designTrack.update({ where: { id: track.id }, data: { busy_job_id: null, stage: 'refine' } });
    expect((await inbox()).filter((m) => m.session_id === ts.id).map((m) => m.seq)).toEqual([a.seq, b.seq]);
    await prisma.designJob.delete({ where: { id: job.id } });
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

  it('cost never gates: a session far over its old ceiling and monthly spend still takes a message and is not paused', async () => {
    const s = await mkSession();
    await appendWorkerEvents(s.id, { events: [{ role: 'system', kind: 'cost', payload: { turn_usd: 400, total_usd: 400, budget_usd: 25 } }] });
    await prisma.designSession.update({ where: { id: s.id }, data: { cost_usd: 400 } });
    const { seq } = await appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'keep going' }, clientRef: 'over-1' });
    expect((await pendingDesignerEvents(200)).some((m) => m.session_id === s.id && m.seq === seq)).toBe(true);
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('awaiting_input');
    // A session left in the legacy paused_budget status behaves like awaiting_input: delivered, and resumable.
    await transitionSession(s.id, 'paused_budget', 'worker');
    const again = await appendDesignerEvent({ sessionId: s.id, authorId: f.designer.userId, kind: 'text', payload: { text: 'still here' }, clientRef: 'over-2' });
    expect((await pendingDesignerEvents(200)).some((m) => m.session_id === s.id && m.seq === again.seq)).toBe(true);
    await transitionSession(s.id, 'awaiting_input', 'server');
  });
});
