import { patternMatches, parseRouteHeader } from './lane-scopes';

/**
 * Designer Portal (design D1): the only API routes a `designer` session may call. Deny by default:
 * requireAuth() refuses every other /api route for a user whose DATABASE role is `designer`, using
 * the x-citadel-route header that proxy.ts stamps (and overwrites) on every /api request.
 *
 * Exact list from feature-planning/designer-portal-design.md section 5 D1, plus
 * POST /api/design/publishes/:id/confirm (added by ruling) and the D11 client-files refresh (W2.8), and POST /api/design/work (start new work on a site with no pre-existing task). Change it only with the design doc.
 */
export interface DesignerRoute {
  method: 'GET' | 'POST' | 'PATCH';
  pattern: string;
}

export const DESIGNER_ROUTES: readonly DesignerRoute[] = [
  { method: 'GET', pattern: '/api/auth/me' },
  { method: 'GET', pattern: '/api/design/tasks' },
  { method: 'GET', pattern: '/api/design/sessions' },
  { method: 'POST', pattern: '/api/design/sessions' },
  { method: 'POST', pattern: '/api/design/work' },
  { method: 'GET', pattern: '/api/design/sessions/:id' },
  { method: 'GET', pattern: '/api/design/sessions/:id/feed' },
  { method: 'POST', pattern: '/api/design/sessions/:id/messages' },
  { method: 'POST', pattern: '/api/design/sessions/:id/pins' },
  { method: 'PATCH', pattern: '/api/design/pins/:id' },
  { method: 'POST', pattern: '/api/design/sessions/:id/apply' },
  { method: 'POST', pattern: '/api/design/sessions/:id/stop' },
  { method: 'PATCH', pattern: '/api/design/changes/:id' },
  { method: 'POST', pattern: '/api/design/sessions/:id/restore' },
  { method: 'POST', pattern: '/api/design/sessions/:id/budget' },
  { method: 'POST', pattern: '/api/design/sessions/:id/publish' },
  { method: 'POST', pattern: '/api/design/publishes/:id/confirm' },
  { method: 'POST', pattern: '/api/design/sessions/:id/request-publish' },
  { method: 'POST', pattern: '/api/design/sessions/:id/close' },
  { method: 'GET', pattern: '/api/design/publishes/:id' },
  { method: 'POST', pattern: '/api/design/publishes/:id/rollback' },
  { method: 'GET', pattern: '/api/design/sessions/:id/assets/:assetId' },
  { method: 'POST', pattern: '/api/design/sessions/:id/client-files/refresh' },
];

/**
 * True when a designer session may call `method` on `path` (the two halves of the x-citadel-route
 * header that proxy.ts writes, "<METHOD> <pathname>"). Same matcher as the lane keys.
 */
export function designerMayCall(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return DESIGNER_ROUTES.some((rt) => rt.method === m && patternMatches(rt.pattern, path));
}

/** designerMayCall on a raw x-citadel-route value. Missing or malformed is false (fail closed). */
export function designerMayCallRoute(routeHeader: string | null | undefined): boolean {
  const route = parseRouteHeader(routeHeader);
  return route !== null && designerMayCall(route.method, route.path);
}
