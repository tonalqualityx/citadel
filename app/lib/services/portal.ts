/**
 * Portal Service
 *
 * Handles token generation, validation, and session logging
 * for public portal access (proposals, MSA signing).
 */

import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { clearPreviewClaims } from '@/lib/sends/claims';
import { stampApproval } from '@/lib/portal/receipts'; // Fleet item 5
import { ApiError } from '@/lib/api/errors';
import { PORTAL_HIDDEN_PROJECT_STATUSES } from '@/lib/portal/access';
import { onClientMessage } from '@/lib/portal/waits';
import { alertTaskOwner } from '@/lib/portal/staff-alert';
import { actorLaneField } from '@/lib/auth/actor-lane';

const TOKEN_LENGTH = 64; // 128 hex characters
const DEFAULT_EXPIRY_DAYS = 60;

/**
 * Generate a cryptographically secure portal token
 */
export function generatePortalToken(): string {
  return randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Calculate token expiry date
 */
export function getTokenExpiry(days: number = DEFAULT_EXPIRY_DAYS): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry;
}

/**
 * Validate a proposal portal token
 * Returns the proposal if valid, null if invalid/expired
 */
export async function validateProposalToken(token: string) {
  const proposal = await prisma.proposal.findFirst({
    where: {
      portal_token: token,
      is_deleted: false,
    },
    include: {
      accord: {
        include: {
          client: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true, email: true } },
          charter_items: {
            where: { is_deleted: false },
            include: { ware: { select: { id: true, name: true, type: true } } },
            orderBy: { sort_order: 'asc' },
          },
          commission_items: {
            where: { is_deleted: false },
            include: { ware: { select: { id: true, name: true, type: true } } },
            orderBy: { sort_order: 'asc' },
          },
          keep_items: {
            where: { is_deleted: false },
            include: {
              site: { select: { id: true, name: true, url: true } },
              hosting_plan: { select: { id: true, name: true, rate: true } },
              maintenance_plan: { select: { id: true, name: true, rate: true } },
            },
            orderBy: { sort_order: 'asc' },
          },
        },
      },
      created_by: { select: { id: true, name: true, email: true } },
    },
  });

  if (!proposal) return null;

  // Check expiry
  if (proposal.portal_token_expires_at && proposal.portal_token_expires_at < new Date()) {
    return null;
  }

  return proposal;
}

/**
 * Validate an MSA portal token (stored on ClientMsaSignature or as a query approach)
 * For MSA, the token is stored in the client_msa_signatures table
 * We look up by portal_token to find the pending signature request
 */
export async function validateMsaToken(token: string) {
  const signature = await prisma.clientMsaSignature.findFirst({
    where: {
      portal_token: token,
    },
    include: {
      client: { select: { id: true, name: true } },
      msa_version: true,
    },
  });

  if (!signature) return null;

  return signature;
}

/**
 * Validate a contract portal token
 * Returns the contract if valid, null if invalid/expired
 */
export async function validateContractToken(token: string) {
  const contract = await prisma.contract.findFirst({
    where: {
      portal_token: token,
      is_deleted: false,
    },
    include: {
      accord: {
        include: {
          client: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true, email: true } },
          charter_items: {
            where: { is_deleted: false },
            include: { ware: { select: { id: true, name: true, type: true } } },
            orderBy: { sort_order: 'asc' },
          },
          commission_items: {
            where: { is_deleted: false },
            include: { ware: { select: { id: true, name: true, type: true } } },
            orderBy: { sort_order: 'asc' },
          },
          keep_items: {
            where: { is_deleted: false },
            include: {
              site: { select: { id: true, name: true, url: true } },
              hosting_plan: { select: { id: true, name: true, rate: true } },
              maintenance_plan: { select: { id: true, name: true, rate: true } },
            },
            orderBy: { sort_order: 'asc' },
          },
        },
      },
      msa_version: true,
      created_by: { select: { id: true, name: true, email: true } },
    },
  });

  if (!contract) return null;

  // Check expiry
  if (contract.portal_token_expires_at && contract.portal_token_expires_at < new Date()) {
    return null;
  }

  return contract;
}

/**
 * Validate an addendum portal token
 * Returns the addendum if valid, null if invalid/expired
 */
