/**
 * Lane scopes for machine API keys (fleet item 6).
 *
 * A key that carries a `lane:<name>` scope may call only the routes listed for that lane below.
 * The route a request is for comes from the `x-citadel-route` header ("<METHOD> <pathname>"),
 * which `proxy.ts` always overwrites, so a caller cannot choose it.
 *
 * Without `scope-mode:enforce` a lane key is in shadow: a call outside the lane is allowed and a
 * violation row is written. With it, the call is refused with 403. Keys with no lane scope are
 * not touched by any of this.
 *
 * Lanes carry job names (Porter, Bellringer, Courier, Bast); lanes that fit no job keep a plain
 * label. Every lane key is minted for the Bast user except Troubador and Oracle, which keep their
 * service users (LANE_IDENTITY). Each allowlist was built from the code of the lane's readers on
 * 2026-10-22 (inventory in the fleet-6 notes). Patterns are literal path segments plus `:param` segments; no regex comes from
 * data. A `:param` segment never matches a static sibling route listed in `except`.
 */

export const ROUTE_HEADER = 'x-citadel-route';
export const LANE_SCOPE_PREFIX = 'lane:';
export const ENFORCE_SCOPE = 'scope-mode:enforce';

export const LANES = [
  'courier',
  'bellringer',
  'portal-chat-machine',
  'qbo',
  'porter',
  'wright',
  'clarity',
  'bast',
  'audit-lane',
  'troubador',
  'oracle',
] as const;

export type Lane = (typeof LANES)[number];
export type LaneMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface LaneRoute {
  method: LaneMethod;
  pattern: string;
}

const r = (method: LaneMethod, pattern: string): LaneRoute => ({ method, pattern });

/** Who each lane's key is minted for (Mike's ruling 2026-10-22: lanes stop acting as Mike). */
export const LANE_IDENTITY: Record<Lane, 'bast' | 'troubador' | 'oracle'> = {
  courier: 'bast',
  bellringer: 'bast',
  'portal-chat-machine': 'bast',
  qbo: 'bast',
  porter: 'bast',
  wright: 'bast',
  clarity: 'bast',
  bast: 'bast',
  'audit-lane': 'bast',
  troubador: 'troubador',
  oracle: 'oracle',
};

