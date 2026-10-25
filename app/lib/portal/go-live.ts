/**
 * Staged work and go-live (Mike's ruling, 2026-10-21): the client is told twice. Once when the
 * change is staged and waiting for their yes, once when their approved change is live.
 *
 * Status sequence for staged client work:
 *   staged   POST /api/tasks/:id/staged   status `review`, preview url stored, a client-visible
 *            "ready for your review" line, the approval email to the requester.
 *   approved the client's yes (portal or approval link) stamps `client_approved_at` and the
 *            `client-approved` tag. The status stays `review` until the change is live: the task
 *            enum has no `approved` value, and `done` must mean live. "Approved" in this module
 *            is `client_approved_at` or the tag.
 *   live     POST /api/tasks/:id/live      needs the approved state (409 otherwise, unless forced),
 *            sets `done` + completed_at, posts the client-visible "this is live" line and sends
 *            the go-live email to the people on the request. Idempotent: the `go-live-notified`
 *            tag is claimed in one UPDATE before anything is sent, so a repeat sends nothing.
 *
 * Two lanes, picked per task. A task with a portal chat conversation: the line is posted as a team
 * message and the chat sweep (lib/portal/chat/sweep.ts, staffPass) emails it when the client is away.
 * Any other task: one EmailOutbox row per recipient (kind `portal_golive`, from bast@ as
 * "Indelible Support"). The PortalNotice lane cannot carry this text: its refresh step rewrites
 * every queued body as "there is a new reply".
 *
 * Nothing here names Bast to the client, uses a dash, or promises anything. Mail goes only to the
 * requester and to contacts who wrote in the thread (`noticeRecipients`), never the client roster.
 */
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { bastWordError } from '@/lib/portal/thread';
import { noticeRecipients, workPageUrl } from '@/lib/portal/notices';
import { BAST_ACCOUNT } from '@/lib/portal/chat/mailer';
import { CLIENT_APPROVED_TAG, SEND_BACK_TAG, removeTaskTagQuery, resolveTaskContact, ensureTaskPortalToken } from '@/lib/services/portal';
import { sendTaskApprovalRequestEmail } from '@/lib/services/email';
import { logStatusChange } from '@/lib/services/activity';
import { unblockEligibleDependents } from '@/lib/services/dependencies';
import { queueInOutbox } from '@/lib/sends/outbox';
import { claimNotice, releaseNotice, GO_LIVE_TAG } from '@/lib/sends/recheck';
// Fleet item 5
import { getApprovalBindingMode, isRestage, sameSha, voidApprovalIfRestaged, writeReceipt, compareBuild, type CheckEntry } from '@/lib/portal/receipts';
import { assertClaimHeld, CLEAR_CLAIM_DATA, type ClaimCaller } from '@/lib/tasks/claims';
import { actorLaneField } from '@/lib/auth/actor-lane';

export { GO_LIVE_TAG };
export const GO_LIVE_KIND = 'portal_golive';
export const STAGED_NOTE_MAX = 500;
export const SUMMARY_MAX = 300;

const DASH = /[‒–—―−]|\s-\s|--/;

/** The copy scan for the fixed lines and the free text that goes in them. Throws a 400 with the reason. */
export function assertClientCopy(label: string, text: string): void {
  const bast = bastWordError(text);
  if (bast) throw new ApiError(`${label} names Bast, so it cannot be shown to the client.`, 400, 'names_bast');
  if (DASH.test(text)) throw new ApiError(`${label} contains a dash. Reword it with a comma, a colon or a new sentence.`, 400, 'dash');
}

