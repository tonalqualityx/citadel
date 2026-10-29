/**
 * Designer Portal operator keys (Mike's ruling, 2026-10-29: "maximum automation with Bast acting on my commands").
 *
 * W8.2 H7 made every non-worker /api/design route session-only. Two narrow API-key scopes reopen exactly two
 * doors, and THIS FILE is the one allowlist for both (route-kit's authActor reads it; nothing else may):
 *
 *   design:operator-setup    the design ADMIN configuration routes (settings, per-site switches, Drive folders,
 *                            budgets, the overview lists). Nothing else.
 *   design:operator-publish  the key acts as an ADMIN publisher: publish intent, confirm, rollback, and the reads
 *                            it needs to see the head and the gates (the session, its feed, the publish page). It
 *                            runs the admin server path unchanged: gate precheck, two-step confirmation (token +
 *                            typed main branch; the caller performs both steps), box re-check, receipts, FYI.
 *
 * A key is an operator only when ALL hold, checked on every call (authActor):
 *   - the route opted in for that scope AND the proxy-stamped route (x-citadel-route) is in DESIGN_OPERATOR_ROUTES;
 *   - the key (re-read from the database) is not revoked, belongs to the caller, carries the scope, has no lane;
 *   - the key's user's DATABASE role is admin.
 * Anything else is the H7 answer: 403 session_required. The scopes are granted only from a signed-in admin
 * session (lib/auth/key-scopes.ts HUMAN_GRANTED_SCOPES), never by any API key, never on a lane key; revoking the
 * key or PATCHing the scope away ends it on the next call.
 *
 * The designer's worker can never become an operator: it holds a lane key (lane:design-worker, always enforced),
 * which the lane allowlist confines to /api/design/worker/** and which can never carry these scopes. It still has
 * no publish tool.
 */
import { DESIGN_OPERATOR_PUBLISH_SCOPE, DESIGN_OPERATOR_SETUP_SCOPE } from '@/lib/auth/key-scopes';
import { patternMatches, type LaneMethod } from '@/lib/auth/lane-scopes';

export type OperatorKind = 'setup' | 'publish';

export const OPERATOR_SCOPE: Record<OperatorKind, string> = {
  setup: DESIGN_OPERATOR_SETUP_SCOPE,
  publish: DESIGN_OPERATOR_PUBLISH_SCOPE,
};

export interface OperatorRoute {
  method: LaneMethod;
  pattern: string;
}

const r = (method: LaneMethod, pattern: string): OperatorRoute => ({ method, pattern });

/** THE allowlist. A route not listed here answers 403 session_required to every API key, scope or not. */
export const DESIGN_OPERATOR_ROUTES: Readonly<Record<OperatorKind, readonly OperatorRoute[]>> = {
  setup: [
    r('GET', '/api/design/admin/settings'),
    r('PATCH', '/api/design/admin/settings'),
    r('GET', '/api/design/admin/sites'),
    r('PATCH', '/api/design/admin/sites/:id'),
    r('GET', '/api/design/admin/clients/:id'),
    r('PATCH', '/api/design/admin/clients/:id'),
    r('GET', '/api/design/admin/projects/:id'),
    r('PATCH', '/api/design/admin/projects/:id'),
    r('GET', '/api/design/admin/budgets'),
    r('PUT', '/api/design/admin/budgets/:userId'),
    r('PATCH', '/api/design/admin/budgets/:userId'),
    r('GET', '/api/design/admin/sessions'),
    r('GET', '/api/design/admin/publishes'),
  ],
  publish: [
    r('POST', '/api/design/sessions/:id/publish'),
    r('POST', '/api/design/publishes/:id/confirm'),
    r('POST', '/api/design/publishes/:id/rollback'),
    r('GET', '/api/design/publishes/:id'),
    r('GET', '/api/design/sessions/:id'),
    r('GET', '/api/design/sessions/:id/feed'),
  ],
};

export function operatorRouteAllowed(kind: OperatorKind, method: string, path: string): boolean {
  const m = method.toUpperCase();
  return DESIGN_OPERATOR_ROUTES[kind].some((rt) => rt.method === m && patternMatches(rt.pattern, path));
}

/** How the publish row records its actor (DesignPublish.actor_via). */
export type PublishActorVia = 'session' | 'operator_key';

/** Who the comment and the FYI name for an operator-key publish: the key acts for its user, Bast types it. */
export const OPERATOR_LABEL = 'Bast';

/** "Mike Dion" -> "Mike" (the comment says "on Mike's instruction"). */
export function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n || 'the key owner';
}

export function operatorPhrase(actorName: string | null | undefined): string {
  return `${OPERATOR_LABEL} on ${firstName(actorName)}'s instruction`;
}
