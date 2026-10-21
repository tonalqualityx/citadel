/**
 * The engine queue (phase C spec 4.1). Citadel stores the work; a runner on the Bast machine claims
 * it over a bearer-protected API. Nothing here calls a model.
 *
 * - enqueue: one open (queued) job per conversation; later messages are absorbed into it. A job that
 *   is already claimed gets a follow-up queued behind it (the claim skips a conversation whose
 *   earlier job is still being worked).
 * - claim: oldest queued job, FOR UPDATE SKIP LOCKED, lease 120 seconds.
 * - heartbeat: +60 seconds, at most twice.
 * - expire: queued for over 60 seconds, or claimed with a lapsed lease. The conversation flips to
 *   tree mode (spec 1.7); the run on the machine, if any, gets a 409 when it posts.
 * - done / fail: the status transitions `complete` and `fail` (slice C2) call; fail requeues once.
 */
import { Prisma, type EngineJob } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export const QUEUE_EXPIRY_MS = 60_000;
export const LEASE_MS = 120_000;
export const HEARTBEAT_MS = 60_000;
export const MAX_HEARTBEATS = 2;
export const MAX_ATTEMPTS = 2;
export const ACTIVE_WINDOW_MS = 5 * 60_000;
export const JOB_TYPES = ['chat_reply', 'chat_email_reply'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface EnqueueInput {
  type: JobType;
  conversationId: string;
  taskId: string;
  clientId: string;
  contactId: string;
  /** The newest comment this job should answer. */
  upToCommentId?: string | null;
  now?: Date;
}

/** Queue a job for a conversation, or fold the message into the one already waiting. */
export async function enqueueJob(input: EnqueueInput): Promise<{ job: EngineJob; absorbed: boolean }> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`engine-enqueue:${input.conversationId}`}))`;
    const waiting = await tx.engineJob.findFirst({
      where: { conversation_id: input.conversationId, status: 'queued', type: input.type },
      orderBy: { queued_at: 'asc' },
    });
    if (waiting) {
      const payload = { ...((waiting.payload as Record<string, unknown>) ?? {}), up_to_comment_id: input.upToCommentId ?? null };
      const job = await tx.engineJob.update({ where: { id: waiting.id }, data: { payload } });
      return { job, absorbed: true };
    }
    const job = await tx.engineJob.create({
      data: {
        type: input.type,
        conversation_id: input.conversationId,
        task_id: input.taskId,
        client_id: input.clientId,
        contact_id: input.contactId,
        payload: { up_to_comment_id: input.upToCommentId ?? null, heartbeats: 0 },
        queued_at: now,
      },
    });
    await tx.chatConversation.update({ where: { id: input.conversationId }, data: { jobs_count: { increment: 1 } } });
    return { job, absorbed: false };
  });
}

/**
 * Expire stale jobs and flip their conversations to tree mode. Run on the client's own poll and at
 * the start of every claim, so it works when the machine is down. Returns the expired job ids.
 */
export async function expireStaleJobs(now: Date = new Date(), opts: { conversationId?: string } = {}): Promise<string[]> {
  const queuedBefore = new Date(now.getTime() - QUEUE_EXPIRY_MS);
  const scope: Prisma.EngineJobWhereInput = opts.conversationId ? { conversation_id: opts.conversationId } : {};
  const stale = await prisma.engineJob.findMany({
    where: {
      AND: [
        scope,
        {
          OR: [
            { status: 'queued', queued_at: { lt: queuedBefore } },
            { status: 'claimed', lease_until: { lt: now } },
          ],
        },
      ],
    },
    select: { id: true, conversation_id: true },
  });
  if (stale.length === 0) return [];
  const ids = stale.map((s) => s.id);
  await prisma.$transaction([
    // Re-check the status in the write so a result that landed in between is not overwritten.
    prisma.engineJob.updateMany({
      where: { id: { in: ids }, status: { in: ['queued', 'claimed'] } },
      data: { status: 'expired', expired_at: now },
    }),
    prisma.chatConversation.updateMany({
      where: { id: { in: stale.map((s) => s.conversation_id).filter((c): c is string => Boolean(c)) } },
      data: { mode: 'tree' },
    }),
  ]);
  return ids;
}

/**
 * Claim the oldest queued job that is still fresh and whose conversation has no job in flight.
 * Two claimers never get the same row (FOR UPDATE SKIP LOCKED).
 */
export async function claimNextJob(opts: { types?: string[]; now?: Date } = {}): Promise<EngineJob | null> {
  const now = opts.now ?? new Date();
  const types = (opts.types?.length ? opts.types : [...JOB_TYPES]).filter((t) => (JOB_TYPES as readonly string[]).includes(t));
  if (types.length === 0) return null;
  const freshAfter = new Date(now.getTime() - QUEUE_EXPIRY_MS);
  const lease = new Date(now.getTime() + LEASE_MS);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT j.id FROM engine_jobs j
      WHERE j.status = 'queued'
        AND j.type = ANY(${types}::text[])
        AND j.queued_at > ${freshAfter}
        AND NOT EXISTS (
          SELECT 1 FROM engine_jobs c
          WHERE c.conversation_id IS NOT NULL
            AND c.conversation_id = j.conversation_id
            AND c.status = 'claimed'
            AND c.lease_until > ${now}
        )
      ORDER BY j.queued_at ASC
      LIMIT 1
      FOR UPDATE OF j SKIP LOCKED`;
    if (rows.length === 0) return null;
    return tx.engineJob.update({
      where: { id: rows[0].id },
      data: { status: 'claimed', claimed_at: now, lease_until: lease, attempts: { increment: 1 } },
    });
  });
}