export function parseHttpUrl(label: string, raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ApiError(`${label} is not a valid URL`, 400, 'bad_url');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ApiError(`${label} must be an http or https URL`, 400, 'bad_url');
  return u.toString();
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const firstNameOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there';

export const stagedLine = (previewUrl: string, note?: string | null) =>
  `Ready for your review: ${previewUrl}. Open it, then approve it or tell us what to change.${note ? `\n\n${oneLine(note)}` : ''}`;

const LIVE_LINE_PREFIX = 'This is live now:';
export const liveLine = (liveUrl: string) => `${LIVE_LINE_PREFIX} ${liveUrl}. Reply here if anything looks off.`;

export const goLiveSubject = (clientName: string) => `${clientName}: your change is live`.slice(0, 480);

/** The standalone go-live email (writing standard 4b): what changed, the live link, the portal link, signed. */
export function buildGoLiveBody(i: { firstName: string; what: string; liveUrl: string; workUrl: string }): string {
  return [
    `Hi ${i.firstName},`,
    '',
    `Your change is live: ${i.what}`,
    '',
    `See it here: ${i.liveUrl}`,
    '',
    `Your request in the portal: ${i.workUrl}`,
    '',
    'If anything looks off, reply to this email or write to us in the portal.',
    '',
    'Indelible Support',
  ].join('\n');
}

export const isApprovedState = (t: { client_approved_at: Date | null; tags: string[]; approved?: boolean }) =>
  Boolean(t.client_approved_at) || t.tags.includes(CLIENT_APPROVED_TAG) || Boolean(t.approved);

/** The marker on a go-live line posted while another channel already told the client (no chat sweep email, no second notice). */
const GO_LIVE_CLAIMED_ELSEWHERE = 'go_live_claimed_elsewhere';

/**
 * The go-live notice was already claimed (a worker's own email reached the client first, or this is a repeat).
 * Make sure the client-visible thread line exists once, marked as already carried so no second email follows.
 */
async function ensureLiveLine(taskId: string, authorId: string, line: string): Promise<void> {
  const existing = await prisma.comment.findFirst({
    where: {
      task_id: taskId,
      is_deleted: false,
      OR: [
        { content: { startsWith: LIVE_LINE_PREFIX }, client_visible: true },
        { chat_meta: { path: ['email_notice'], equals: 'go_live_email' } },
        { chat_meta: { path: ['email_notice'], equals: GO_LIVE_CLAIMED_ELSEWHERE } },
      ],
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.comment.create({
    data: { task_id: taskId, user_id: authorId, content: line, is_internal: false, client_visible: true, chat_meta: { email_notice: GO_LIVE_CLAIMED_ELSEWHERE } },
  });
}

export interface StagedResult {
  status: 'review';
  preview_url: string;
  already_staged: boolean;
  approval_email: 'sent' | 'skipped';
}

export async function markStaged(input: {
  taskId: string;
  authorId: string;
  previewUrl: string;
  note?: string | null;
  /** The X-Claim-Token header: proves the caller still owns the task (fleet item 3). */
  claimToken?: string | null;
  /** Who is calling; a person on a browser session may override another worker's lease (fleet item 3). */
  claimCaller?: ClaimCaller;
  // Fleet item 5: the build behind the preview
  commitSha?: string | null;
  deployId?: string | null;
  deployUrl?: string | null;
  checks?: CheckEntry[];
}): Promise<StagedResult> {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, is_deleted: true, status: true, source: true, staging_preview_url: true, client_approved_at: true, tags: true, requested_by_contact_id: true, approved: true, approved_preview_url: true, approved_commit_sha: true, staging_commit_sha: true, claim_holder: true },
  });
  if (!task || task.is_deleted) throw new ApiError('Task not found', 404);
  if (task.status === 'abandoned') throw new ApiError('This task was abandoned', 409);
  const claimCheck = await assertClaimHeld(task.id, input.claimToken, { action: 'staging', caller: input.claimCaller });
  // Fleet item 5: in enforce mode a stage must say which build it is.
  const bindingMode = await getApprovalBindingMode();
  if (bindingMode === 'enforce' && (!input.commitSha || !input.deployUrl)) {
    throw new ApiError('Staging needs commit_sha and deploy_url so the client approves a known build.', 400, 'receipt_required');
  }
  const wasApproved = Boolean(task.client_approved_at) || task.tags.includes(CLIENT_APPROVED_TAG);
  // Fleet item 5: off, or a published task, keeps today's refusal. Otherwise a repeat of the same build is a no-op
  // and a different build voids the yes (below, after the copy scan) and is staged as new work.
  if (wasApproved && (bindingMode === 'off' || task.status === 'done' || task.approved)) {
    throw new ApiError('The client already approved this task. Publish it with the live call.', 409);
  }
  if (wasApproved && !isRestage(task, { previewUrl: input.previewUrl, commitSha: input.commitSha })) {
    return { status: 'review', preview_url: input.previewUrl, already_staged: true, approval_email: 'skipped' };
  }
  // A repeat is only a repeat when it names the same build (or none): a new commit on the same address is recorded.
  if (!wasApproved && task.status === 'review' && task.staging_preview_url === input.previewUrl && (!input.commitSha || (task.staging_commit_sha !== null && sameSha(input.commitSha, task.staging_commit_sha)))) {
    return { status: 'review', preview_url: input.previewUrl, already_staged: true, approval_email: 'skipped' };
  }
  const line = stagedLine(input.previewUrl, input.note);
  assertClientCopy('The staged note', line.replace(input.previewUrl, ''));
  if (wasApproved) await voidApprovalIfRestaged(task.id, { previewUrl: input.previewUrl, commitSha: input.commitSha }, { actorUserId: input.authorId, mode: bindingMode, reason: 'staged again' });

  const now = new Date();
  await prisma.$transaction([
    prisma.task.update({ where: { id: task.id }, data: { status: 'review', staging_preview_url: input.previewUrl, staging_deployed_at: now, staging_commit_sha: input.commitSha ?? null, staging_deploy_id: input.deployId ?? null, staging_deploy_url: input.deployUrl ?? null, completed_at: null, ...(claimCheck.overridden_holder ? CLEAR_CLAIM_DATA : {}) } }),
    removeTaskTagQuery(task.id, SEND_BACK_TAG),
    // chat_meta marks the line as already carried by the approval email, so the chat sweep does not mail it again.
    prisma.comment.create({
      data: { ...(await actorLaneField()), task_id: task.id, user_id: input.authorId, content: line, is_internal: false, client_visible: true, chat_meta: { email_notice: 'approval_email' } },
    }),
  ]);
  await claimCheck.logOverride();
  await writeReceipt({ task_id: task.id, step: 'staged', commit_sha: input.commitSha, deploy_id: input.deployId, deploy_url: input.deployUrl, preview_url: input.previewUrl, checks: input.checks, actor_user_id: input.authorId, claim_holder: task.claim_holder });

  let approvalEmail: 'sent' | 'skipped' = 'skipped';
  let previewHolder: string | null = null;
  // Email-sourced work gets its preview on the client's own thread from the worker; only portal requests are mailed here.
  if (task.source === 'portal' && task.requested_by_contact_id) {
    try {
      const full = await prisma.task.findUnique({
        where: { id: task.id },
        select: { id: true, title: true, client_title: true, staging_preview_url: true, client_id: true, requested_by_contact: { select: { id: true, name: true, email: true, client_id: true } }, site: { select: { client_id: true } } },
      });
      const contact = full ? await resolveTaskContact(full) : null;
      const link = await ensureTaskPortalToken(task.id);
      if (full && contact?.email && link) {
        // One notice per preview address across channels. A rework (send-back, request changes, leaving review)
        // clears the preview claims, so a revised preview at the same address is told afresh.
        previewHolder = await claimNotice(task.id, 'preview', input.previewUrl);
        if (!previewHolder) {
          return { status: 'review', preview_url: input.previewUrl, already_staged: false, approval_email: 'skipped' };
        }
        await sendTaskApprovalRequestEmail({
          to: contact.email,
          approvalUrl: link.url,
          taskTitle: full.client_title ?? full.title,
          contactName: contact.name,
          stagingUrl: full.staging_preview_url,
          taskId: task.id,
          claimed: true,
          claimHolder: previewHolder,
        });
        approvalEmail = 'sent';
      }
    } catch (error) {
      // The mail did not go: give the preview claim back so a retry or the worker's own note can still tell the client.
      if (previewHolder) await releaseNotice(task.id, 'preview', input.previewUrl, previewHolder).catch(() => undefined);
      console.error('staged approval email failed', error);
    }
  }
  return { status: 'review', preview_url: input.previewUrl, already_staged: false, approval_email: approvalEmail };
}

export interface LiveResult {
  status: 'done';
  already_notified: boolean;
  lane: 'chat' | 'email' | 'none';
  emailed: string[];
}

export async function markLive(input: {
  taskId: string;
  authorId: string;
  liveUrl: string;
  summary?: string | null;
  force?: boolean;
  // Fleet item 5: the production build, and the proof it was checked
  commitSha?: string | null;
  deployId?: string | null;
  checks?: CheckEntry[];
  liveCheck?: Record<string, unknown> | null;
  forceReason?: string | null;
  /** The caller's role: only an admin may force a build that is not the approved one. */
  callerRole?: string;
  callerVia?: 'session' | 'api_key';
  /** The X-Claim-Token header: proves the caller still owns the task (fleet item 3). */
  claimToken?: string | null;
  claimCaller?: ClaimCaller;
}): Promise<LiveResult> {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true, is_deleted: true, status: true, title: true, client_title: true, client_id: true, requested_by_contact_id: true,
      client_approved_at: true, approved: true, completed_at: true, tags: true, approved_commit_sha: true, approved_preview_url: true, claim_holder: true,
      client: { select: { name: true } },
      site: { select: { client_id: true, client: { select: { name: true } } } },
    },
  });
  if (!task || task.is_deleted) throw new ApiError('Task not found', 404);
  // A cancelled request is not published, even with force: staff reopen it first.
  if (task.status === 'abandoned') throw new ApiError('This task was abandoned, so it cannot go live. Reopen it first.', 409, 'abandoned');
  const claimCheck = await assertClaimHeld(task.id, input.claimToken, { action: 'go-live', caller: input.claimCaller });
  if (!isApprovedState(task) && !input.force) {
    throw new ApiError('The client has not approved this task yet. Nothing was published to them.', 409, 'not_approved');
  }
  const what = oneLine(input.summary ?? '') || oneLine(task.client_title ?? task.title);
  const line = liveLine(input.liveUrl);
  assertClientCopy('The summary', what);

  // Fleet item 5: is this the build the client approved? Only a task being published for the first time is judged.
  const bindingMode = await getApprovalBindingMode();
  const judged = bindingMode === 'off' || task.status === 'done' ? { mismatch: false, unbound: true } : compareBuild(task.approved_commit_sha, input.commitSha);
  // Enforce: a yes that never recorded its build cannot show this is the build the client saw, so it is treated as a mismatch.
  const build = bindingMode === 'enforce' && task.status !== 'done' && judged.unbound ? { mismatch: true, unbound: true } : judged;
  let forcedPastMismatch = false;
  if (build.mismatch && bindingMode === 'enforce') {
    if (!input.force) throw new ApiError('The build going live is not the build the client approved. Nothing was published to them.', 409, 'build_not_approved');
    // Only an admin on a browser session may force (not an API key, not a worker token).
    if (input.callerRole !== 'admin' || input.callerVia !== 'session') throw new ApiError('Only an admin on a browser session can publish a build the client did not approve.', 403, 'forbidden');
    if (!oneLine(input.forceReason ?? '')) throw new ApiError('Forcing a build the client did not approve needs force_reason.', 400, 'force_reason_required');
    forcedPastMismatch = true;
  }

  const now = new Date();
  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: 'done',
      completed_at: task.completed_at ?? now,
      approved: true,
      approved_at: now,
      approved_by_id: input.authorId,
      ...(claimCheck.overridden_holder ? CLEAR_CLAIM_DATA : {}),
    },
  });
  await claimCheck.logOverride();
  if (task.status !== 'done') {
    await writeReceipt({
      task_id: task.id, step: 'live', commit_sha: input.commitSha, deploy_id: input.deployId, live_url: input.liveUrl, checks: input.checks,
      live_check: { ...(input.liveCheck ?? {}), ...(forcedPastMismatch ? { forced: true, force_reason: oneLine(input.forceReason ?? '') } : {}), ...(build.unbound ? { approved_build: 'not recorded' } : {}) } as never,
      mismatch: build.mismatch, actor_user_id: input.authorId, claim_holder: task.claim_holder,
    });
    if (build.mismatch) {
      await prisma.comment.create({
        data: {
          task_id: task.id, user_id: input.authorId, is_internal: true,
          content: `Build check: the commit going live (${input.commitSha ? input.commitSha.slice(0, 12) : 'not reported'}) is not the commit the client approved (${(task.approved_commit_sha ?? '').slice(0, 12)}).${forcedPastMismatch ? ` Forced by an admin: ${oneLine(input.forceReason ?? '')}.` : ' It went live anyway because approval binding is in warn mode.'}`,
        },
      }).catch((e: unknown) => console.error('build mismatch note failed', e));
    }
    await logStatusChange(input.authorId, 'task', task.id, task.title, task.status, 'done').catch(() => undefined);
    await unblockEligibleDependents(task.id).catch((e: unknown) => console.error('unblock after go-live failed', e));
  }

  // One send per task: the tag is claimed before anything is posted or mailed.
  const liveHolder = await claimNotice(task.id, 'live');
  if (!liveHolder) {
    await ensureLiveLine(task.id, input.authorId, line);
    return { status: 'done', already_notified: true, lane: 'none', emailed: [] };
  }

  try {
    const chat = await prisma.chatConversation.findUnique({ where: { task_id: task.id }, select: { id: true } });
    const clientId = task.client_id ?? task.site?.client_id ?? null;
    const recipients = await noticeRecipients({ id: task.id, client_title: what, client_id: clientId, requested_by_contact_id: task.requested_by_contact_id });

    // The thread line. In a chat task it carries no marker, so the chat sweep emails it when the client is away.
    if (chat || recipients.length > 0) {
      await prisma.comment.create({
        data: { ...(await actorLaneField()), task_id: task.id, user_id: input.authorId, content: line, is_internal: false, client_visible: true, ...(chat ? {} : { chat_meta: { email_notice: 'go_live_email' } }) },
      });
    }
    if (chat) return { status: 'done', already_notified: false, lane: 'chat', emailed: [] };

    const clientName = task.client?.name ?? task.site?.client?.name ?? 'Your site';
    const emailed: string[] = [];
    for (const r of recipients) {
      await queueInOutbox(
        prisma,
        {
          to: r.email,
          subject: goLiveSubject(clientName),
          text: buildGoLiveBody({ firstName: firstNameOf(r.name), what, liveUrl: input.liveUrl, workUrl: workPageUrl(task.id) }),
          from_account: BAST_ACCOUNT,
          kind: GO_LIVE_KIND,
          allow_external: true,
          dedupe_key: `golive:${task.id}:${r.id}`,
          task_id: task.id,
        },
        { intent: 'golive', task_id: task.id, snapshot: { claimed: true, holder: liveHolder } }
      );
      emailed.push(r.email);
    }
    if (emailed.length === 0) {
      // Nobody was told. Give the claim back so the worker's own note (or a later call) can still tell the client.
      await releaseNotice(task.id, 'live', null, liveHolder);
    }
    return { status: 'done', already_notified: false, lane: emailed.length ? 'email' : 'none', emailed };
  } catch (error) {
    await releaseNotice(task.id, 'live', null, liveHolder);
    throw error;
  }
}
