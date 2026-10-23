/**
 * Send-time recheck (Fleet item 4). Right before a message leaves, re-read the record it reports and
 * drop it when the state made it wrong. Pure reads, no side effects: `claimNotice` is the one write.
 *
 *   definitive  the fact is certain (the task is closed, the client already approved, the link expired)
 *   heuristic   a good guess (the preview address changed); policy.ts can run these in shadow only
 */
import { createHash } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { CLIENT_APPROVED_TAG } from '@/lib/services/portal';
import type { Govern } from './govern';

export const GO_LIVE_TAG = 'go-live-notified';
export const PREVIEW_TAG_PREFIX = 'preview-notified:';

export type Severity = 'definitive' | 'heuristic';
export type RecheckResult = { ok: true } | { ok: false; reason: string; severity: Severity };

const OK: RecheckResult = { ok: true };
const drop = (reason: string, severity: Severity = 'definitive'): RecheckResult => ({ ok: false, reason, severity });

const taskSelect = { id: true, is_deleted: true, status: true, client_approved_at: true, approved: true, tags: true, staging_preview_url: true } as const;

export async function recheckSend(govern: Govern, now: Date = new Date()): Promise<RecheckResult> {
  switch (govern.intent) {
    case 'none':
      return OK;

    case 'approval_request': {
      const t = await prisma.task.findUnique({ where: { id: govern.task_id }, select: taskSelect });
      if (!t || t.is_deleted || t.status === 'abandoned') return drop('task_closed');
      if (t.client_approved_at || t.tags.includes(CLIENT_APPROVED_TAG)) return drop('already_approved');
      if (t.status === 'done') return drop('already_live');
      const was = govern.snapshot?.preview_url ?? null;
      // Another channel already told the client about this preview (a producer holding the claim is exempt).
      if (was && !govern.snapshot?.claimed && t.tags.includes(previewTag(was))) return drop('already_notified');
      if (was && t.staging_preview_url && t.staging_preview_url !== was) return drop('preview_changed', 'heuristic');
      return OK;
    }

    case 'golive': {
      const t = await prisma.task.findUnique({ where: { id: govern.task_id }, select: taskSelect });
      if (!t || t.is_deleted || t.status === 'abandoned') return drop('task_reopened');
      if (govern.snapshot?.before_live) {
        // A worker's own note ahead of /live: the right state is "client approved" (or already done).
        if (t.status !== 'done' && !t.client_approved_at && !t.approved && !t.tags.includes(CLIENT_APPROVED_TAG)) return drop('not_approved');
      } else if (t.status !== 'done') return drop('task_reopened');
      // A row queued by the producer that took the claim is not "already notified" by its own claim.
      if (!govern.snapshot?.claimed && t.tags.includes(GO_LIVE_TAG)) return drop('already_notified');
      return OK;
    }

    case 'magic_link':
    case 'invite': {
      const exp = Date.parse(govern.snapshot.expires_at);
      if (Number.isNaN(exp) || now.getTime() > exp) return drop('link_expired');
      return OK;
    }

    case 'proposal': {
      const p = await prisma.proposal.findUnique({ where: { id: govern.proposal_id }, select: { accord_id: true, version: true, status: true, is_deleted: true } });
      if (!p || p.is_deleted || p.status !== 'sent') return drop('superseded_version');
      const newer = await prisma.proposal.count({ where: { accord_id: p.accord_id, version: { gt: p.version }, is_deleted: false } });
      return newer > 0 ? drop('superseded_version') : OK;
    }

    case 'contract': {
      const c = await prisma.contract.findUnique({ where: { id: govern.contract_id }, select: { accord_id: true, version: true, status: true, is_deleted: true } });
      if (!c || c.is_deleted || c.status !== 'sent') return drop('superseded_version');
      const newer = await prisma.contract.count({ where: { accord_id: c.accord_id, version: { gt: c.version }, is_deleted: false } });
      return newer > 0 ? drop('superseded_version') : OK;
    }

    case 'chat': {
      const convo = await prisma.chatConversation.findUnique({ where: { task_id: govern.task_id }, select: { state: true } });
      if (!convo) return drop('conversation_closed');
      // A person's own message is still delivered after the conversation closes; only automated mail is held back.
      return convo.state === 'closed' && !govern.snapshot?.staff ? drop('conversation_closed') : OK;
    }

    case 'approval_mail': {
      const t = await prisma.task.findUnique({ where: { id: govern.task_id }, select: taskSelect });
      if (!t || t.is_deleted || t.status === 'abandoned') return drop('task_closed');
      if (t.status === 'done') return drop('already_live');
      if (t.client_approved_at || t.tags.includes(CLIENT_APPROVED_TAG)) return drop('already_approved');
      if (govern.approval_request_id) {
        const r = await prisma.approvalRequest.findUnique({ where: { id: govern.approval_request_id }, select: { status: true } });
        if (!r || r.status !== 'queued') return drop('request_not_queued');
      }
      return OK;
    }

    case 'notice_internal': {
      const t = await prisma.task.findUnique({ where: { id: govern.task_id }, select: taskSelect });
      return !t || t.is_deleted || t.status === 'abandoned' ? drop('task_closed') : OK;
    }
  }
}

/** The tag a preview notice claims: one per distinct preview address. */
export const previewTag = (url: string) => `${PREVIEW_TAG_PREFIX}${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;

/**
 * Claim "the client was told this fact" in one UPDATE. True only for the first caller; every later
 * caller, on any channel, gets false and must not send. `live` claims go-live-notified; `preview`
 * claims preview-notified:<sha1(url)[0:10]>.
 */
export async function claimNotice(taskId: string, kind: 'live' | 'preview', previewUrl?: string | null): Promise<boolean> {
  if (kind === 'preview' && !previewUrl) throw new Error('claimNotice preview needs the preview url');
  const tag = kind === 'live' ? GO_LIVE_TAG : previewTag(previewUrl as string);
  const n = await prisma.$executeRaw`UPDATE tasks SET tags = array_append(tags, ${tag}) WHERE id = ${taskId}::uuid AND NOT (${tag} = ANY(tags))`;
  return n === 1;
}

/**
 * Give a claim back (the send it guarded did not go out). Removes the tag in one UPDATE; true when the
 * tag was there. Releasing a claim somebody else holds is the caller's mistake, so callers only release
 * what their own claimNotice returned true for.
 */
export async function releaseNotice(taskId: string, kind: 'live' | 'preview', previewUrl?: string | null): Promise<boolean> {
  if (kind === 'preview' && !previewUrl) throw new Error('releaseNotice preview needs the preview url');
  const tag = kind === 'live' ? GO_LIVE_TAG : previewTag(previewUrl as string);
  const n = await prisma.$executeRaw`UPDATE tasks SET tags = array_remove(tags, ${tag}) WHERE id = ${taskId}::uuid AND ${tag} = ANY(tags)`;
  return n === 1;
}