export async function validateAddendumToken(token: string) {
  const addendum = await prisma.addendum.findFirst({
    where: {
      portal_token: token,
      is_deleted: false,
    },
    include: {
      accord: {
        include: {
          client: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true, email: true } },
          charter_items: {
            where: { is_deleted: false },
            include: { ware: { select: { id: true, name: true, type: true } } },
            orderBy: { sort_order: 'asc' },
          },
          commission_items: {
            where: { is_deleted: false },
            include: { ware: { select: { id: true, name: true, type: true } } },
            orderBy: { sort_order: 'asc' },
          },
          keep_items: {
            where: { is_deleted: false },
            include: {
              site: { select: { id: true, name: true, url: true } },
              hosting_plan: { select: { id: true, name: true, rate: true } },
              maintenance_plan: { select: { id: true, name: true, rate: true } },
            },
            orderBy: { sort_order: 'asc' },
          },
        },
      },
      created_by: { select: { id: true, name: true, email: true } },
    },
  });

  if (!addendum) return null;

  if (addendum.portal_token_expires_at && addendum.portal_token_expires_at < new Date()) {
    return null;
  }

  return addendum;
}

/**
 * Ensure a task has a valid client-approval portal token, minting (or reusing an unexpired
 * one) and returning its public approval URL. Shared by the approval-link endpoint and the
 * requestor-notification email so token semantics live in one place.
 * Returns null when the task does not exist or is deleted.
 */
export async function ensureTaskPortalToken(
  taskId: string
): Promise<{ token: string; expiresAt: Date | null; url: string } | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      is_deleted: true,
      portal_token: true,
      portal_token_expires_at: true,
    },
  });

  if (!task || task.is_deleted) return null;

  // Reuse an existing, unexpired token; otherwise mint a fresh one.
  const stillValid =
    task.portal_token &&
    (!task.portal_token_expires_at || task.portal_token_expires_at > new Date());

  let token = task.portal_token ?? undefined;
  let expiresAt = task.portal_token_expires_at ?? undefined;

  if (!stillValid) {
    token = generatePortalToken();
    expiresAt = getTokenExpiry();
    await prisma.task.update({
      where: { id: taskId },
      data: { portal_token: token, portal_token_expires_at: expiresAt },
    });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  return {
    token: token as string,
    expiresAt: expiresAt ?? null,
    url: `${baseUrl}/portal/task-approval/${token}`,
  };
}

/**
 * Validate a per-task approval portal token
 * Returns the task (with client-visible comment data loaded) if valid, null if invalid/expired.
 * Mirrors the proposal/contract pattern; the token lives on the task row.
 */
export async function validateTaskToken(token: string) {
  const task = await prisma.task.findFirst({
    where: {
      portal_token: token,
      is_deleted: false,
    },
    include: {
      comments: {
        where: { is_internal: false },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { created_at: 'asc' },
      },
      // Site drives auto_deploy (staging→prod promotion on approve) and the client the
      // task belongs to; requested_by_contact is the first-choice approver/requestor.
      site: { select: { id: true, name: true, auto_deploy: true, client_id: true } },
      project: { select: { portal_visibility: true, status: true, is_deleted: true } },
      requested_by_contact: {
        select: { id: true, name: true, email: true, client_id: true, is_deleted: true },
      },
    },
  });

  if (!task) return null;

  // A deleted requester revokes every token route (no fallback to the primary contact).
  if (task.requested_by_contact?.is_deleted) return null;

  // Tasks of a project hidden, deleted, or in a non-client-visible status are never reachable.
  if (task.project) {
    const { portal_visibility, status, is_deleted } = task.project;
    if (
      portal_visibility === 'hidden' ||
      is_deleted ||
      (PORTAL_HIDDEN_PROJECT_STATUSES as readonly string[]).includes(status)
    ) {
      return null;
    }
  }

  // Check expiry
  if (task.portal_token_expires_at && task.portal_token_expires_at < new Date()) {
    return null;
  }

  return task;
}

/**
 * Resolve the acting client contact for a token-gated task action.
 * No client login exists yet (C1), so the per-task token is the authorization and the
 * contact is derived from the task: the requestor if set (null when that requestor is deleted),
 * else the client's primary contact.
 * Returns null when the task has no resolvable client/contact (approval still records via
 * client_approved_at; approved_by_contact_id simply stays null).
 */
