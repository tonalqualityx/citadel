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

/**
 * Project statuses that are NOT client-visible. Visible set: ready, in_progress, review, done.
 *  - quote, queue: pre-kickoff (proposal stage / approved but not started).
 *  - suspended: on hold, tasks hidden internally (ProjectStatus enum comment).
 *  - cancelled: dead work the client has no reason to browse.
 */
export const PORTAL_HIDDEN_PROJECT_STATUSES = ['quote', 'queue', 'suspended', 'cancelled'] as const;

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
  /** All of the person's contact rows; grants match on any of them. Defaults to [contactId]. */
  contactIds?: string[];
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
 * Project visibility for a contact: excludes deleted projects and projects whose status is not
 * client-visible (PORTAL_HIDDEN_PROJECT_STATUSES), then applies portal_visibility and grants.
 * Spread under AND. Shared by projectAccessWhere and taskAccessWhere.
 */
export function projectAccessScope(
  access: Pick<PortalAccess, 'contactId' | 'contactIds' | 'role' | 'revoked'>
): Prisma.ProjectWhereInput {
  if (access.revoked) return MATCH_NOTHING;
  // One contact id keeps the exact A3 shape; several (the person has more than one row) use `in`.
  const ids = access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];
  const grant: Prisma.ProjectWhereInput = {
    contact_grants: {
      some: { contact_id: ids.length === 1 ? ids[0] : { in: ids }, role: { in: [...GRANTABLE_ROLES] } },
    },
  };
  const notHidden: Prisma.ProjectWhereInput = {
    is_deleted: false,
    status: { notIn: [...PORTAL_HIDDEN_PROJECT_STATUSES] },
    portal_visibility: { not: 'hidden' },
  };
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

// ---- people: accessible clients (A4) ----------------------------------------------------------

/**
 * Where-fragment for a contact row that may hold a portal session: not deleted, client not
 * deleted, and either a client-level role or at least one project grant (project-only contact,
 * spec section 2). Used by sign-in, session validation and the role-none revocation rule.
 */
/**
 * THE client-visible project rule for grants: not deleted, not hidden, not in a hidden status, on
 * a live client. The sign-in filter, accessible-client resolution and the role-none revocation
 * count all use this one fragment, so a grant on a project the client can never see cannot keep
 * a contact signed in or surface a client.
 */
export const PORTAL_GRANTABLE_PROJECT_WHERE: Prisma.ProjectWhereInput = {
  is_deleted: false,
  status: { notIn: [...PORTAL_HIDDEN_PROJECT_STATUSES] },
  portal_visibility: { not: 'hidden' },
  client: { is_deleted: false },
};

export const PORTAL_SIGNIN_CONTACT_WHERE: Prisma.ClientContactWhereInput = {
  is_deleted: false,
  client: { is_deleted: false },
  OR: [
    { portal_role: { not: 'none' } },
    { project_grants: { some: { role: { in: [...GRANTABLE_ROLES] }, project: PORTAL_GRANTABLE_PROJECT_WHERE } } },
  ],
};

export interface AccessibleClient {
  clientId: string;
  name: string;
  /** Client-level role on that client. 'none' = project-only access (granted projects only). */
  role: PortalRole;
  /** The contact row that carries the role on this client (approvals are attributed to it). */
  contactId: string;
  /** EVERY contact row the person holds (grants may sit on any of them). Grants are matched on these. */
  contactIds: string[];
  via: 'direct' | 'agency' | 'project';
}

export interface AccessContactRow {
  id: string;
  client_id: string;
  portal_role: PortalRole;
  client: { id: string; name: string };
}
export interface AccessSubClientRow {
  id: string;
  name: string;
  parent_agency_id: string | null;
}
export interface AccessGrantRow {
  contact_id: string;
  role: PortalRole;
  project: { client_id: string; client: { id: string; name: string } };
}

/**
 * Pure core of resolveAccessibleClients (spec section 2). Inputs are the person's non-deleted
 * contact rows, the live sub-clients of the clients those rows sit on, and their project grants.
 *  - a contact with a role other than none gives that client at that role (direct);
 *  - the same role is inherited onto every sub-client whose parent_agency_id is that client
 *    (agency); a sub-client contact never reaches the agency or a sibling, because inheritance
 *    only flows down;
 *  - a grant on a client where no client-level role exists gives that client at role none
 *    (project), granted projects only;
 *  - one entry per client; the highest role wins, direct beats agency beats project on a tie.
 * Sorted by name so the picker order is stable.
 */
