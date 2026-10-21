/**
 * Who must act on a wait (specs/citadel-shape-SPEC.md section 2.3).
 *
 * Order: the stand-in while the owner is away; the person the escalation ladder handed it to;
 * the named person; the holder of the role on the project, then the charter, then the client
 * team; for the sales role, the accord owner; else Mike. A client-owned wait resolves the
 * internal shepherd (the liaison unless the template names another role), who acts when its
 * clock fires. Empty always means Mike.
 *
 * Pure over an injected `OwnerLookups`, so the order is unit-tested without a database. The
 * Prisma implementation is at the bottom. Phase 1 has no charter or client team table (they
 * land in phase 3), so those two lookups return null until then; the project team table exists
 * and covers every project-linked wait.
 */

import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import type { RoleKey } from './templates';

export { MIKE_USER_ID };

export type OwnerSource =
  | 'stand_in'
  | 'escalated'
  | 'person'
  | 'role_project'
  | 'role_charter'
  | 'role_client'
  | 'accord_owner'
  | 'bast'
  | 'switch_owner'
  | 'mike';

export interface ResolvedOwner {
  user_id: string;
  source: OwnerSource;
  /** The role that was looked up, when one was. */
  role_key: RoleKey | null;
}

export interface OwnerInput {
  owner_user_id?: string | null;
  owner_function_id?: string | null;
  owner_contact_id?: string | null;
  stand_in_user_id?: string | null;
  escalated_to_user_id?: string | null;
  project_id?: string | null;
  charter_id?: string | null;
  client_id?: string | null;
  accord_id?: string | null;
  /** The wait's action_payload (carries owner_role, shepherd_role, switch_owner_user_id). */
  action_payload?: unknown;
}

export interface RoleScope {
  role: RoleKey;
  function_id?: string | null;
}

export interface OwnerLookups {
  isActiveUser(userId: string): Promise<boolean>;
  /** Role name of a function (for owner_function_id), e.g. "Project Manager". */
  functionName(functionId: string): Promise<string | null>;
  projectRoleHolder(projectId: string, scope: RoleScope): Promise<string | null>;
  charterRoleHolder(charterId: string, scope: RoleScope): Promise<string | null>;
  clientRoleHolder(clientId: string, scope: RoleScope, charterId?: string | null): Promise<string | null>;
  accordOwner(accordId: string): Promise<string | null>;
}

/** Function names that fill each role (spec 3.2 `Function.role_key` grouping, held in code until phase 3). */
export const ROLE_FUNCTION_NAMES: Partial<Record<RoleKey, string[]>> = {
  pm: ['Project Manager'],
  design: ['Design I', 'Design II', 'Design III'],
  content: ['Content Writer II', 'Content Writer', 'Content Writer I', 'Content Writer III'],
  liaison: ['Customer Success Manager'],
  wordpress: ['Wordpress Tech I', 'Wordpress Tech II', 'Wordpress Tech III', 'WordPress Tech I', 'WordPress Tech II', 'WordPress Tech III'],
  billing: ['Accounts Receivable'],
  social: ['Social Media Manager'],
};

export function roleKeyForFunctionName(name: string | null | undefined): RoleKey | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  for (const [role, names] of Object.entries(ROLE_FUNCTION_NAMES) as [RoleKey, string[]][]) {
    if (names.some((x) => x.toLowerCase() === n)) return role;
  }
  return null;
}

function payloadOf(input: OwnerInput): Record<string, unknown> {
  return input.action_payload && typeof input.action_payload === 'object'
    ? (input.action_payload as Record<string, unknown>)
    : {};
}

function asRole(v: unknown): RoleKey | null {
  return typeof v === 'string' ? (v as RoleKey) : null;
}

const mike = (role_key: RoleKey | null = null): ResolvedOwner => ({ user_id: MIKE_USER_ID, source: 'mike', role_key });

async function roleHolder(
  input: OwnerInput,
  role: RoleKey,
  lookups: OwnerLookups,
  function_id: string | null
): Promise<ResolvedOwner | null> {
  const scope: RoleScope = { role, function_id };
  if (input.project_id) {
    const id = await lookups.projectRoleHolder(input.project_id, scope);
    if (id && (await lookups.isActiveUser(id))) return { user_id: id, source: 'role_project', role_key: role };
  }
  if (input.charter_id) {
    const id = await lookups.charterRoleHolder(input.charter_id, scope);
    if (id && (await lookups.isActiveUser(id))) return { user_id: id, source: 'role_charter', role_key: role };
  }
  if (input.client_id) {
    const id = await lookups.clientRoleHolder(input.client_id, scope, input.charter_id);
    if (id && (await lookups.isActiveUser(id))) return { user_id: id, source: 'role_client', role_key: role };
  }
  return null;
}