export async function resolveTaskContact(task: {
  requested_by_contact?: {
    id: string;
    name: string | null;
    email: string;
    client_id: string;
    is_deleted?: boolean;
  } | null;
  client_id?: string | null;
  site?: { client_id: string | null } | null;
}) {
  // A deleted requester is no longer a person we act for. Never substitute the primary contact:
  // that would attribute the action to someone who did not take it. Callers treat null as revoked.
  if (task.requested_by_contact) {
    return task.requested_by_contact.is_deleted ? null : task.requested_by_contact;
  }

  const clientId = task.client_id ?? task.site?.client_id ?? null;
  if (!clientId) return null;

  return prisma.clientContact.findFirst({
    where: { client_id: clientId, is_primary: true, is_deleted: false },
    select: { id: true, name: true, email: true, client_id: true },
  });
}

/**
 * Resolve the acting client contact for a token-gated article approval.
 * Articles have no requestor, so the contact is the client's primary contact.
 * Returns null when no primary contact exists (approval still records via
 * client_approved_at; approved_by_contact_id simply stays null).
 */
export async function resolveArticleContact(article: { client_id: string }) {
  return prisma.clientContact.findFirst({
    where: { client_id: article.client_id, is_primary: true, is_deleted: false },
    select: { id: true, name: true, email: true, client_id: true },
  });
}

/**
 * Record client approval on an article (idempotent). Mirrors the task client-approval flow:
 * sets client_approved_at + approved_by_contact_id, resolving the client's primary contact
 * when no explicit contact is supplied. Returns null if the article doesn't exist / is deleted.
 */
export async function recordArticleClientApproval(
  articleId: string,
  contactId?: string | null
): Promise<{ approved_at: Date; contact_id: string | null; already_approved: boolean } | null> {
  const article = await prisma.article.findFirst({
    where: { id: articleId, is_deleted: false },
    select: {
      id: true,
      client_id: true,
      client_approved_at: true,
      approved_by_contact_id: true,
    },
  });
  if (!article) return null;

  // Idempotent: a second approval is a no-op.
  if (article.client_approved_at) {
    return {
      approved_at: article.client_approved_at,
      contact_id: article.approved_by_contact_id,
      already_approved: true,
    };
  }

  const resolvedContactId =
    contactId ?? (await resolveArticleContact({ client_id: article.client_id }))?.id ?? null;
  const approvedAt = new Date();

  await prisma.article.update({
    where: { id: articleId },
    data: { client_approved_at: approvedAt, approved_by_contact_id: resolvedContactId },
  });

  return { approved_at: approvedAt, contact_id: resolvedContactId, already_approved: false };
}

/**
 * Record client approval on a task (idempotent). Sets client_approved_at + approved_by_contact_id
 * and, for staged client sites (site.auto_deploy === false), flags the staging→prod promotion as
 * pending via an internal note. The publish is Bast's: the citadel-worker's client_approved wake
 * deploys on its next pass and sets `approved` once live (Mike, 2026-10-15: the client's yes is the
 * approval; Mike is never the deploy or approve step). Never an operator step.
 *
 * Shared mutation core for BOTH the token-gated flow (POST /api/portal/tasks/:token/approve) and
 * the session-scoped flow (POST /api/portal/tasks/:id/approve, Portal v2 phase 1) — one source of
 * truth for what "a client approved this task" means, regardless of how they got authenticated.
 */
