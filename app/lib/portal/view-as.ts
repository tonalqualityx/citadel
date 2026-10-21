/**
 * "View as client" (read-only impersonation) for Citadel admins.
 *
 * An admin opens a client's record and starts a view. That mints a portal session row in the same
 * table and cookie the portal already uses (`client_session`), flagged `action = 'view_as'` with the
 * admin's user id in metadata. The portal then renders exactly what a contact with the chosen role
 * would see. Hard properties, enforced in code and covered by tests:
 *  - READ ONLY: every write route under /api/portal and /api/portal-chat calls refuseIfViewAs()
 *    first and answers 403 (see view-as-guard.ts). Nothing emails, files a task or moves a wait.
 *  - SHORT: 30 minutes from creation. The session never slides, and a row older than that is dead
 *    even if its expires_at was altered.
 *  - BOUND: to one admin, one client and one role. The role comes from the row, never the request.
 *  - AUDITED: the start writes an ActivityLog row on the client before any session exists.
 *  - ISOLATED: the admin's normal Citadel session (access_token) is never touched.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { isPortalRole, type PortalRole } from '@/lib/portal/access';

export const VIEW_AS_ACTION = 'view_as';
export const VIEW_AS_TTL_MINUTES = 30;
export const VIEW_AS_TTL_MS = VIEW_AS_TTL_MINUTES * 60 * 1000;
/** Roles an admin may choose to view as. Never `none`. */
export const VIEW_AS_ROLES = ['owner', 'member', 'viewer'] as const;
export type ViewAsRole = (typeof VIEW_AS_ROLES)[number];

export function isViewAsRole(value: unknown): value is ViewAsRole {
  return typeof value === 'string' && (VIEW_AS_ROLES as readonly string[]).includes(value);
}

export interface ViewAsInfo {
  adminUserId: string;
  role: PortalRole;
}

/** Reads the view-as marker back from a session row's metadata. Null when malformed. */
export function readViewAsMetadata(metadata: unknown): ViewAsInfo | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  if (m.view_as !== true || typeof m.admin_user_id !== 'string' || !isViewAsRole(m.role)) return null;
  return { adminUserId: m.admin_user_id, role: m.role };
}

export type StartViewAsResult =
  | { ok: true; sessionToken: string; expiresAt: Date; clientName: string; role: ViewAsRole }
  | { ok: false; reason: 'client_not_found' | 'no_contact' };

/**
 * Start a view. Picks the contact the view is attributed to (one holding the chosen role if there
 * is one, else any live contact), ends the admin's earlier views, writes the audit row, then
 * mints the session. If the audit row cannot be written no session is created.
 */
export async function startViewAsSession(input: {
  adminUserId: string;
  clientId: string;
  role: ViewAsRole;
  ipAddress: string;
  userAgent: string | null;
}): Promise<StartViewAsResult> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, is_deleted: false },
    select: { id: true, name: true },
  });
  if (!client) return { ok: false, reason: 'client_not_found' };

  const contacts = await prisma.clientContact.findMany({
    where: { client_id: client.id, is_deleted: false },
    select: { id: true, portal_role: true },
    orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
  });
  const contact = contacts.find((c) => c.portal_role === input.role) ?? contacts[0];
  if (!contact) return { ok: false, reason: 'no_contact' };

  const now = new Date();
  // One live view per admin: starting a new one ends the old one.
  await prisma.portalSession.updateMany({
    where: {
      token_type: 'client_session',
      action: VIEW_AS_ACTION,
      revoked_at: null,
      metadata: { path: ['admin_user_id'], equals: input.adminUserId },
    },
    data: { revoked_at: now },
  });

  await prisma.activityLog.create({
    data: {
      user_id: input.adminUserId,
      action: 'view_as_started',
      entity_type: 'client',
      entity_id: client.id,
      entity_name: client.name,
      changes: { role: { from: null, to: input.role }, minutes: { from: null, to: VIEW_AS_TTL_MINUTES } },
    },
  });

  const sessionToken = randomBytes(64).toString('hex');
  const expiresAt = new Date(now.getTime() + VIEW_AS_TTL_MS);
  await prisma.portalSession.create({
    data: {
      token_type: 'client_session',
      entity_id: client.id,
      contact_id: contact.id,
      session_token: sessionToken,
      expires_at: expiresAt,
      consumed_at: now,
      action: VIEW_AS_ACTION,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      metadata: { view_as: true, admin_user_id: input.adminUserId, role: input.role },
    },
  });

  return { ok: true, sessionToken, expiresAt, clientName: client.name, role: input.role };
}

/** End a view by its cookie token. Idempotent. Returns the client the view was on, if any. */
export async function endViewAsSession(sessionToken: string): Promise<{ clientId: string } | null> {
  if (!sessionToken) return null;
  const row = await prisma.portalSession.findFirst({
    where: { session_token: sessionToken, token_type: 'client_session', action: VIEW_AS_ACTION },
    select: { id: true, entity_id: true },
  });
  if (!row) return null;
  await prisma.portalSession.updateMany({ where: { id: row.id, revoked_at: null }, data: { revoked_at: new Date() } });
  return { clientId: row.entity_id };
}
