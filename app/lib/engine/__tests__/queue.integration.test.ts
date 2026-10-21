import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  abandonJob, claimNextJob, enqueueJob, expireStaleJobs, failJob, heartbeatJob, isLive, markJobDone,
  LEASE_MS, QUEUE_EXPIRY_MS, activeConversationCount,
} from '../queue';
import { cleanup, SCRATCH, seedClient, type Seeded } from './seed';

// Phase C slice C1: the engine queue against a real Postgres (claim races need real row locks).
describe.skipIf(!SCRATCH)('engine queue (real database)', () => {
  const tag = `q${Date.now()}`;
  let a: Seeded;
  let b: Seeded;
  const input = (s: Seeded, now?: Date) => ({
    type: 'chat_reply' as const, conversationId: s.conversationId, taskId: s.taskId, clientId: s.clientId, contactId: s.ownerId, now,
  });

  beforeAll(async () => {
    a = await seedClient(`${tag}a`);
    b = await seedClient(`${tag}b`);
  });
  afterAll(async () => {
    await cleanup([a, b]);
    await prisma.$disconnect();
  });

  it('a second message folds into the waiting job; the conversation counts one job', async () => {
    const first = await enqueueJob({ ...input(a), upToCommentId: 'c1' });
    const second = await enqueueJob({ ...input(a), upToCommentId: 'c2' });
    expect(first.absorbed).toBe(false);
    expect(second.absorbed).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect((second.job.payload as { up_to_comment_id: string }).up_to_comment_id).toBe('c2');
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } })).jobs_count).toBe(1);
    const claimed = await claimNextJob({ types: ['chat_reply'] });
    expect(claimed?.id).toBe(first.job.id);
    await markJobDone(first.job.id, 'pass');
  });

  it('two claimers at once never get the same job', async () => {
    await enqueueJob(input(a));
    const results = await Promise.all([claimNextJob(), claimNextJob(), claimNextJob()]);
    const got = results.filter(Boolean);
    expect(got).toHaveLength(1);
    expect(got[0]!.status).toBe('claimed');
    expect(got[0]!.attempts).toBe(1);
    expect(got[0]!.lease_until!.getTime() - got[0]!.claimed_at!.getTime()).toBe(LEASE_MS);
    await markJobDone(got[0]!.id, 'pass');
  });

  it('a follow-up queued behind a claimed job waits until that job is finished', async () => {
    const one = await enqueueJob(input(a));
    const claimed = await claimNextJob();
    expect(claimed?.id).toBe(one.job.id);
    const two = await enqueueJob(input(a));
    expect(two.absorbed).toBe(false);
    expect(two.job.id).not.toBe(one.job.id);
    // The conversation still has a live job: the follow-up is not handed out.
    expect(await claimNextJob()).toBeNull();
    await markJobDone(one.job.id, 'pass');
    const next = await claimNextJob();
    expect(next?.id).toBe(two.job.id);
    await markJobDone(two.job.id, 'pass');
  });

  it('other conversations are not blocked by a claimed job', async () => {
    const x = await enqueueJob(input(a));
    const y = await enqueueJob(input(b));
    const c1 = await claimNextJob();
    const c2 = await claimNextJob();
    expect([c1?.id, c2?.id].sort()).toEqual([x.job.id, y.job.id].sort());
    await markJobDone(x.job.id, 'pass');
    await markJobDone(y.job.id, 'pass');
  });

  it('claims oldest first and honors the type filter', async () => {
    const t0 = new Date();
    const email = await enqueueJob({ ...input(b, new Date(t0.getTime() - 5000)), type: 'chat_email_reply' });
    const chat = await enqueueJob({ ...input(a, new Date(t0.getTime() - 1000)) });
    const onlyChat = await claimNextJob({ types: ['chat_reply'] });
    expect(onlyChat?.id).toBe(chat.job.id);
    const rest = await claimNextJob();
    expect(rest?.id).toBe(email.job.id);
    await markJobDone(chat.job.id, 'pass');
    await markJobDone(email.job.id, 'pass');
  });

  it('a job queued over 60 seconds ago is not claimed; the poll expires it and the conversation goes to tree mode', async () => {
    const old = new Date(Date.now() - QUEUE_EXPIRY_MS - 1000);
    const j = await enqueueJob(input(a, old));
    expect(await claimNextJob()).toBeNull();
    const ids = await expireStaleJobs(new Date(), { conversationId: a.conversationId });
    expect(ids).toContain(j.job.id);
    const row = await prisma.engineJob.findUniqueOrThrow({ where: { id: j.job.id } });
    expect(row.status).toBe('expired');
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } })).mode).toBe('tree');
  });

  it('a result for an expired job is refused (the 409), and a later success returns to model mode', async () => {
    const j = await enqueueJob(input(a));
    const claimed = (await claimNextJob())!;
    const later = new Date(Date.now() + LEASE_MS + 5000);
    expect(isLive(claimed, later)).toBe(false);
    await expireStaleJobs(later);
    expect(await markJobDone(j.job.id, 'pass', null, later)).toBe(false);
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } })).mode).toBe('tree');

    const k = await enqueueJob(input(a));
    const c = (await claimNextJob())!;
    expect(c.id).toBe(k.job.id);
    expect(await markJobDone(c.id, 'pass')).toBe(true);
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } })).mode).toBe('model');
  });

  it('heartbeat extends the lease by 60 seconds, twice, then refuses', async () => {
    const j = await enqueueJob(input(a));
    const c = (await claimNextJob())!;
    const r1 = await heartbeatJob(c.id);
    const r2 = await heartbeatJob(c.id);
    const r3 = await heartbeatJob(c.id);
    expect(r1.ok && r1.lease_until.getTime() - c.lease_until!.getTime()).toBe(60_000);
    expect(r2.ok && r2.lease_until.getTime() - c.lease_until!.getTime()).toBe(120_000);
    expect(r3).toEqual({ ok: false, reason: 'limit' });
    expect(await heartbeatJob('00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, reason: 'not_found' });
    await markJobDone(j.job.id, 'pass');
    expect(await heartbeatJob(c.id)).toEqual({ ok: false, reason: 'not_live' });
  });

  it('fail requeues once, then the job is failed and the conversation runs the tree', async () => {
    const j = await enqueueJob(input(a));
    const c1 = (await claimNextJob())!;
    expect(await failJob(c1.id, 'boom')).toBe('requeued');
    const c2 = (await claimNextJob())!;
    expect(c2.id).toBe(j.job.id);
    expect(c2.attempts).toBe(2);
    expect(await failJob(c2.id, 'boom again')).toBe('failed');
    expect((await prisma.engineJob.findUniqueOrThrow({ where: { id: j.job.id } })).status).toBe('failed');
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } })).mode).toBe('tree');
    expect(await failJob(c2.id, 'again')).toBe('gone');
  });

  it('abandon closes the job and flips the conversation', async () => {
    const j = await enqueueJob(input(b));
    const c = (await claimNextJob())!;
    await abandonJob(c.id, 'no_access');
    expect((await prisma.engineJob.findUniqueOrThrow({ where: { id: j.job.id } })).status).toBe('failed');
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: b.conversationId } })).mode).toBe('tree');
  });

  it('one queued job per conversation whatever its type: an email reply folds into a waiting chat job', async () => {
    const chat = await enqueueJob(input(a));
    const email = await enqueueJob({ ...input(a), type: 'chat_email_reply', upToCommentId: 'e1' });
    expect(email.absorbed).toBe(true);
    expect(email.job.id).toBe(chat.job.id);
    expect(await prisma.engineJob.count({ where: { conversation_id: a.conversationId, status: 'queued' } })).toBe(1);
    const c = (await claimNextJob())!;
    await markJobDone(c.id, 'pass');
  });

  it('the database refuses a second claimed job in one conversation', async () => {
    await enqueueJob(input(a));
    const c = (await claimNextJob())!;
    await expect(
      prisma.engineJob.create({ data: { type: 'chat_reply', status: 'claimed', conversation_id: a.conversationId, client_id: a.clientId, claimed_at: new Date(), lease_until: new Date(Date.now() + 1000) } })
    ).rejects.toMatchObject({ code: 'P2002' });
    // A claimed job whose lease lapsed still blocks a claim until it is expired, so the index cannot be hit.
    await prisma.engineJob.update({ where: { id: c.id }, data: { lease_until: new Date(Date.now() - 1000) } });
    await enqueueJob(input(a));
    expect(await claimNextJob()).toBeNull();
    await expireStaleJobs();
    await prisma.engineJob.updateMany({ where: { conversation_id: a.conversationId, status: 'queued' }, data: { status: 'done' } });
  });

  it('many claimers over many conversations never double-claim one conversation', async () => {
    await prisma.engineJob.updateMany({ where: { client_id: { in: [a.clientId, b.clientId] }, status: { in: ['queued', 'claimed'] } }, data: { status: 'done' } });
    await enqueueJob(input(a));
    const first = (await claimNextJob())!;
    await enqueueJob(input(a)); // follow-up behind the claimed job
    await enqueueJob(input(b));
    const got = (await Promise.all([claimNextJob(), claimNextJob(), claimNextJob(), claimNextJob()])).filter(Boolean);
    expect(got.map((j) => j!.conversation_id)).toEqual([b.conversationId]);
    await markJobDone(first.id, 'pass');
    await markJobDone(got[0]!.id, 'pass');
    const rest = await claimNextJob();
    expect(rest?.conversation_id).toBe(a.conversationId);
    await markJobDone(rest!.id, 'pass');
  });

  it('counts conversations with a client message in the last five minutes', async () => {
    const before = await activeConversationCount();
    await prisma.comment.create({ data: { task_id: b.taskId, author_contact_id: b.ownerId, content: 'hello', client_visible: true, source: 'portal' } });
    expect(await activeConversationCount()).toBe(before + 1);
    expect(await activeConversationCount(new Date(Date.now() + 6 * 60_000))).toBeLessThanOrEqual(before);
  });
});