export const LANE_ROUTES: Record<Lane, readonly LaneRoute[]> = {
  // Courier (mail). citadel-mail/drain_outbox.py; citadel-approvals/approval-sender.py
  courier: [
    r('GET', '/api/email-outbox'),
    r('POST', '/api/email-outbox/:id/claim'),
    r('POST', '/api/email-outbox/:id/sent'),
    r('POST', '/api/email-outbox/:id/failed'),
    r('GET', '/api/approval-requests'),
    r('PUT', '/api/approval-requests/:id/sending'),
    r('PUT', '/api/approval-requests/:id/sent'),
    r('PUT', '/api/approval-requests/:id/send-error'),
    r('GET', '/api/portal-notices'),
    r('PUT', '/api/portal-notices/:id/sending'),
    r('PUT', '/api/portal-notices/:id/sent'),
    r('PUT', '/api/portal-notices/:id/send-error'),
  ],
  // Bellringer (clocks). citadel-wait-sweep.sh, citadel-unblock-sweep.sh, the worker runner's
  // unblock call, pipeline/router/runway_cron.py, the citadel-gardener session (read only)
  bellringer: [
    r('POST', '/api/waits/sweep'),
    r('POST', '/api/tasks/unblock-sweep'),
    r('GET', '/api/tasks'),
    r('POST', '/api/tasks'),
    r('GET', '/api/charters'),
    r('GET', '/api/docs'),
  ],
  // Portal chat machine. portal-chat pc_common readers (ingest_replies, sweep_call,
  // sync_site_pages, backfill_analytics_ids), runner.py bot calls, flags.py
  'portal-chat-machine': [
    r('POST', '/api/portal-chat/inbound'),
    r('POST', '/api/portal-chat/inbound/attachments'),
    r('POST', '/api/portal-chat/sweep'),
    r('GET', '/api/portal-chat/status'),
    r('GET', '/api/sites'),
    r('GET', '/api/sites/:id/pages'),
    r('PUT', '/api/sites/:id/pages'),
    r('GET', '/api/tasks'),
    r('GET', '/api/tasks/:id'),
    r('PATCH', '/api/tasks/:id'),
  ],
  // QBO invoice sync. qbo-bridge/sync_invoices.py
  qbo: [
    r('GET', '/api/clients'),
    r('PATCH', '/api/clients/:id'),
    r('POST', '/api/clients/:id/invoices/sync'),
  ],
  // Porter (intake). oracle/clarity/email-classifier.py, inbound/ib_lookups.py,
  // citadel-tasks/create-task.py + content-record.py + hooks/citadel-done-guard.sh,
  // pipeline/router/citadel_client.py (meetings, infer), the meeting-sync session
  porter: [
    r('GET', '/api/docs'),
    r('GET', '/api/users'),
    r('GET', '/api/clients'),
    r('GET', '/api/sites'),
    r('GET', '/api/sops'),
    r('GET', '/api/sops/:id'),
    r('GET', '/api/projects'),
    r('GET', '/api/accords'),
    r('GET', '/api/charters'),
    r('GET', '/api/contacts/resolve'),
    r('GET', '/api/approval-requests'),
    r('POST', '/api/approval-requests/:id/reply'),
    r('GET', '/api/tasks'),
    r('POST', '/api/tasks'),
    r('GET', '/api/tasks/:id'),
    r('PATCH', '/api/tasks/:id'),
    r('POST', '/api/tasks/:id/comments'),
    r('POST', '/api/tasks/:id/dependencies'),
    r('GET', '/api/meetings'),
    r('POST', '/api/meetings'),
    r('POST', '/api/meetings/:id/tasks'),
    r('GET', '/api/email-asks'),
    r('PATCH', '/api/email-asks/:id'),
    r('GET', '/api/arcs'),
    r('POST', '/api/arcs'),
    r('POST', '/api/oracle/email-sync'),
  ],
  // Wright. project_record, review_citadel, review_watch, steward collectors, enroll_site,
  // steward_citadel; assayer orchestrate
  wright: [
    r('GET', '/api/accords/:id'),
    r('PATCH', '/api/accords/:id'),
    r('PATCH', '/api/accords/:id/status'),
    r('GET', '/api/wares'),
    r('GET', '/api/tasks'),
    r('POST', '/api/tasks'),
    r('POST', '/api/tasks/:id/comments'),
    r('GET', '/api/projects'),
    r('GET', '/api/projects/:id'),
    r('GET', '/api/projects/:id/team'),
    r('GET', '/api/sites'),
    r('GET', '/api/sites/:id'),
    r('GET', '/api/clients/:id'),
    r('GET', '/api/clients/:id/contacts'),
  ],
  // Clarity. oracle/clarity/calendar-sync.py, session-sweep.py
  clarity: [
    r('POST', '/api/oracle/calendar-sync'),
    r('POST', '/api/session-tasks'),
  ],
  // Bast (worker). citadel-worker session (SKILL.md routes), spawn-gate.py, model-policy.py
  bast: [
    r('GET', '/api/auth/me'),
    r('GET', '/api/tasks'),
    r('GET', '/api/tasks/:id'),
    r('PATCH', '/api/tasks/:id'),
    r('GET', '/api/tasks/:id/comments'),
    r('POST', '/api/tasks/:id/comments'),
    r('POST', '/api/tasks/:id/live'),
    r('POST', '/api/tasks/:id/staged'),
    r('POST', '/api/tasks/:id/approval-link'),
    r('POST', '/api/tasks/:id/dependencies'),
    r('GET', '/api/projects/:id'),
    r('GET', '/api/notifications'),
    r('POST', '/api/notifications/mark-all-read'),
    r('POST', '/api/time-entries'),
    // Fleet wave B, added after wave A landed: routes the Bast-key tools call. Admin-only decision
    // routes (confirm, reject, retract, supersede, import) and the sat/ admin surfaces (stand-ins,
    // away-windows, checklists, site-kpis, price-review/open) are deliberately NOT here.
    // citadel-claims/claim.py (item 3)
    r('GET', '/api/tasks/:id/claim'),
    r('POST', '/api/tasks/:id/claim'),
    r('POST', '/api/tasks/:id/claim/renew'),
    r('POST', '/api/tasks/:id/claim/release'),
    r('POST', '/api/tasks/claims/renew-holder'),
    r('POST', '/api/tasks/claims/release-holder'),
    // fleet-send/send_guard.py (item 4)
    r('POST', '/api/sends/recheck'),
    // decisions/decisions_api.py reads and capture writes (item 2); never the admin routes
    r('GET', '/api/decisions'),
    r('POST', '/api/decisions'),
    r('GET', '/api/decisions/in-scope'),
    r('GET', '/api/decisions/:id'),
    r('POST', '/api/decisions/:id/sources'),
    r('POST', '/api/decisions/:id/links'),
    // engagement-owner/owner_pass.py (item 1) and the receipts read (item 5)
    r('GET', '/api/engagement-briefs/:id'),
    r('GET', '/api/engagement-briefs/:id/tasks'),
    r('POST', '/api/engagement-briefs/:id/passes'),
    r('PATCH', '/api/engagement-passes/:id'),
    r('GET', '/api/tasks/:id/receipts'),
    r('GET', '/api/waits'),
    r('GET', '/api/charters/:id'),
    r('GET', '/api/clients'),
  ],
  // Audit lane (free-audit campaign). audit-lane/lane_citadel.py
  'audit-lane': [
    r('GET', '/api/users'),
    r('GET', '/api/tasks/:id'),
    r('POST', '/api/tasks'),
    r('PATCH', '/api/tasks/:id'),
    r('POST', '/api/tasks/:id/comments'),
  ],
  // Troubador service user. troubador lib/citadel.py, publish_driver, worker session
  troubador: [
    r('GET', '/api/troubador/work-queue'),
    r('GET', '/api/troubador/calendar'),
    r('POST', '/api/troubador/runs'),
    r('GET', '/api/troubador/runs/:id'),
    r('POST', '/api/troubador/runs/:id/claim'),
    r('POST', '/api/troubador/runs/:id/proposals'),
    r('POST', '/api/troubador/runs/:id/articles'),
    r('POST', '/api/troubador/runs/:id/interview-questions'),
    r('POST', '/api/troubador/runs/:id/interview-complete'),
    r('GET', '/api/troubador/articles/:id'),
    r('PATCH', '/api/troubador/articles/:id'),
    r('POST', '/api/troubador/articles/:id/claim'),
    r('GET', '/api/sites/:id'),
    r('POST', '/api/session-tasks'),
    r('GET', '/api/docs'),
  ],
  // Oracle bot. oracle_common (heartbeats, oracle-event), oracle-dispatch, the classifier's
  // triage-stats call, citadel-projects/next-step-refresh.py
  oracle: [
    r('POST', '/api/oracle/ingest'),
    r('GET', '/api/arcs'),
    r('GET', '/api/oracle/commands'),
    r('PATCH', '/api/oracle/commands/:id'),
    r('POST', '/api/oracle/triage-stats'),
    r('GET', '/api/oracle/projects'),
    r('GET', '/api/oracle/projects/refresh-requests'),
    r('PUT', '/api/oracle/projects/:id/next-step/write'),
    r('GET', '/api/tasks'),
    r('GET', '/api/tasks/:id/comments'),
    r('GET', '/api/projects/:id/notes'),
    r('GET', '/api/email-asks'),
  ],
};