export async function resolveOwner(input: OwnerInput, lookups: OwnerLookups): Promise<ResolvedOwner> {
  // 1. Stand-in while the owner is away.
  if (input.stand_in_user_id && (await lookups.isActiveUser(input.stand_in_user_id))) {
    return { user_id: input.stand_in_user_id, source: 'stand_in', role_key: null };
  }
  // 2. The person the escalation ladder handed it to.
  if (input.escalated_to_user_id && (await lookups.isActiveUser(input.escalated_to_user_id))) {
    return { user_id: input.escalated_to_user_id, source: 'escalated', role_key: null };
  }
  // 3. A named person wins over the role.
  if (input.owner_user_id && (await lookups.isActiveUser(input.owner_user_id))) {
    return { user_id: input.owner_user_id, source: 'person', role_key: null };
  }

  const payload = payloadOf(input);
  const fnName = input.owner_function_id ? await lookups.functionName(input.owner_function_id) : null;
  // A role chosen on the wait itself beats the template default.
  let role: RoleKey | null = roleKeyForFunctionName(fnName) ?? asRole(payload.owner_role);

  // A client-owned wait is shepherded internally: the liaison unless the template says otherwise.
  if (input.owner_contact_id || role === 'client') {
    role = asRole(payload.shepherd_role) ?? 'liaison';
  }

  if (!role || role === 'mike') return mike(role);
  if (role === 'bast') return { user_id: BAST_USER_ID, source: 'bast', role_key: role };
  if (role === 'switch_owner') {
    const id = payload.switch_owner_user_id;
    if (typeof id === 'string' && (await lookups.isActiveUser(id))) {
      return { user_id: id, source: 'switch_owner', role_key: role };
    }
    return mike(role);
  }
  if (role === 'sales') {
    if (input.accord_id) {
      const id = await lookups.accordOwner(input.accord_id);
      if (id && (await lookups.isActiveUser(id))) return { user_id: id, source: 'accord_owner', role_key: role };
    }
    return mike(role);
  }

  const holder = await roleHolder(input, role, lookups, input.owner_function_id ?? null);
  return holder ?? mike(role);
}

/** True when the wait lands on Mike (his own, or an empty owner, or nobody else can act). */
export async function resolvesToMike(input: OwnerInput, lookups: OwnerLookups): Promise<boolean> {
  return (await resolveOwner(input, lookups)).user_id === MIKE_USER_ID;
}

/** Caches lookups for the length of one request or sweep pass. */
export function memoizeLookups(inner: OwnerLookups): OwnerLookups {
  const cache = new Map<string, Promise<unknown>>();
  const memo = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    let p = cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn();
      cache.set(key, p);
    }
    return p;
  };
  return {
    isActiveUser: (id) => memo(`u:${id}`, () => inner.isActiveUser(id)),
    functionName: (id) => memo(`f:${id}`, () => inner.functionName(id)),
    projectRoleHolder: (id, s) => memo(`p:${id}:${s.role}:${s.function_id ?? ''}`, () => inner.projectRoleHolder(id, s)),
    charterRoleHolder: (id, s) => memo(`c:${id}:${s.role}:${s.function_id ?? ''}`, () => inner.charterRoleHolder(id, s)),
    clientRoleHolder: (id, s, ch) =>
      memo(`cl:${id}:${ch ?? ''}:${s.role}:${s.function_id ?? ''}`, () => inner.clientRoleHolder(id, s, ch)),
    accordOwner: (id) => memo(`a:${id}`, () => inner.accordOwner(id)),
  };
}

// ---------------------------------------------------------------------------
// Prisma implementation
// ---------------------------------------------------------------------------

type PrismaLike = {
  user: { findUnique(args: unknown): Promise<{ is_active: boolean } | null> };
  function: { findUnique(args: unknown): Promise<{ name: string } | null> };
  projectTeamAssignment: {
    findMany(args: unknown): Promise<Array<{ user_id: string; is_lead: boolean; function: { name: string } }>>;
  };
  accord: { findUnique(args: unknown): Promise<{ owner_id: string } | null> };
};

export function prismaOwnerLookups(db: PrismaLike): OwnerLookups {
  return memoizeLookups({
    async isActiveUser(userId) {
      const u = await db.user.findUnique({ where: { id: userId }, select: { is_active: true } });
      return !!u?.is_active;
    },
    async functionName(functionId) {
      const f = await db.function.findUnique({ where: { id: functionId }, select: { name: true } });
      return f?.name ?? null;
    },
    async projectRoleHolder(projectId, scope) {
      const rows = await db.projectTeamAssignment.findMany({
        where: { project_id: projectId },
        select: { user_id: true, is_lead: true, function: { select: { name: true } } },
      });
      const wanted = rows.filter((r) =>
        scope.function_id ? false : roleKeyForFunctionName(r.function.name) === scope.role
      );
      // An explicit function on the wait matches by id, which needs the id column; refetch narrowly.
      if (scope.function_id) {
        const exact = await db.projectTeamAssignment.findMany({
          where: { project_id: projectId, function_id: scope.function_id },
          select: { user_id: true, is_lead: true, function: { select: { name: true } } },
        });
        return exact.sort((a, b) => Number(b.is_lead) - Number(a.is_lead))[0]?.user_id ?? null;
      }
      return wanted.sort((a, b) => Number(b.is_lead) - Number(a.is_lead))[0]?.user_id ?? null;
    },
    async charterRoleHolder() {
      return null; // charter team arrives in phase 3
    },
    async clientRoleHolder() {
      return null; // client team arrives in phase 3
    },
    async accordOwner(accordId) {
      const a = await db.accord.findUnique({ where: { id: accordId }, select: { owner_id: true } });
      return a?.owner_id ?? null;
    },
  });
}
