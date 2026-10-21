/**
 * Portal access control (client portal MVP, A3).
 *
 * The ONE place that decides what a logged-in contact may see or do. Pure functions plus Prisma
 * where-fragment builders, so routes and tests share a single rule (same pattern as visibility.ts,
 * which decides which TASKS are shown; this module decides which CLIENTS, PROJECTS and ACTIONS).
 *
 * Model (spec section 2):
 *  - One client-level role per contact: owner | member | viewer | none (ClientContact.portal_role).
 *  - Agency-partner contacts inherit their role onto every sub-client (Client.parent_agency_id).
 *    Sub-client contacts see only their own client.
 *  - Projects: portal_visibility inherit | restricted | hidden.
 *      hidden     -> nobody, owners included
 *      inherit    -> the client role applies
 *      restricted -> the client role applies to owners only
 *  - ProjectContact grants (member | viewer) only RAISE access: effective = max(base, grant).
 *    There are no deny rows.
 *  - Owners see every non-hidden project. Billing is owner-only. Analytics need any client role.
 *  - can_initiate_work is derived from the role (owner and member = true).
 *  - Deleted contacts have no access.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type PortalRole = 'owner' | 'member' | 'viewer' | 'none';
export type PortalVisibility = 'inherit' | 'restricted' | 'hidden';

/** Roles a ProjectContact grant may carry (API-enforced, grants never lower access). */
export const GRANTABLE_ROLES = ['member', 'viewer'] as const;

/** Project statuses that are pre-kickoff and stay hidden from the portal. */
export const PORTAL_HIDDEN_PROJECT_STATUSES = ['quote', 'queue'] as const;

const RANK: Record<PortalRole, number> = { none: 0, viewer: 1, member: 2, owner: 3 };

export function isPortalRole(value: unknown): value is PortalRole {
  return value === 'owner' || value === 'member' || value === 'viewer' || value === 'none';
}

export function maxRole(a: PortalRole, b: PortalRole): PortalRole {
  return RANK[a] >= RANK[b] ? a : b;
}

// ---- capabilities -------------------------------------------------------------------------

/** Owner and member may file requests, approve, request changes and answer questions. */
export function canActOnWork(role: PortalRole): boolean {
  return role === 'owner' || role === 'member';
}

/** can_initiate_work is derived from the role. */
export function canInitiateWorkForRole(role: PortalRole): boolean {
  return canActOnWork(role);
}

/** Billing is owner-only. */
export function canSeeBilling(role: PortalRole): boolean {
  return role === 'owner';
}

/** Analytics (revenue included) go to any client-level role; project-only contacts see none. */
export function canSeeAnalytics(role: PortalRole): boolean {
  return role !== 'none';
}

/**
 * Normalise a contact write so portal_role and can_initiate_work never disagree.
 *  - portal_role given: it wins, can_initiate_work is derived from it.
 *  - only can_initiate_work given (legacy callers): the role is nudged to match
 *    (true lifts viewer/none to member, false lowers owner/member to viewer).
 *  - neither: nothing to write.
 * `current` is the stored role (undefined on create, which falls back to the schema default viewer).
 */
export function deriveContactPortalFields(
  input: { portal_role?: PortalRole; can_initiate_work?: boolean },
  current?: PortalRole
): { portal_role?: PortalRole; can_initiate_work?: boolean } {
  if (input.portal_role !== undefined) {
    return { portal_role: input.portal_role, can_initiate_work: canInitiateWorkForRole(input.portal_role) };
  }
  if (input.can_initiate_work !== undefined) {
    const base: PortalRole = current ?? 'viewer';
    if (input.can_initiate_work === canInitiateWorkForRole(base)) {
      return { portal_role: base, can_initiate_work: input.can_initiate_work };
    }
    const role: PortalRole = input.can_initiate_work ? 'member' : 'viewer';
    return { portal_role: role, can_initiate_work: input.can_initiate_work };
  }
  return {};
}

// ---- role resolution (pure) -----------------------------------------------------------------

export interface ContactAccessFields {
  client_id: string;
  portal_role: PortalRole;
  is_deleted?: boolean;
}

/**
 * Effective role of a contact on a client. Own client: the contact's role. A client whose
 * parent_agency_id is the contact's client: the same role (agency inheritance). Anything else
 * (including sub-client contacts looking at the agency or a sibling): none.
 */