export function isLane(name: string): name is Lane {
  return (LANES as readonly string[]).includes(name);
}

/** Every `lane:<name>` scope on a key, known or not (an unknown name allows nothing). */
export function laneScopesOf(scopes: readonly string[] | null | undefined): string[] {
  return (scopes ?? [])
    .filter((s) => s.startsWith(LANE_SCOPE_PREFIX))
    .map((s) => s.slice(LANE_SCOPE_PREFIX.length));
}

export function normalizePath(pathname: string): string {
  const p = pathname.split('?')[0].split('#')[0];
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** Static sibling segments a `:param` must not stand in for (Next routes those to their own file). */
const PARAM_EXCEPT: Record<string, readonly string[]> = {
  '/api/clients/:id': ['bulk'],
  '/api/decisions/:id': ['import', 'in-scope'],
  '/api/meetings/:id': ['incomplete'],
  '/api/oracle/projects/:id': ['nudge-draft', 'refresh', 'refresh-requests'],
  '/api/projects/:id': ['wizard'],
  '/api/sites/:id': ['bulk'],
  '/api/sops/:id': ['bulk', 'tags'],
  '/api/tasks/:id': ['bulk', 'unblock-sweep'],
};

export function paramExceptions(prefix: string): readonly string[] {
  return PARAM_EXCEPT[prefix] ?? [];
}

export function patternMatches(pattern: string, pathname: string): boolean {
  const want = pattern.split('/');
  const got = normalizePath(pathname).split('/');
  if (want.length !== got.length) return false;
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    const g = got[i];
    if (w.startsWith(':')) {
      if (!g) return false;
      const prefix = want.slice(0, i + 1).join('/');
      const except = PARAM_EXCEPT[prefix];
      if (except && except.includes(g)) return false;
      continue;
    }
    if (w !== g) return false;
  }
  return true;
}

export function laneAllows(lane: string, method: string, pathname: string): boolean {
  if (!isLane(lane)) return false;
  const m = method.toUpperCase();
  return LANE_ROUTES[lane].some((rt) => rt.method === m && patternMatches(rt.pattern, pathname));
}

export interface RouteHeader {
  method: string;
  path: string;
}

/** Parse "<METHOD> <pathname>" as written by proxy.ts. Anything else is null. */
export function parseRouteHeader(value: string | null | undefined): RouteHeader | null {
  if (!value) return null;
  const i = value.indexOf(' ');
  if (i <= 0) return null;
  const method = value.slice(0, i).toUpperCase();
  const path = value.slice(i + 1);
  if (!/^[A-Z]+$/.test(method) || !path.startsWith('/')) return null;
  return { method, path };
}