/** True while the job is claimed and its lease has not lapsed: the only time the runner may read or log. */
export function isLive(job: Pick<EngineJob, 'status' | 'lease_until'>, now: Date = new Date()): boolean {
  return job.status === 'claimed' && job.lease_until !== null && job.lease_until > now;
}

export type HeartbeatResult = { ok: true; lease_until: Date } | { ok: false; reason: 'not_found' | 'not_live' | 'limit' };

export async function heartbeatJob(jobId: string, now: Date = new Date()): Promise<HeartbeatResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`engine-job:${jobId}`}))`;
    const job = await tx.engineJob.findUnique({ where: { id: jobId } });
    if (!job) return { ok: false as const, reason: 'not_found' as const };
    if (!isLive(job, now)) return { ok: false as const, reason: 'not_live' as const };
    const payload = (job.payload as Record<string, unknown>) ?? {};
    const beats = Number(payload.heartbeats ?? 0);
    if (beats >= MAX_HEARTBEATS) return { ok: false as const, reason: 'limit' as const };
    const lease = new Date((job.lease_until as Date).getTime() + HEARTBEAT_MS);
    await tx.engineJob.update({ where: { id: jobId }, data: { lease_until: lease, payload: { ...payload, heartbeats: beats + 1 } } });
    return { ok: true as const, lease_until: lease };
  });
}

/** Conversations the client touched in the last 5 minutes: the runner's poll pace (X-Engine-Active). */
export async function activeConversationCount(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const rows = await prisma.comment.findMany({
    where: { author_contact_id: { not: null }, created_at: { gte: since }, task: { chat_conversation: { isNot: null } } },
    distinct: ['task_id'],
    select: { task_id: true },
  });
  return rows.length;
}

/** The job finished and its result was applied. The conversation returns to model mode. */
export async function markJobDone(jobId: string, gateResult: 'pass' | 'regenerated' | 'canned', actionErrors: unknown = null, now: Date = new Date()): Promise<boolean> {
  const res = await prisma.engineJob.updateMany({
    where: { id: jobId, status: 'claimed', lease_until: { gt: now } },
    data: { status: 'done', finished_at: now, gate_result: gateResult, action_errors: (actionErrors ?? Prisma.JsonNull) as Prisma.InputJsonValue },
  });
  if (res.count === 0) return false;
  const job = await prisma.engineJob.findUnique({ where: { id: jobId }, select: { conversation_id: true } });
  if (job?.conversation_id) await prisma.chatConversation.update({ where: { id: job.conversation_id }, data: { mode: 'model' } });
  return true;
}

/** The runner failed the job: requeue it once, then mark it failed and send the conversation to tree mode. */
export async function failJob(jobId: string, error: string, now: Date = new Date()): Promise<'requeued' | 'failed' | 'gone'> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`engine-job:${jobId}`}))`;
    const job = await tx.engineJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'claimed') return 'gone' as const;
    if (job.attempts < MAX_ATTEMPTS) {
      await tx.engineJob.update({ where: { id: jobId }, data: { status: 'queued', claimed_at: null, lease_until: null, queued_at: now, error } });
      return 'requeued' as const;
    }
    await tx.engineJob.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now, error } });
    if (job.conversation_id) await tx.chatConversation.update({ where: { id: job.conversation_id }, data: { mode: 'tree' } });
    return 'failed' as const;
  });
}

/** The contact lost access between queueing and claiming: close the job and run the tree. */
export async function abandonJob(jobId: string, error: string, now: Date = new Date()): Promise<void> {
  const job = await prisma.engineJob.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now, error } });
  if (job.conversation_id) await prisma.chatConversation.update({ where: { id: job.conversation_id }, data: { mode: 'tree' } });
}
