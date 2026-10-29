/**
 * The shared world for the publish route tests (fake db): a production site with the D5 defaults, its owner,
 * a designer's idle session with a green precheck for its head, and helpers to sign in and build requests.
 */
import { NextRequest } from 'next/server';
import type { createFakeDb } from './publish-fake-db';

type FakeDb = ReturnType<typeof createFakeDb>;

export const IDS = {
  designer: 'd0000000-0000-4000-8000-000000000001',
  other: 'd0000000-0000-4000-8000-000000000002',
  admin: 'a0000000-0000-4000-8000-000000000001',
  owner: 'a0000000-0000-4000-8000-000000000002',
  pm: 'b0000000-0000-4000-8000-000000000001',
  tech: 'c0000000-0000-4000-8000-000000000001',
  site: '50000000-0000-4000-8000-000000000001',
  site2: '50000000-0000-4000-8000-000000000002',
  task: '70000000-0000-4000-8000-000000000001',
  task2: '70000000-0000-4000-8000-000000000002',
  session: '5e000000-0000-4000-8000-000000000001',
  session2: '5e000000-0000-4000-8000-000000000002',
} as const;

export const HEAD = 'a'.repeat(40);
export const HEAD2 = 'b'.repeat(40);

export type Who = 'designer' | 'other' | 'admin' | 'owner' | 'pm' | 'tech';

const ROLE: Record<Who, string> = { designer: 'designer', other: 'designer', admin: 'admin', owner: 'admin', pm: 'pm', tech: 'tech' };

export function authAs(who: Who, via: 'session' | 'api_key' = 'session') {
  return { userId: IDS[who], email: `${who}@example.test`, role: ROLE[who], via };
}

export function greenPrecheck(head = HEAD, extra: Record<string, unknown> = {}) {
  return {
    head_sha: head,
    gates_ok: true,
    gates: [{ name: 'library_lint', ok: true, summary: 'ok' }, { name: 'a11y', ok: true }],
    files_changed: ['src/index.njk'],
    pages_affected: ['/'],
    ...extra,
  };
}

export function seedWorld(db: FakeDb, opts: { mainRole?: 'production' | 'client_preview' | null; liveUrl?: string | null } = {}) {
  db.reset();
  const now = new Date();
  for (const who of Object.keys(ROLE) as Who[]) {
    db.store.user.push({ id: IDS[who], email: `${who}@example.test`, name: `${who} name`, role: ROLE[who], is_active: true, created_at: now });
  }
  for (const [id, name, url] of [[IDS.site, 'VCDP', 'https://vcdp.org'], [IDS.site2, 'Other', 'https://other.example']] as const) {
    db.store.site.push({ id, name, url, prod_branch: null, repo_branch: 'main', design_portal_enabled: true, designer_publish: true, is_deleted: false });
  }
  db.store.task.push({ id: IDS.task, title: 'Home hero refresh' }, { id: IDS.task2, title: 'Other task' });
  db.store.designPortalSettings.push({ id: 1, enabled: true, owner_user_id: IDS.owner, designer_publish_mode: 'per_site', confirmation_ttl_minutes: 10 });
  const role = opts.mainRole === undefined ? 'production' : opts.mainRole;
  db.store.designWorkerState.push({
    id: 1,
    site_main_roles: role ? { [IDS.site]: role, [IDS.site2]: 'production' } : {},
    site_live_urls: opts.liveUrl ? { [IDS.site]: opts.liveUrl } : {},
  });
  db.store.designSession.push(sessionRow(IDS.session, IDS.task, IDS.site, IDS.designer), sessionRow(IDS.session2, IDS.task2, IDS.site2, IDS.other));
}

export function sessionRow(id: string, taskId: string, siteId: string, designerId: string) {
  const now = new Date();
  return {
    id, task_id: taskId, site_id: siteId, project_id: null, designer_id: designerId, status: 'awaiting_input',
    branch: 'design/abcd1234', preview_alias: 'design-abcd1234', worktree_path: null, base_sha: null, head_sha: HEAD,
    preview_url: null, preview_deploy_url: null, preview_sha: HEAD, sdk_session_id: null, model: 'opus', effort: 'high',
    cost_usd: 1.23, budget_usd: 25, live_text: null, live_action: null, last_seq: 0, last_heartbeat_at: null,
    timer_entry_id: null, timer_presence_at: null, last_turn_at: null, lib_index: null,
    diff_summary: { files_changed: 1, insertions: 4, deletions: 2, files: [{ path: 'src/index.njk', add: 4, del: 2 }] },
    diff_asset_id: null, publish_requested_at: null, publish_requested_by: null, last_publish_id: null,
    publish_precheck: greenPrecheck(), created_at: now, updated_at: now, closed_at: null,
  };
}

export function sessionOf(db: FakeDb, id: string = IDS.session) {
  return db.store.designSession.find((s) => s.id === id)!;
}

export function siteOf(db: FakeDb, id: string = IDS.site) {
  return db.store.site.find((s) => s.id === id)!;
}

export function settingsOf(db: FakeDb) {
  return db.store.designPortalSettings[0];
}

export function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function paramsOf(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** A finished publish row for the rollback and page tests. */
export function publishedRow(over: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: '9a000000-0000-4000-8000-000000000001', session_id: IDS.session, site_id: IDS.site, task_id: IDS.task, kind: 'publish',
    rolls_back_id: null, actor_id: IDS.designer, actor_role: 'designer', publish_mode: 'per_site', main_role: 'production',
    site_designer_publish: true, confirmation_shown: { target_words: 'the LIVE production site at vcdp.org', main_branch: 'main', live_url: 'https://vcdp.org' },
    confirmation_token_hash: null, confirmation_expires_at: null, confirmation_typed: 'main', confirm_requested_at: now,
    confirmed_at: now, status: 'published', head_sha: HEAD, from_main_sha: 'c'.repeat(40), result_sha: 'd'.repeat(40),
    deploy_id: 'dep1', deploy_url: 'https://abc.vcdp.pages.dev', alias_url: 'https://vcdp.org', gates: [{ name: 'a11y', ok: true }],
    policy: null, diff_summary: null, change_ids: [], cost_usd: 1.23, error: null, notified_at: null, rolled_back_at: null,
    rolled_back_by_id: null, created_at: now, started_at: now, finished_at: now,
    ...over,
  };
}
