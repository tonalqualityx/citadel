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
 * Log a portal session (access, view, action)
 */
export async function logPortalSession(input: {
  tokenType: 'proposal' | 'msa' | 'contract' | 'addendum';
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