export async function recordTaskClientApproval(
  task: { id: string; client_approved_at: Date | null; site?: { auto_deploy: boolean } | null },
  contactId: string | null,
  /** Fleet item 5: which door the yes came through (portal | approval_link). */
  approvalSource: 'portal' | 'approval_link' = 'portal',
  /** Fleet item 5: the preview address the client was looking at. A yes is only recorded for that address. */
  expectedPreviewUrl: string | null = null
): Promise<{ already_approved: boolean; approved_at: Date; promotion_pending: boolean; preview_changed?: boolean; staging_preview_url?: string | null }> {
  if (task.client_approved_at) {
    return { already_approved: true, approved_at: task.client_approved_at, promotion_pending: false };
  }

  const approvedAt = new Date();
  if (expectedPreviewUrl) {
    // The yes and the build it covers are written together, and only if the preview is still the one on screen.
    const outcome = await prisma.$transaction(async (tx) => {
      const n = await tx.task.updateMany({
        where: { id: task.id, client_approved_at: null, staging_preview_url: expectedPreviewUrl },
        data: { client_approved_at: approvedAt, approved_by_contact_id: contactId },
      });
      if (n.count !== 1) {
        const cur = await tx.task.findUnique({ where: { id: task.id }, select: { client_approved_at: true, staging_preview_url: true } });
        return { ok: false as const, cur };
      }
      await tx.$executeRaw`UPDATE tasks SET tags = array_remove(tags, ${SEND_BACK_TAG}) WHERE id = ${task.id}::uuid`;
      await tx.$executeRaw`UPDATE tasks SET tags = CASE WHEN ${CLIENT_APPROVED_TAG} = ANY(tags) THEN tags ELSE array_append(tags, ${CLIENT_APPROVED_TAG}) END WHERE id = ${task.id}::uuid`;
      await stampApproval(task.id, approvalSource, tx as never);
      return { ok: true as const };
    });
    if (!outcome.ok) {
      if (outcome.cur?.client_approved_at) return { already_approved: true, approved_at: outcome.cur.client_approved_at, promotion_pending: false };
      return { already_approved: false, approved_at: approvedAt, promotion_pending: false, preview_changed: true, staging_preview_url: outcome.cur?.staging_preview_url ?? null };
    }
  } else {
    // The approval also clears the send-back marker: the work is accepted, so it is no longer "sent
    // back". The tag is removed by a single UPDATE (array_remove), never read-modify-write, so a tag
    // added at the same moment by another writer is not lost.
    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: {
          client_approved_at: approvedAt,
          approved_by_contact_id: contactId,
        },
      }),
      removeTaskTagQuery(task.id, SEND_BACK_TAG),
      // The approved state the worker gate and the go-live call read (status stays `review` until the change is live).
      addTaskTagQuery(task.id, CLIENT_APPROVED_TAG),
    ]);
    await stampApproval(task.id, approvalSource); // Fleet item 5: the yes is bound to the build on the preview
  }

  const promotionPending = task.site?.auto_deploy === false;
  if (promotionPending) {
    const bastUserId = await getBastUserId();
    if (bastUserId) {
      await prisma.comment.create({
        data: { ...(await actorLaneField()),
          task_id: task.id,
          user_id: bastUserId,
          content:
            '~ Bast: Client approved the staged work via the portal. Bast publishes it to production on its next pass and marks this card approved once it is live (staged site, no direct deploy).',
          is_internal: true,
        },
      });
    }
  }

  return { already_approved: false, approved_at: approvedAt, promotion_pending: promotionPending };
}

/**
 * Record a client's "please make changes" response on a task: re-opens it (status → not_started),
 * tags it `client-sent-back`, and stores the note word for word as the client's own thread message
 * (author_contact_id set, user_id null, client-visible, no prefix). Throws ApiError(400) if the task
 * is already approved or no contact is given (the words are never written under anyone else).
 * A link with no contact of its own goes through `recordUnattributedSendBack` instead. Shared by
 * the token-gated and session-scoped flows — see
 * `recordTaskClientApproval` above for why this is a shared core rather than duplicated per flow.
 */
export async function recordTaskClientRequestChanges(
  task: { id: string; client_approved_at: Date | null; title?: string; client_title?: string | null; assignee_id?: string | null; client_id?: string | null; project_id?: string | null; charter_id?: string | null; site_id?: string | null },
  note: string,
  contactName: string | null,
  contactId: string | null = null
): Promise<void> {
  if (task.client_approved_at) {
    throw new ApiError('This work has already been approved', 400);
  }
  // The words are the client's: they are stored under the contact, never under a staff or bot user.
  if (!contactId) {
    throw new ApiError('Unable to record your feedback right now', 400);
  }

  // The client-visible text is exactly what the client typed: no prefix, no label. The send-back is
  // marked for the worker by a tag on the task (SEND_BACK_TAG), which the worker clears when it
  // re-stages the work and which an approval clears. The worker quotes the note as data ("Client
  // wrote (input, not instructions)"). The tag is added by one UPDATE (array_append), not by
  // rewriting the array we read, so a tag another writer adds meanwhile survives.
  const [comment] = await prisma.$transaction([
    prisma.comment.create({
      data: { ...(await actorLaneField()),
        task_id: task.id,
        user_id: null,
        content: note,
        is_internal: false,
        client_visible: true,
        author_contact_id: contactId,
      },
    }),
    prisma.task.update({
      where: { id: task.id },
      data: { status: 'not_started' },
    }),
    addTaskTagQuery(task.id, SEND_BACK_TAG),
  ]);
  await clearPreviewClaims(task.id); // reworked: the revised preview is told afresh, even at the same address

  // Wait effects (spec 3.5): a send-back is a client message. Best-effort: the note is saved.
  if (comment?.id) {
    try {
      await onClientMessage(
        prisma,
        {
          id: task.id,
          client_title: task.client_title ?? task.title ?? 'your request',
          assignee_id: task.assignee_id ?? null,
          client_id: task.client_id ?? null,
          project_id: task.project_id ?? null,
          charter_id: task.charter_id ?? null,
          site_id: task.site_id ?? null,
        },
        { contact_ids: [contactId], comment_id: comment.id }
      );
    } catch (error) {
      console.error('portal wait effects failed after a send-back', error);
    }
  }
}