export function buildAccessibleClients(input: {
  contacts: AccessContactRow[];
  subClients: AccessSubClientRow[];
  grants: AccessGrantRow[];
}): AccessibleClient[] {
  const byClient = new Map<string, AccessibleClient>();
  const ORDER = { direct: 3, agency: 2, project: 1 } as const;
  const contactIds = input.contacts.map((c) => c.id);
  const put = (entry: AccessibleClient) => {
    const cur = byClient.get(entry.clientId);
    if (
      !cur ||
      RANK[entry.role] > RANK[cur.role] ||
      (RANK[entry.role] === RANK[cur.role] && ORDER[entry.via] > ORDER[cur.via])
    ) {
      byClient.set(entry.clientId, entry);
    }
  };

  for (const c of input.contacts) {
    if (c.portal_role === 'none') continue;
    put({ clientId: c.client_id, name: c.client.name, role: c.portal_role, contactId: c.id, contactIds, via: 'direct' });
    for (const sub of input.subClients) {
      if (sub.parent_agency_id === c.client_id) {
        put({ clientId: sub.id, name: sub.name, role: c.portal_role, contactId: c.id, contactIds, via: 'agency' });
      }
    }
  }
  for (const g of input.grants) {
    if (!(GRANTABLE_ROLES as readonly string[]).includes(g.role)) continue;
    const client = g.project.client;
    put({ clientId: client.id, name: client.name, role: 'none', contactId: g.contact_id, contactIds, via: 'project' });
  }
  return [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name) || a.clientId.localeCompare(b.clientId));
}

/**
 * The clients a PERSON can reach, found by lowercased email across all their non-deleted
 * ClientContact rows, plus agency inheritance and project-only grants. Always read fresh, so a
 * deleted contact, a role set to none or a removed grant drops the client on the next request.
 */
export async function resolveAccessibleClients(email: string): Promise<AccessibleClient[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const contacts = (await prisma.clientContact.findMany({
    where: { email: { equals: normalized, mode: 'insensitive' }, is_deleted: false, client: { is_deleted: false } },
    select: { id: true, client_id: true, portal_role: true, client: { select: { id: true, name: true } } },
  })) as AccessContactRow[];
  if (contacts.length === 0) return [];

  const agencyIds = [...new Set(contacts.filter((c) => c.portal_role !== 'none').map((c) => c.client_id))];
  const [subClients, grants] = await Promise.all([
    agencyIds.length
      ? prisma.client.findMany({
          where: { parent_agency_id: { in: agencyIds }, is_deleted: false },
          select: { id: true, name: true, parent_agency_id: true },
        })
      : Promise.resolve([] as AccessSubClientRow[]),
    prisma.projectContact.findMany({
      where: {
        contact_id: { in: contacts.map((c) => c.id) },
        role: { in: [...GRANTABLE_ROLES] },
        project: PORTAL_GRANTABLE_PROJECT_WHERE,
      },
      select: {
        contact_id: true,
        role: true,
        project: { select: { client_id: true, client: { select: { id: true, name: true } } } },
      },
    }) as Promise<AccessGrantRow[]>,
  ]);

  return buildAccessibleClients({ contacts, subClients: subClients as AccessSubClientRow[], grants });
}

// ---- session -> access ----------------------------------------------------------------------

/**
 * Resolve the signed-in contact's role on the session's active client. A session from
 * requireClientAuth() already carries its role (resolved by email, A4); the lookup below is the
 * fallback for bare {contactId, clientId} callers. Re-checked per request
 * (deleted contact -> none, role changes take effect immediately). Own client costs one query;
 * a different client (A4 picker) adds one lookup to apply the agency rule.
 */
export async function loadPortalAccess(session: {
  contactId: string;
  clientId: string;
  contactIds?: string[];
  /** Present on sessions from requireClientAuth(): already resolved by email this request. */
  role?: PortalRole;
}): Promise<PortalAccess> {
  if (session.role !== undefined) {
    return {
      contactId: session.contactId,
      ...(session.contactIds ? { contactIds: session.contactIds } : {}),
      clientId: session.clientId,
      role: session.role,
    };
  }
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
