/**
 * Fleet item 5: receipts, and the client's yes bound to the build they saw.
 *
 * A staged change leaves a trail of TaskReceipt rows: staged (what was built and where), approved (which
 * build the client said yes to, and through which door), approval_voided (the work was re-staged after the
 * yes), live (what went to production, and whether it is the approved build), send (a mail that went out).
 *
 * The approval travels with the preview. The task keeps staging_* (the build now on the preview) and
 * approved_* (the build the yes was given to). A re-stage after a yes, to a different preview address or a
 * different commit, voids the yes (Mike's ruling Q18), for portal and email approvals alike. Going live
 * compares the production commit to approved_commit_sha.
 *
 * Mode (AppSettings.approval_binding_mode): off = today's behavior (a re-stage after a yes is a 409, a PATCH
 * keeps the approval, /live never compares); warn = void and record, a build mismatch is recorded and
 * flagged but goes live; enforce = a mismatch is a 409 unless an admin forces it with a reason.
 *
 * This module imports no other portal module (portal.ts imports it), so tag changes are raw UPDATEs.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { clearPreviewClaims } from '@/lib/sends/claims';

export const BINDING_MODES = ['off', 'warn', 'enforce'] as const;
export type BindingMode = (typeof BINDING_MODES)[number];
const APPROVED_TAG = 'client-approved';

type Db = Pick<PrismaClient, 'task' | 'taskReceipt' | 'comment' | 'appSettings' | '$executeRaw'>;

export async function getApprovalBindingMode(db: Pick<PrismaClient, 'appSettings'> = defaultDb): Promise<BindingMode> {
  const s = await db.appSettings.findUnique({ where: { id: 'singleton' }, select: { approval_binding_mode: true } });
  const m = s?.approval_binding_mode;
  return (BINDING_MODES as readonly string[]).includes(m ?? '') ? (m as BindingMode) : 'warn';
}

export interface CheckEntry {
  name: string;
  ok: boolean;
  exit_code?: number;
  detail?: string;
  [k: string]: unknown;
}

export interface ReceiptInput {
  task_id: string;
  step: 'staged' | 'approved' | 'approval_voided' | 'live' | 'send' | 'send_dropped';
  commit_sha?: string | null;
  deploy_id?: string | null;
  deploy_url?: string | null;
  preview_url?: string | null;
  live_url?: string | null;
  live_check?: Prisma.InputJsonValue | null;
  checks?: CheckEntry[];
  message_ids?: string[];
  outbox_ids?: string[];
  approval_source?: string | null;
  mismatch?: boolean;
  actor_user_id?: string | null;
  claim_holder?: string | null;
}

export function receiptData(r: ReceiptInput): Prisma.TaskReceiptUncheckedCreateInput {
  return {
    task_id: r.task_id,
    step: r.step,
    commit_sha: r.commit_sha ?? null,
    deploy_id: r.deploy_id ?? null,
    deploy_url: r.deploy_url ?? null,
    preview_url: r.preview_url ?? null,
    live_url: r.live_url ?? null,
    live_check: r.live_check ?? Prisma.DbNull,
    checks: (r.checks ?? []) as unknown as Prisma.InputJsonValue,
    message_ids: r.message_ids ?? [],
    outbox_ids: r.outbox_ids ?? [],
    approval_source: r.approval_source ?? null,
    mismatch: r.mismatch ?? false,
    actor_user_id: r.actor_user_id ?? null,
    claim_holder: r.claim_holder ?? null,
  };
}

export async function writeReceipt(r: ReceiptInput, db: Pick<PrismaClient, 'taskReceipt'> = defaultDb) {
  return db.taskReceipt.create({ data: receiptData(r) });
}

/**
 * Item 4 dropped a send at the recheck: leave a send_dropped step on the task's trail (spec section 5, item 5, point 5).
 * `outboxId` is the outbox row when the drop was an outbox claim; the reason, intent and severity ride in live_check.
 * Never throws: a missing receipt must not turn a held-back send into an error.
 */
