/**
 * Portal Service
 *
 * Handles token generation, validation, and session logging
 * for public portal access (proposals, MSA signing).
 */

import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';

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
      requested_by_contact: {
        select: { id: true, name: true, email: true, client_id: true },
      },
    },
  });

  if (!task) return null;

  // Check expiry
  if (task.portal_token_expires_at && task.portal_token_expires_at < new Date()) {
    return null;
  }

  return task;
}

/**
 * Resolve the acting client contact for a token-gated task action.
 * No client login exists yet (C1), so the per-task token is the authorization and the
 * contact is derived from the task: the requestor if set, else the client's primary contact.
 * Returns null when the task has no resolvable client/contact (approval still records via
 * client_approved_at; approved_by_contact_id simply stays null).
 */
export async function resolveTaskContact(task: {
  requested_by_contact?: { id: string; name: string | null; email: string; client_id: string } | null;
  client_id?: string | null;
  site?: { client_id: string | null } | null;
}) {
  if (task.requested_by_contact) return task.requested_by_contact;

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