export function effectiveClientRole(
  contact: ContactAccessFields | null | undefined,
  client: { id: string; parent_agency_id?: string | null }
): PortalRole {
  if (!contact || contact.is_deleted) return 'none';
  if (contact.client_id === client.id) return contact.portal_role;
  if (client.parent_agency_id && client.parent_agency_id === contact.client_id) return contact.portal_role;
  return 'none';
}

/** Effective role on a project: hidden -> none; restricted -> base only for owners; grants raise. */
export function effectiveProjectRole(input: {
  clientRole: PortalRole;
  visibility: PortalVisibility;
  grantRole?: PortalRole | null;
}): PortalRole {
  if (input.visibility === 'hidden') return 'none';
  let base = input.clientRole;
  if (input.visibility === 'restricted' && base !== 'owner') base = 'none';
  const grant: PortalRole = input.grantRole === 'member' || input.grantRole === 'viewer' ? input.grantRole : 'none';
  return maxRole(base, grant);
}

// ---- Prisma where builders ------------------------------------------------------------------

export interface PortalAccess {
  contactId: string;
  clientId: string;
  role: PortalRole;
  /**
   * True when the contact row is deleted/missing or the active client no longer resolves. A
   * revoked contact matches nothing, grants included (role none alone would still match
   * ProjectContact grants).
   */
  revoked?: boolean;
}

const MATCH_NOTHING = { id: { in: [] as string[] } };

/**
 * Project visibility for a contact, WITHOUT status or deletion filters (so tasks of any project
 * the contact may see can be matched). Spread under AND.
 */
export function projectAccessScope(
  access: Pick<PortalAccess, 'contactId' | 'role' | 'revoked'>
): Prisma.ProjectWhereInput {
  if (access.revoked) return MATCH_NOTHING;
  const grant: Prisma.ProjectWhereInput = { contact_grants: { some: { contact_id: access.contactId, role: { in: [...GRANTABLE_ROLES] } } } };
  const notHidden: Prisma.ProjectWhereInput = { portal_visibility: { not: 'hidden' } };
  if (access.role === 'owner') return notHidden;
  if (access.role === 'none') return { AND: [notHidden, grant] };
  return { AND: [notHidden, { OR: [{ portal_visibility: 'inherit' }, grant] }] };
}

/** Where for projects the contact may see on their active client (no hidden, no quote/queue). */
export function projectAccessWhere(access: PortalAccess): Prisma.ProjectWhereInput {
  return {
    client_id: access.clientId,
    is_deleted: false,
    status: { notIn: [...PORTAL_HIDDEN_PROJECT_STATUSES] },
    AND: [projectAccessScope(access)],
  };
}

/**
 * Where-fragment narrowing tasks to the projects the contact may see. Tasks without a project
 * are client-level work: any client role sees them, project-only contacts do not.
 */
export function taskAccessWhere(access: PortalAccess): Prisma.TaskWhereInput {
  if (access.revoked) return MATCH_NOTHING;
  const inProject: Prisma.TaskWhereInput = { project: projectAccessScope(access) };
  if (access.role === 'none') return inProject;
  return { OR: [{ project_id: null }, inProject] };
}

// TODO(A4): role is resolved from the session's contact row only, so a person with contact rows
// on two clients gets role none after switching the active client. Spec section 2 resolves a
// person by lowercased email across non-deleted ClientContact rows; do that when the picker lands.

// ---- session -> access ----------------------------------------------------------------------

/**
 * Resolve the signed-in contact's role on the session's active client. Re-checked per request
 * (deleted contact -> none, role changes take effect immediately). Own client costs one query;
 * a different client (A4 picker) adds one lookup to apply the agency rule.
 */
export async function loadPortalAccess(session: { contactId: string; clientId: string }): Promise<PortalAccess> {
  const contact = await prisma.clientContact.findFirst({
    where: { id: session.contactId, is_deleted: false },
    select: { client_id: true, portal_role: true, is_deleted: true },
  });
  const revoked = { contactId: session.contactId, clientId: session.clientId, role: 'none' as const, revoked: true };
  if (!contact) return revoked;

  let client: { id: string; parent_agency_id: string | null } = {
    id: session.clientId,
    parent_agency_id: null,
  };
  if (contact.client_id !== session.clientId) {
    const found = await prisma.client.findFirst({
      where: { id: session.clientId, is_deleted: false },
      select: { id: true, parent_agency_id: true },
    });
    if (!found) return revoked;
    client = found;
  }

  return {
    contactId: session.contactId,
    clientId: session.clientId,
    role: effectiveClientRole(contact as ContactAccessFields, client),
  };
}
