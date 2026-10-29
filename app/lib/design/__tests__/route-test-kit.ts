/** Shared helpers for the /api/design route tests (mocked style; the vi.mock calls stay in each test file). */
import { expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

export const DESIGNER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_DESIGNER_ID = '22222222-2222-4222-8222-222222222222';
export const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
export const PM_ID = '44444444-4444-4444-8444-444444444444';
export const SESSION_ID = '55555555-5555-4555-8555-555555555555';
export const TASK_ID = '66666666-6666-4666-8666-666666666666';
export const SITE_ID = '77777777-7777-4777-8777-777777777777';
export const PIN_ID = '88888888-8888-4888-8888-888888888888';
export const CHANGE_ID = '99999999-9999-4999-8999-999999999999';
export const REF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** The session's project. Mocked prisma files stub projectTeamAssignment with this id (vi.mock factories cannot import it). */
export const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export type Role = 'designer' | 'admin' | 'pm' | 'tech';
const IDS: Record<Role, string> = { designer: DESIGNER_ID, admin: ADMIN_ID, pm: PM_ID, tech: '12121212-1212-4212-8212-121212121212' };

export function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(raw === undefined ? {} : { body: raw }),
  });
}

export const getRequest = (url: string) => new NextRequest(`http://localhost${url}`, { method: 'GET' });
export const paramsOf = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** Sign in as `role` (DB role = token role) via a session unless `via` says otherwise. */
export function signIn(requireAuth: Mock, userFind: Mock, role: Role, opts: { via?: 'session' | 'api_key'; userId?: string } = {}): string {
  const userId = opts.userId ?? IDS[role];
  requireAuth.mockResolvedValue({ userId, email: `${role}@example.test`, role, via: opts.via ?? 'session' });
  userFind.mockResolvedValue({ id: userId, role, is_active: true });
  return userId;
}

export function anonymous(requireAuth: Mock): void {
  requireAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
}

const D = (n: number) => n;
/** A DesignSession row with every column the projections read. */
export function sessionRow(over: Record<string, unknown> = {}) {
  const now = new Date('2026-10-28T12:00:00Z');
  return {
    id: SESSION_ID, task_id: TASK_ID, site_id: SITE_ID, project_id: PROJECT_ID, designer_id: DESIGNER_ID, status: 'awaiting_input',
    branch: 'design/66666666', preview_alias: 'design-66666666', worktree_path: '/x', base_sha: 'ba5e1111', head_sha: 'head2222',
    preview_url: 'https://design-66666666.vcdp.pages.dev', preview_deploy_url: null, preview_sha: 'abc1234', sdk_session_id: null,
    model: 'opus', effort: 'high', cost_usd: D(1), budget_usd: D(25), live_text: null, live_action: null, last_seq: 3,
    last_heartbeat_at: now, timer_entry_id: null, timer_presence_at: null, last_turn_at: now, lib_index: null, diff_summary: null,
    diff_asset_id: null, publish_requested_at: null, publish_requested_by: null, last_publish_id: null, publish_precheck: null,
    created_at: now, updated_at: now, closed_at: null, ...over,
  };
}

export function pinRow(over: Record<string, unknown> = {}) {
  const now = new Date('2026-10-28T12:00:00Z');
  return {
    id: PIN_ID, session_id: SESSION_ID, author_id: DESIGNER_ID, status: 'pending', note: 'make it bigger', page_path: '/about/',
    data_lib: 'hero', lib_stack: ['hero', 'section'], data_shape: 'card', selector: 'section[data-lib="hero"]', tag: 'h1',
    classes: ['title'], text_quote: 'Welcome', bbox: { x: 1, y: 2, w: 300, h: 40 }, viewport_width: 1280, viewport_height: 800,
    preview_sha: 'abc1234', crop_asset_id: null, apply_event_seq: null, followup_task_id: null, created_at: now, updated_at: now, ...over,
  };
}

/** The shipped dp:packet exactly as design-overlay.js builds it. */
export const SHIPPED_PACKET = {
  type: 'dp:packet', path: '/about/', sha: 'abc1234', data_lib: 'hero', lib_stack: ['hero', 'section'], data_shape: 'card',
  selector: 'section[data-lib="hero"] > h1', tag: 'h1', classes: ['title', 'big'], text_quote: 'Welcome to the site',
  bbox: { x: 10, y: 20, w: 300, h: 40 }, viewport: { w: 1280, h: 800 },
};

interface MatrixOpts {
  /** Runs the route as the current mocked caller; `headers` override request headers. */
  invoke: (headers?: Record<string, string>) => Promise<Response>;
  requireAuth: Mock;
  userFind: Mock;
  /** Make the data layer return a session owned by DESIGNER_ID (and anything else the route needs). */
  arrange: () => void;
  write: boolean;
  /** Reads: roles that are refused with 403 instead of 404 (default none). */
  pmWrite403?: boolean;
  /** prisma.projectTeamAssignment.findFirst: lets the matrix take the session's designer off the project. */
  assignmentFind?: Mock;
}

/**
 * The cases every session-scoped route owes: 401, another designer 404, pm write 403, cross-site 403; and
 * (W8.2) the session's own designer once removed from the project 404 (H2), an admin API key 403 (H7).
 */
export function sessionRouteMatrix(label: string, o: MatrixOpts): void {
  if (o.assignmentFind) {
    const assignmentFind = o.assignmentFind;
    it(`${label}: the session's designer, removed from the project, is 404`, async () => {
      signIn(o.requireAuth, o.userFind, 'designer');
      o.arrange();
      assignmentFind.mockResolvedValueOnce(null);
      expect((await o.invoke()).status).toBe(404);
    });
  }
  it(`${label}: an admin API key is 403 (designer routes are session-only)`, async () => {
    signIn(o.requireAuth, o.userFind, 'admin', { via: 'api_key' });
    o.arrange();
    expect((await o.invoke()).status).toBe(403);
  });
  it(`${label}: anonymous is 401`, async () => {
    anonymous(o.requireAuth);
    o.arrange();
    expect((await o.invoke()).status).toBe(401);
  });
  it(`${label}: another designer's session is 404, never 403`, async () => {
    signIn(o.requireAuth, o.userFind, 'designer', { userId: OTHER_DESIGNER_ID });
    o.arrange();
    expect((await o.invoke()).status).toBe(404);
  });
  if (o.write) {
    it(`${label}: pm write is 403`, async () => {
      signIn(o.requireAuth, o.userFind, 'pm');
      o.arrange();
      expect((await o.invoke()).status).toBe(403);
    });
    it(`${label}: cross-site is 403`, async () => {
      signIn(o.requireAuth, o.userFind, 'designer');
      o.arrange();
      expect((await o.invoke({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    });
  } else {
    it(`${label}: pm may read`, async () => {
      signIn(o.requireAuth, o.userFind, 'pm');
      o.arrange();
      expect((await o.invoke()).status).toBe(200);
    });
  }
}
export { vi };