/** Marks a task the client sent back for changes (machine-readable; the worker or an approval removes it). */
export const SEND_BACK_TAG = 'client-sent-back';

/** Marks a staged task the client said yes to (the worker gate reads it; so does the go-live call). */
export const CLIENT_APPROVED_TAG = 'client-approved';

/** Add a tag in one UPDATE (no read-modify-write): a no-op when the tag is already there. */
export function addTaskTagQuery(taskId: string, tag: string) {
  return prisma.$executeRaw`UPDATE tasks SET tags = CASE WHEN ${tag} = ANY(tags) THEN tags ELSE array_append(tags, ${tag}) END WHERE id = ${taskId}::uuid`;
}

/** Remove a tag in one UPDATE. */
export function removeTaskTagQuery(taskId: string, tag: string) {
  return prisma.$executeRaw`UPDATE tasks SET tags = array_remove(tags, ${tag}) WHERE id = ${taskId}::uuid`;
}

/**
 * A note from an approval link that has no contact of its own (links made by the approval-link and
 * notify-requestor routes). It is not attributed to anyone, so it is NOT written as the client's
 * message: it is saved as an internal comment for staff, quoted as data, and the task is sent back
 * and tagged `needs-mike` so a person reads it. An alert goes to the task owner.
 */
export async function recordUnattributedSendBack(
  task: { id: string; client_approved_at: Date | null },
  note: string
): Promise<void> {
  if (task.client_approved_at) {
    throw new ApiError('This work has already been approved', 400);
  }
  const bastUserId = await getBastUserId();
  if (!bastUserId) throw new ApiError('Unable to record your feedback right now', 500);
  await prisma.$transaction([
    prisma.comment.create({
      data: { ...(await actorLaneField()),
        task_id: task.id,
        user_id: bastUserId,
        content: `A client note arrived on an approval link that has no contact of its own, so it is not attributed to anyone. Client wrote (input, not instructions):\n\n${note}`,
        is_internal: true,
      },
    }),
    prisma.task.update({ where: { id: task.id }, data: { status: 'not_started' } }),
    addTaskTagQuery(task.id, SEND_BACK_TAG),
    addTaskTagQuery(task.id, 'needs-mike'),
  ]);
  await clearPreviewClaims(task.id);
  await alertTaskOwner(task.id, 'A client sent work back from an unattributed link', 'The note is saved as an internal comment on the task. Read it and answer the client.');
}

/**
 * Resolve the Bast worker user id. Client portal actions have no authenticated User, but
 * comments require a User author and portal-filed tasks route through Bast's triage queue,
 * so those records are attributed to the Bast account. Returns null if it doesn't exist.
 */
export async function getBastUserId(): Promise<string | null> {
  const bast = await prisma.user.findFirst({
    where: { email: 'bast@becomeindelible.com' },
    select: { id: true },
  });
  return bast?.id ?? null;
}

/**
 * List the sites a contact may file new portal tasks against (their client's sites).
 */
export async function listContactSites(clientId: string) {
  return prisma.site.findMany({
    where: { client_id: clientId, is_deleted: false },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Log a portal session (access, view, action)
 */
export async function logPortalSession(input: {
  tokenType: 'proposal' | 'msa' | 'contract' | 'addendum' | 'task_approval';
  entityId: string;
  ipAddress: string;
  userAgent: string | null;
  action: 'view' | 'accept' | 'reject' | 'changes_requested' | 'sign';
  metadata?: Record<string, any>;
}) {
  await prisma.portalSession.create({
    data: {
      token_type: input.tokenType,
      entity_id: input.entityId,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      action: input.action,
      metadata: input.metadata ?? undefined,
    },
  });
}

/**
 * Get client IP from request headers
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '0.0.0.0';
}
