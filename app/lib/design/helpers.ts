/**
 * Designer Portal: identity helpers shared by every design route (design sections 5 D1, D2 and 7).
 *
 * Two identities matter here:
 * - The designer worker (the daemon): service user `designer-worker@indelible.bot` with an API key that
 *   carries exactly the `lane:design-worker` scope. `isDesignWorker()` needs BOTH the email and the lane, so
 *   a stolen session for that user, or a non-lane key minted for it, is not the worker.
 * - A person: design rules use the DATABASE role, never the token's (D1). `requireAuth()` keeps returning
 *   the token's role for everything else; a user demoted to designer mid-token must not keep admin powers on
 *   the design routes, so every design rule takes a `DesignActor` built by `resolveDesignActor()`.
 */
import type { PrismaClient, UserRole } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';

export const DESIGN_WORKER_SERVICE_EMAIL = 'designer-worker@indelible.bot';
export const DESIGN_WORKER_LANE = 'design-worker';
/** Task claim holder prefix for a live design session (D8): `design:<task8>`. */
export const DESIGN_CLAIM_HOLDER_PREFIX = 'design:';

/** The first 8 hex characters of a uuid, lower case: the `<task8>` in `design/<task8>` and `design-<task8>`. */
export function task8(taskId: string): string {
  return taskId.replace(/-/g, '').slice(0, 8).toLowerCase();
}

/** The claim holder a design session uses for its task (D4, D8). */
export function designClaimHolder(taskId: string): string {
  return `${DESIGN_CLAIM_HOLDER_PREFIX}${task8(taskId)}`;
}

/** The daemon, and only the daemon: the service email AND the design-worker lane (D2). */
export function isDesignWorker(auth: Pick<AuthPayload, 'email' | 'lane' | 'via'> | null | undefined): boolean {
  if (!auth) return false;
  return (
    auth.via === 'api_key' &&
    typeof auth.email === 'string' &&
    auth.email.toLowerCase() === DESIGN_WORKER_SERVICE_EMAIL &&
    auth.lane === DESIGN_WORKER_LANE
  );
}

/**
 * The caller as the design rules see it. `role` is the DATABASE role; `role_source: 'db'` exists so a raw
 * AuthPayload (token role) cannot be passed where an actor is expected.
 */
export interface DesignActor {
  userId: string;
  email: string;
  role: UserRole;
  via: 'session' | 'api_key' | undefined;
  lane?: string;
  role_source: 'db';
}

export function isDesignerRole(role: string | null | undefined): boolean {
  return role === 'designer';
}

type UserDb = Pick<PrismaClient, 'user'>;

/** Load the caller's DATABASE role. A missing or inactive user is a 401, as in requireAuth(). */
export async function resolveDesignActor(auth: AuthPayload, db: UserDb = defaultDb): Promise<DesignActor> {
  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, role: true, is_active: true },
  });
  if (!user || !user.is_active) throw new AuthError('User not found or inactive', 401);
  return { userId: user.id, email: auth.email, role: user.role, via: auth.via, lane: auth.lane, role_source: 'db' };
}

/** D1: "designer" is decided by the DATABASE role, the same test requireAuth() applies for the allowlist. */
export async function isDesigner(auth: AuthPayload, db: UserDb = defaultDb): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: auth.userId }, select: { role: true } });
  return isDesignerRole(user?.role);
}

/** Build an actor from values already loaded (tests, or a route that selected the role itself). */
export function designActorFrom(input: {
  userId: string;
  email?: string;
  role: UserRole;
  via: 'session' | 'api_key' | undefined;
  lane?: string;
}): DesignActor {
  return { userId: input.userId, email: input.email ?? '', role: input.role, via: input.via, lane: input.lane, role_source: 'db' };
}

/** Money and Decimal-like values as a plain number rounded to cents (Prisma Decimal has toString()). */
export function toUsd(value: number | string | { toString(): string } | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Host of a URL for display ("https://vcdp.pages.dev/" -> "vcdp.pages.dev"); a bare host passes through. */
export function displayHost(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).host || null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