export async function writeSendDroppedReceipt(
  taskId: string,
  drop: { reason: string; intent: string; severity?: string | null; outboxId?: string | null; approvalRequestId?: string | null },
  db: Pick<PrismaClient, 'taskReceipt'> = defaultDb
): Promise<void> {
  try {
    await writeReceipt(
      {
        task_id: taskId,
        step: 'send_dropped',
        outbox_ids: drop.outboxId ? [drop.outboxId] : [],
        live_check: { reason: drop.reason, intent: drop.intent, severity: drop.severity ?? null, ...(drop.approvalRequestId ? { approval_request_id: drop.approvalRequestId } : {}) } as Prisma.InputJsonValue,
      },
      db
    );
  } catch (error) {
    console.error('send_dropped receipt failed', error);
  }
}

/** Where a yes came from: the portal, the emailed approval link, an email reply (`email:<Message-ID>`), or a bare API write (`api`). */
export function cleanApprovalSource(source: string | null | undefined): string {
  const s = (source ?? '').trim();
  if (s === 'portal' || s === 'approval_link' || s === 'api') return s;
  if (/^email:\S{1,280}$/.test(s)) return s;
  return 'api';
}

/**
 * The client said yes: copy the build on the preview to approved_* and write the approved receipt.
 * Call it right after the approval is stored. A task with no recorded build still gets the receipt (with
 * the preview address), so the trail shows the yes and what it was given to.
 */
export async function stampApproval(taskId: string, source: string, db: Db = defaultDb, actorUserId: string | null = null) {
  const t = await db.task.findUnique({
    where: { id: taskId },
    select: { staging_preview_url: true, staging_commit_sha: true, staging_deploy_id: true, staging_deploy_url: true, claim_holder: true },
  });
  if (!t) return null;
  await db.task.update({
    where: { id: taskId },
    data: { approved_preview_url: t.staging_preview_url, approved_commit_sha: t.staging_commit_sha, approved_deploy_id: t.staging_deploy_id },
  });
  return db.taskReceipt.create({
    data: receiptData({
      task_id: taskId,
      step: 'approved',
      commit_sha: t.staging_commit_sha,
      deploy_id: t.staging_deploy_id,
      deploy_url: t.staging_deploy_url,
      preview_url: t.staging_preview_url,
      approval_source: cleanApprovalSource(source),
      actor_user_id: actorUserId,
      claim_holder: t.claim_holder,
    }),
  });
}

export interface RestageTarget {
  previewUrl: string;
  commitSha?: string | null;
}

/** True when this stage is a different build from the one the yes was given to. Pure. */
export function isRestage(
  t: { staging_preview_url: string | null; approved_preview_url: string | null; approved_commit_sha: string | null },
  next: RestageTarget
): boolean {
  const baseUrl = t.approved_preview_url ?? t.staging_preview_url;
  if (baseUrl !== null && baseUrl !== next.previewUrl) return true;
  // Same address: it is only the same build when BOTH commits are known and equal. A stage that does not say
  // which build it is, or an approval that never recorded one, cannot be shown to be the build the client saw.
  if (!next.commitSha || !t.approved_commit_sha) return true;
  return !sameSha(next.commitSha, t.approved_commit_sha);
}

/** Case-insensitive commit compare; when one side is a short sha, compare as a prefix (7 characters at least). */
export function sameSha(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length < 7 || y.length < 7) return x === y;
  return x.length <= y.length ? y.startsWith(x) : x.startsWith(y);
}

export interface VoidResult {
  voided: boolean;
  /** The task is approved, the build did not change, and nothing was voided. */
  unchanged: boolean;
}

/**
 * Re-stage after a yes. If the task is approved (not done) and `next` is a different build from the approved
 * one, void the approval in ONE transaction: client_approved_at, approved_by_contact_id, the client-approved tag
 * and approved_* are cleared, an approval_voided receipt is written, and an internal comment says why.
 *
 * Never on a done task. The UPDATE itself carries `status <> 'done' AND approved = false`, so even a race with
 * /live cannot void a published task: if the guarded UPDATE touches no row, nothing else is written and the
 * call throws a 409.
 *
 * Mode off voids nothing and leaves the caller to decide (markStaged keeps its 409, PATCH keeps the approval).
 */
