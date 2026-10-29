/**
 * Designer Portal: the small pieces every /api/design handler shares (design section 7 preamble).
 * Auth + DB-role actor, the cross-site guard, a size-capped JSON body reader (413) and zod parsing (400).
 */
import { NextRequest, NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { headers } from 'next/headers';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { ROUTE_HEADER, laneScopesOf, parseRouteHeader } from '@/lib/auth/lane-scopes';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { resolveDesignActor, type DesignActor } from './helpers';
import { OPERATOR_SCOPE, operatorRouteAllowed, type OperatorKind } from './operator';

export const DEFAULT_BODY_BYTES = 64 * 1024;
/** Publish, confirm, rollback and request-publish bodies are a few fields (W8.2 N1). */
export const PUBLISH_BODY_BYTES = 32 * 1024;

export interface AuthActorOptions {
  /**
   * The operator scope this route accepts in place of a signed-in session (lib/design/operator.ts). Omitted = the
   * route stays session-only. The route must ALSO be listed for that scope in DESIGN_OPERATOR_ROUTES, so opting in
   * a route that is not on the allowlist still answers 403.
   */
  operator?: OperatorKind;
}

/**
 * requireAuth + the DATABASE role as a DesignActor (D1), for the designer and admin routes under /api/design
 * (7.1, 7.2: "session cookie"). An API key of any kind is refused here (403 session_required, W8.2 H7): the
 * designer surface never needs a key, and a leaked admin key must not steer a session a designer later
 * publishes. The worker routes (/api/design/worker/**) never come here; they use worker-kit's requireWorker.
 *
 * The one exception is an operator key (Mike, 2026-10-29) on a route that opts in with `{ operator }`; see
 * operatorActor below. The default (no options) is unchanged: session only.
 */
export async function authActor(opts: AuthActorOptions = {}): Promise<{ auth: AuthPayload; actor: DesignActor }> {
  const auth = await requireAuth();
  if (auth.via === 'session') {
    const actor = await resolveDesignActor(auth);
    return { auth, actor };
  }
  if (!opts.operator) throw sessionRequired();
  return { auth, actor: await operatorActor(auth, opts.operator) };
}

function sessionRequired(): ApiError {
  return new ApiError('A signed-in session is required', 403, 'session_required');
}

/**
 * Every condition, re-checked on every call; any miss is the H7 answer (403 session_required), so a key without
 * the scope, a revoked or lane key, a non-admin owner or an unlisted route looks exactly as before:
 *  1. an API key (not a lane key) with an id;
 *  2. the proxy-stamped route (x-citadel-route; a caller cannot set it) is listed for `kind`;
 *  3. the key row: not revoked, owned by the caller, carries design:operator-<kind>, carries no lane scope;
 *  4. the caller's DATABASE role is admin (an operator always acts as an admin, never as a designer or pm).
 */
async function operatorActor(auth: AuthPayload, kind: OperatorKind): Promise<DesignActor> {
  if (auth.via !== 'api_key' || !auth.apiKeyId || auth.lane) throw sessionRequired();
  const route = parseRouteHeader((await headers()).get(ROUTE_HEADER));
  if (!route || !operatorRouteAllowed(kind, route.method, route.path)) throw sessionRequired();
  const key = await prisma.apiKey.findUnique({
    where: { id: auth.apiKeyId },
    select: { user_id: true, is_revoked: true, scopes: true },
  });
  if (!key || key.is_revoked || key.user_id !== auth.userId) throw sessionRequired();
  if (!key.scopes.includes(OPERATOR_SCOPE[kind]) || laneScopesOf(key.scopes).length > 0) throw sessionRequired();
  const actor = await resolveDesignActor(auth);
  if (actor.role !== 'admin') throw sessionRequired();
  return { ...actor, operator: kind, apiKeyId: auth.apiKeyId };
}

/** Runs the same-origin / JSON content-type guard; returns the rejection response or null. */
export function guardMutation(request: NextRequest): NextResponse | null {
  return rejectCrossSiteRequest(request);
}

/**
 * Admin routes need a signed-in session, never an API key (7.2). A route that admits an operator key passes the
 * kind it opted in with; only an actor authActor admitted for exactly that kind passes.
 */
export function requireSessionVia(actor: Pick<DesignActor, 'via' | 'operator'>, operator?: OperatorKind): void {
  if (actor.via === 'session') return;
  if (operator && actor.via === 'api_key' && actor.operator === operator) return;
  throw sessionRequired();
}

export function requireAdmin(actor: Pick<DesignActor, 'role'>): void {
  if (actor.role !== 'admin') throw new ApiError('Forbidden', 403, 'forbidden');
}

/** Read a JSON body: 413 over `maxBytes`, 400 on invalid JSON, `{}` on an empty body. */
export async function readJsonBody(request: NextRequest, maxBytes = DEFAULT_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError('Request body too large', 413, 'payload_too_large');
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ApiError('Request body too large', 413, 'payload_too_large');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('Request body is not valid JSON', 400, 'invalid_json');
  }
}

/** Parse (throws ZodError -> 400 through handleApiError). */
export function parseWith<T>(schema: ZodType<T>, raw: unknown): T {
  return schema.parse(raw);
}

export async function body<T>(request: NextRequest, schema: ZodType<T>, maxBytes = DEFAULT_BODY_BYTES): Promise<T> {
  return parseWith(schema, await readJsonBody(request, maxBytes));
}

export interface IdParams {
  params: Promise<{ id: string }>;
}