export async function voidApprovalIfRestaged(
  taskId: string,
  next: RestageTarget,
  ctx: { actorUserId: string; mode?: BindingMode; reason?: string },
  db: PrismaClient = defaultDb as PrismaClient
): Promise<VoidResult> {
  const mode = ctx.mode ?? (await getApprovalBindingMode(db));
  if (mode === 'off') return { voided: false, unchanged: false };
  const t = await db.task.findUnique({
    where: { id: taskId },
    select: {
      status: true, approved: true, client_approved_at: true, tags: true, claim_holder: true,
      staging_preview_url: true, approved_preview_url: true, approved_commit_sha: true, staging_commit_sha: true, staging_deploy_id: true, staging_deploy_url: true,
    },
  });
  if (!t) return { voided: false, unchanged: false };
  if (t.status === 'done' || t.approved) return { voided: false, unchanged: false };
  const isApproved = Boolean(t.client_approved_at) || t.tags.includes(APPROVED_TAG);
  if (!isApproved) return { voided: false, unchanged: false };
  if (!isRestage(t, next)) return { voided: false, unchanged: true };

  const voided = await db.$transaction(async (tx) => {
    const n = await tx.task.updateMany({
      where: { id: taskId, status: { not: 'done' }, approved: false },
      data: { client_approved_at: null, approved_by_contact_id: null, approved_preview_url: null, approved_commit_sha: null, approved_deploy_id: null },
    });
    if (n.count !== 1) return false;
    await tx.$executeRaw`UPDATE tasks SET tags = array_remove(tags, ${APPROVED_TAG}) WHERE id = ${taskId}::uuid`;
    // A voided approval means a new approval email must go out, even to the same preview address (a new commit):
    // spend the preview notice claims in the same transaction, so a rolled-back void leaves them alone.
    await clearPreviewClaims(taskId, tx);
    await tx.taskReceipt.create({
      data: receiptData({
        task_id: taskId,
        step: 'approval_voided',
        commit_sha: t.approved_commit_sha,
        preview_url: t.approved_preview_url ?? t.staging_preview_url,
        approval_source: null,
        actor_user_id: ctx.actorUserId,
        claim_holder: t.claim_holder,
        live_check: { new_preview_url: next.previewUrl, new_commit_sha: next.commitSha ?? null } as Prisma.InputJsonValue,
      }),
    });
    await tx.comment.create({
      data: {
        task_id: taskId,
        user_id: ctx.actorUserId,
        is_internal: true,
        content: `Approval voided: the work was staged again${ctx.reason ? ` (${ctx.reason})` : ''}. The client's yes was for ${t.approved_preview_url ?? t.staging_preview_url ?? 'an earlier preview'}${t.approved_commit_sha ? ` at ${t.approved_commit_sha.slice(0, 12)}` : ''}; the new preview is ${next.previewUrl}${next.commitSha ? ` at ${next.commitSha.slice(0, 12)}` : ''}. It needs a fresh yes.`,
      },
    });
    return true;
  });
  if (!voided) throw new ApiError('This task went live while it was being staged again. Nothing was changed.', 409, 'already_live');
  return { voided: true, unchanged: false };
}

/** The live build against the approved one. `unbound` = no approved commit was recorded, so there is nothing to compare. */
export function compareBuild(approvedCommit: string | null, liveCommit: string | null | undefined): { mismatch: boolean; unbound: boolean } {
  if (!approvedCommit) return { mismatch: false, unbound: true };
  if (!liveCommit) return { mismatch: true, unbound: false };
  return { mismatch: !sameSha(liveCommit, approvedCommit), unbound: false };
}

/** Request-body shape for a checks[] list (staged and live calls). */
export const checksSchema = z
  .array(z.object({ name: z.string().min(1).max(100), ok: z.boolean(), exit_code: z.number().int().optional(), detail: z.string().max(500).optional() }).passthrough())
  .max(60);
export const shaSchema = z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'must be a git commit sha');
