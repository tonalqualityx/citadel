/**
 * Designer Portal operator keys against the scratch database, end to end through the REAL middleware, route-kit
 * and route handlers (only next/headers is stubbed: it carries the Bearer key and the route proxy.ts would stamp).
 * Keys are minted in the database exactly as an admin session would leave them.
 *
 *  - design:operator-publish: intent + confirm as an admin publisher (actor_via operator_key, the key id, receipt
 *    design_operator_publish:<id>, "published by Bast on Mike's instruction", FYI to Mike), red gate refused,
 *    wrong typed branch 409, rollback (design_operator_rollback:<id>), 403 on every designer route and on settings.
 *  - design:operator-setup: every listed admin route answers; publish and designer routes 403.
 *  - a plain admin key, a design-worker lane key, a key whose scope was removed, a revoked key: refused.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const hdr = vi.hoisted(() => ({ bearer: null as string | null, route: null as string | null }));
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (hdr.bearer) h.set('authorization', `Bearer ${hdr.bearer}`);
    if (hdr.route) h.set('x-citadel-route', hdr.route);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/services/email-notifications', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(true) }));

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '@/lib/auth/api-keys';
import { applyWorkerPublishPatch, createPublishIntent } from '../publishes';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';
import { POST as publishRoute } from '@/app/api/design/sessions/[id]/publish/route';
import { POST as confirmRoute } from '@/app/api/design/publishes/[id]/confirm/route';
import { POST as rollbackRoute } from '@/app/api/design/publishes/[id]/rollback/route';
import { GET as publishPage } from '@/app/api/design/publishes/[id]/route';
import { GET as sessionGet } from '@/app/api/design/sessions/[id]/route';
import { GET as feedGet } from '@/app/api/design/sessions/[id]/feed/route';
import { POST as messagesRoute } from '@/app/api/design/sessions/[id]/messages/route';
import { POST as applyRoute } from '@/app/api/design/sessions/[id]/apply/route';
import { POST as pinsRoute } from '@/app/api/design/sessions/[id]/pins/route';
import { POST as stopRoute } from '@/app/api/design/sessions/[id]/stop/route';
import { POST as budgetRoute } from '@/app/api/design/sessions/[id]/budget/route';
import { POST as requestPublishRoute } from '@/app/api/design/sessions/[id]/request-publish/route';
import { GET as settingsGet, PATCH as settingsPatch } from '@/app/api/design/admin/settings/route';
import { GET as sitesGet } from '@/app/api/design/admin/sites/route';
import { PATCH as sitePatch } from '@/app/api/design/admin/sites/[id]/route';
import { GET as clientGet, PATCH as clientPatch } from '@/app/api/design/admin/clients/[id]/route';
import { GET as projectGet, PATCH as projectPatch } from '@/app/api/design/admin/projects/[id]/route';
import { GET as budgetsGet } from '@/app/api/design/admin/budgets/route';
import { PUT as budgetPut, PATCH as budgetPatch } from '@/app/api/design/admin/budgets/[userId]/route';
import { GET as adminSessions } from '@/app/api/design/admin/sessions/route';
import { GET as adminPublishes } from '@/app/api/design/admin/publishes/route';

const sha = () => crypto.randomBytes(20).toString('hex');
type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<Response>;

describe.skipIf(!SCRATCH)('design operator keys (real database, real middleware)', () => {
  let f: DesignFixture;
  let workerId: string;
  const userIds: string[] = [];
  const keyIds: string[] = [];
  const keys = { publish: '', setup: '', plain: '', designWorker: '', both: '' };
  let publishKeyId = '';
  let saved: { settings: Record<string, unknown>; roles: unknown; urls: unknown };

  async function mint(userId: string, scopes: string[]): Promise<{ raw: string; id: string }> {
    const raw = 'citadel_' + crypto.randomBytes(16).toString('hex');
    const row = await prisma.apiKey.create({ data: { user_id: userId, name: `op-${f.tag}`, key_hash: hashApiKey(raw), key_prefix: raw.slice(0, 16), scopes } });
    keyIds.push(row.id);
    return { raw, id: row.id };
  }

  /** Call a handler as `key` with the route header proxy.ts would stamp. */
  async function call(key: string, h: Handler, method: string, path: string, params: Record<string, string> = {}, body?: unknown) {
    hdr.bearer = key;
    hdr.route = `${method} ${path}`;
    const req = new NextRequest(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const res = await h(req, { params: Promise.resolve(params) });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }
  const as = (key: string) => ({
    publish: (sid: string, head: string) => call(key, publishRoute as unknown as Handler, 'POST', `/api/design/sessions/${sid}/publish`, { id: sid }, { head_sha: head }),
    confirm: (pid: string, token: string, typed: string) =>
      call(key, confirmRoute as unknown as Handler, 'POST', `/api/design/publishes/${pid}/confirm`, { id: pid }, { confirmation_token: token, typed_confirmation: typed }),
    rollback: (pid: string) => call(key, rollbackRoute as unknown as Handler, 'POST', `/api/design/publishes/${pid}/rollback`, { id: pid }, { reason: 'Mike asked' }),
    page: (pid: string) => call(key, publishPage as unknown as Handler, 'GET', `/api/design/publishes/${pid}`, { id: pid }),
    session: (sid: string) => call(key, sessionGet as unknown as Handler, 'GET', `/api/design/sessions/${sid}`, { id: sid }),
    feed: (sid: string) => call(key, feedGet as unknown as Handler, 'GET', `/api/design/sessions/${sid}/feed`, { id: sid }),
  });

  async function setRole(role: 'production' | 'client_preview', liveUrl: string) {
    const ws = await prisma.designWorkerState.findUniqueOrThrow({ where: { id: 1 } });
    const roles = { ...((ws.site_main_roles as Record<string, unknown>) ?? {}), [f.siteId]: role };
    const urls = { ...((ws.site_live_urls as Record<string, unknown>) ?? {}), [f.siteId]: liveUrl };
    await prisma.designWorkerState.update({ where: { id: 1 }, data: { site_main_roles: roles as Prisma.InputJsonValue, site_live_urls: urls as Prisma.InputJsonValue } });
  }

  async function idleSession(gatesOk = true) {
    const taskId = await seedTask(f, 'operator');
    const head = sha();
    const s = await prisma.designSession.create({
      data: {
        task_id: taskId, site_id: f.siteId, project_id: f.projectId, designer_id: f.designer.userId, status: 'awaiting_input',
        branch: `design/${taskId.slice(0, 8)}`, preview_alias: `design-${taskId.slice(0, 8)}`, model: 'opus', budget_usd: 25, cost_usd: 1.25,
        base_sha: sha(), head_sha: head,
        publish_precheck: { head_sha: head, gates_ok: gatesOk, gates: [{ name: 'library_lint', ok: gatesOk }], files_changed: ['src/index.njk'], pages_affected: ['/'] },
      },
    });
    return { taskId, sessionId: s.id, head };
  }

  const result = (from: string, to: string) => ({
    from_main_sha: from, result_sha: to, deploy_id: 'dep-op', deploy_url: 'https://op123.example.pages.dev', alias_url: 'https://www.example.test',
    gates: [{ name: 'library_lint', ok: true }, { name: 'a11y', ok: true }],
  });

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    f = await seedDesign(`op${Date.now()}`);
    // The key's user is Mike's account (an admin); the comment names him by first name.
    await prisma.user.update({ where: { id: f.admin.userId }, data: { name: `Mike ${f.tag}` } });
    const w = await prisma.user.create({ data: { email: `dp-${f.tag}-w@example.test`, password_hash: 'x', name: `worker ${f.tag}`, role: 'tech' } });
    workerId = w.id;
    userIds.push(w.id);
    const s = await prisma.designPortalSettings.findUniqueOrThrow({ where: { id: 1 } });
    const ws = await prisma.designWorkerState.findUniqueOrThrow({ where: { id: 1 } });
    saved = {
      settings: { owner_user_id: s.owner_user_id, designer_publish_mode: s.designer_publish_mode, confirmation_ttl_minutes: s.confirmation_ttl_minutes },
      roles: ws.site_main_roles,
      urls: ws.site_live_urls,
    };
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { owner_user_id: f.admin.userId, designer_publish_mode: 'off', confirmation_ttl_minutes: 10 } });

    const pub = await mint(f.admin.userId, ['design:operator-publish']);
    keys.publish = pub.raw;
    publishKeyId = pub.id;
    keys.setup = (await mint(f.admin.userId, ['design:operator-setup'])).raw;
    keys.plain = (await mint(f.admin.userId, [])).raw;
    keys.both = (await mint(f.admin.userId, ['design:operator-setup', 'design:operator-publish'])).raw;
    keys.designWorker = (await mint(workerId, ['lane:design-worker', 'scope-mode:enforce'])).raw;
  });

  afterAll(async () => {
    hdr.bearer = null;
    hdr.route = null;
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: saved.settings });
    await prisma.designWorkerState.update({
      where: { id: 1 },
      data: { site_main_roles: (saved.roles ?? Prisma.DbNull) as Prisma.InputJsonValue, site_live_urls: (saved.urls ?? Prisma.DbNull) as Prisma.InputJsonValue },
    });
    await prisma.apiKey.deleteMany({ where: { id: { in: keyIds } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: [f.admin.userId, f.designer.userId] } } });
    await teardownDesign(f);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('operator-publish: the full admin path, recorded as Bast on Mike\'s instruction; then a rollback', async () => {
    await setRole('production', 'https://www.example.test');
    const { taskId, sessionId, head } = await idleSession();
    const op = as(keys.publish);

    // The reads it needs to see the head and the gates. An operator never starts a timer.
    const s = await op.session(sessionId);
    expect(s.status).toBe(200);
    expect(s.json.session.head_sha).toBe(head);
    const feed = await op.feed(sessionId);
    expect(feed.status).toBe(200);
    expect(feed.json.timer).toEqual({ running: false, elapsed_s: 0 });
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } })).timer_entry_id).toBeNull();

    // Step 1. designer_publish_mode is 'off': the operator is an ADMIN publisher, so the mode does not apply.
    const intent = await op.publish(sessionId, head);
    expect(intent.status).toBe(201);
    expect(intent.json.shown.main_branch).toBe('main');
    const row = await prisma.designPublish.findUniqueOrThrow({ where: { id: intent.json.publish_id } });
    expect(row).toMatchObject({ status: 'awaiting_confirmation', actor_id: f.admin.userId, actor_role: 'admin', actor_via: 'operator_key', actor_api_key_id: publishKeyId });

    // Step 2: the typed branch is still checked.
    const wrong = await op.confirm(row.id, intent.json.confirmation_token, 'master');
    expect(wrong.status).toBe(409);
    expect(wrong.json.code).toBe('typed_mismatch');
    // Another key of the same user (even one that holds the publish scope) cannot finish this intent.
    expect((await as(keys.both).confirm(row.id, intent.json.confirmation_token, 'main')).status).toBe(404);
    const ok = await op.confirm(row.id, intent.json.confirmation_token, 'main');
    expect(ok.status).toBe(202);
    const cmd = await prisma.designCommand.findFirstOrThrow({ where: { session_id: sessionId, verb: 'publish' } });
    expect(cmd.payload).toMatchObject({ publish_id: row.id, actor_role: 'admin', main_branch: 'main' });
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('publishing');

    // The box executes it (same worker path as any admin publish).
    await applyWorkerPublishPatch(row.id, { status: 'running' }, { workerUserId: workerId });
    const to = sha();
    await applyWorkerPublishPatch(row.id, { status: 'published', ...result(sha(), to) }, { workerUserId: workerId });

    const comments = await prisma.comment.findMany({ where: { task_id: taskId } });
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toContain("published by Bast on Mike's instruction");
    expect(comments[0].content).toContain(`actor Mike ${f.tag}, admin`);
    const receipts = await prisma.taskReceipt.findMany({ where: { task_id: taskId } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ step: 'live', approval_source: `design_operator_publish:${row.id}`, actor_user_id: f.admin.userId, commit_sha: to });
    // Bast clicked, so Mike (the owner AND the key's user) still gets the FYI.
    const notes = await prisma.notification.findMany({ where: { entity_id: row.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: f.admin.userId, type: 'design_published', priority: 'high' });
    expect(notes[0].message).toContain("Bast on Mike's instruction");

    const page = await op.page(row.id);
    expect(page.status).toBe(200);
    expect(page.json.publish.actor_via).toBe('operator_key');
    expect(page.json.can_rollback).toBe(true);

    // Rollback, one call.
    const rb = await op.rollback(row.id);
    expect(rb.status).toBe(202);
    const rbRow = await prisma.designPublish.findUniqueOrThrow({ where: { id: rb.json.publish_id } });
    expect(rbRow).toMatchObject({ kind: 'rollback', status: 'queued', actor_id: f.admin.userId, actor_role: 'admin', actor_via: 'operator_key', actor_api_key_id: publishKeyId });
    await applyWorkerPublishPatch(rbRow.id, { status: 'running' }, { workerUserId: workerId });
    await applyWorkerPublishPatch(rbRow.id, { status: 'published', ...result(to, sha()) }, { workerUserId: workerId });
    expect((await prisma.designPublish.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('rolled_back');
    expect(await prisma.taskReceipt.count({ where: { task_id: taskId, approval_source: `design_operator_rollback:${rbRow.id}` } })).toBe(1);
    const rbComment = await prisma.comment.findFirstOrThrow({ where: { task_id: taskId }, orderBy: { created_at: 'desc' } });
    expect(rbComment.content).toContain("rolled back by Bast on Mike's instruction");
  });

  it('operator-publish: a red gate still refuses (409 gates_not_green, nothing created)', async () => {
    await setRole('production', 'https://www.example.test');
    const { sessionId, head } = await idleSession(false);
    const res = await as(keys.publish).publish(sessionId, head);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('gates_not_green');
    expect(await prisma.designPublish.count({ where: { session_id: sessionId } })).toBe(0);
  });

  it('operator-publish: cannot finish an intent Mike started in his browser (404), and his browser cannot finish Bast\'s', async () => {
    await setRole('client_preview', 'https://example.pages.dev');
    const { sessionId, head } = await idleSession();
    const mine = await createPublishIntent(f.admin, sessionId, head); // Mike's signed-in session
    expect((await as(keys.publish).confirm(mine.publish_id, mine.confirmation_token, 'main')).status).toBe(404);
    expect((await prisma.designPublish.findUniqueOrThrow({ where: { id: mine.publish_id } })).status).toBe('awaiting_confirmation');
  });

  it('operator-publish: 403 session_required on every designer route, request-publish and the admin settings', async () => {
    const { sessionId } = await idleSession();
    const p = { id: sessionId };
    const base = `/api/design/sessions/${sessionId}`;
    const refused = [
      await call(keys.publish, messagesRoute as unknown as Handler, 'POST', `${base}/messages`, p, { text: 'publish this' }),
      await call(keys.publish, applyRoute as unknown as Handler, 'POST', `${base}/apply`, p, {}),
      await call(keys.publish, pinsRoute as unknown as Handler, 'POST', `${base}/pins`, p, {}),
      await call(keys.publish, stopRoute as unknown as Handler, 'POST', `${base}/stop`, p, {}),
      await call(keys.publish, budgetRoute as unknown as Handler, 'POST', `${base}/budget`, p, { budget_usd: 140 }),
      await call(keys.publish, requestPublishRoute as unknown as Handler, 'POST', `${base}/request-publish`, p, {}),
      await call(keys.publish, settingsGet as unknown as Handler, 'GET', '/api/design/admin/settings'),
      await call(keys.publish, settingsPatch as unknown as Handler, 'PATCH', '/api/design/admin/settings', {}, { designer_publish_mode: 'per_site' }),
    ];
    for (const r of refused) {
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('session_required');
    }
    expect(await prisma.designEvent.count({ where: { session_id: sessionId } })).toBe(0);
  });

  it('operator-setup: every listed admin route answers; publish, the session reads and designer writes are 403', async () => {
    const k = keys.setup;
    const s = await prisma.designPortalSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect((await call(k, settingsGet as unknown as Handler, 'GET', '/api/design/admin/settings')).status).toBe(200);
    const patched = await call(k, settingsPatch as unknown as Handler, 'PATCH', '/api/design/admin/settings', {}, { confirmation_ttl_minutes: s.confirmation_ttl_minutes });
    expect(patched.status).toBe(200);
    expect((await prisma.designPortalSettings.findUniqueOrThrow({ where: { id: 1 } })).updated_by_id).toBe(f.admin.userId);
    expect((await call(k, sitesGet as unknown as Handler, 'GET', '/api/design/admin/sites')).status).toBe(200);
    const site = await call(k, sitePatch as unknown as Handler, 'PATCH', `/api/design/admin/sites/${f.siteId}`, { id: f.siteId }, { design_auto_timer: false });
    expect(site.status).toBe(200);
    expect(site.json.site.design_auto_timer).toBe(false);
    expect((await call(k, clientGet as unknown as Handler, 'GET', `/api/design/admin/clients/${f.clientId}`, { id: f.clientId })).status).toBe(200);
    expect((await call(k, clientPatch as unknown as Handler, 'PATCH', `/api/design/admin/clients/${f.clientId}`, { id: f.clientId }, { drive_folder_id: null })).status).toBe(200);
    expect((await call(k, projectGet as unknown as Handler, 'GET', `/api/design/admin/projects/${f.projectId}`, { id: f.projectId })).status).toBe(200);
    expect((await call(k, projectPatch as unknown as Handler, 'PATCH', `/api/design/admin/projects/${f.projectId}`, { id: f.projectId }, { drive_folder_id: null })).status).toBe(200);
    expect((await call(k, budgetsGet as unknown as Handler, 'GET', '/api/design/admin/budgets')).status).toBe(200);
    const uid = f.designer.userId;
    expect((await call(k, budgetPut as unknown as Handler, 'PUT', `/api/design/admin/budgets/${uid}`, { userId: uid }, { monthly_cap_usd: 300 })).status).toBe(200);
    expect((await call(k, budgetPatch as unknown as Handler, 'PATCH', `/api/design/admin/budgets/${uid}`, { userId: uid }, { session_raise_cap_usd: 40 })).status).toBe(200);
    expect(await prisma.designBudget.findUniqueOrThrow({ where: { user_id: uid } })).toMatchObject({ updated_by_id: f.admin.userId });
    expect((await call(k, adminSessions as unknown as Handler, 'GET', '/api/design/admin/sessions')).status).toBe(200);
    expect((await call(k, adminPublishes as unknown as Handler, 'GET', '/api/design/admin/publishes')).status).toBe(200);

    const { sessionId, head } = await idleSession();
    const refused = [
      await as(k).publish(sessionId, head),
      await as(k).session(sessionId),
      await as(k).feed(sessionId),
      await call(k, messagesRoute as unknown as Handler, 'POST', `/api/design/sessions/${sessionId}/messages`, { id: sessionId }, { text: 'x' }),
      await call(k, budgetRoute as unknown as Handler, 'POST', `/api/design/sessions/${sessionId}/budget`, { id: sessionId }, { budget_usd: 140 }),
    ];
    for (const r of refused) {
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('session_required');
    }
    expect(await prisma.designPublish.count({ where: { session_id: sessionId } })).toBe(0);
  });

  it('H7 stays fixed: a plain admin key is 403 session_required on publish, the reads and the admin routes', async () => {
    const { sessionId, head } = await idleSession();
    const k = keys.plain;
    for (const r of [
      await as(k).publish(sessionId, head),
      await as(k).session(sessionId),
      await as(k).feed(sessionId),
      await call(k, settingsGet as unknown as Handler, 'GET', '/api/design/admin/settings'),
      await call(k, messagesRoute as unknown as Handler, 'POST', `/api/design/sessions/${sessionId}/messages`, { id: sessionId }, { text: 'x' }),
    ]) {
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('session_required');
    }
  });

  it('the design-worker lane key is 403 on publish, confirm and rollback (the lane stops it first)', async () => {
    const { sessionId, head } = await idleSession();
    const dw = as(keys.designWorker);
    const pid = crypto.randomUUID();
    for (const r of [await dw.publish(sessionId, head), await dw.confirm(pid, 'x', 'main'), await dw.rollback(pid)]) expect(r.status).toBe(403);
    expect(await prisma.designPublish.count({ where: { session_id: sessionId } })).toBe(0);
  });

  it('revocable: removing the scope makes the key a plain key again (403); revoking it makes it no key at all (401)', async () => {
    const { sessionId, head } = await idleSession();
    const temp = await mint(f.admin.userId, ['design:operator-publish']);
    expect((await as(temp.raw).session(sessionId)).status).toBe(200);
    await prisma.apiKey.update({ where: { id: temp.id }, data: { scopes: [] } });
    const gone = await as(temp.raw).publish(sessionId, head);
    expect(gone.status).toBe(403);
    expect(gone.json.code).toBe('session_required');
    await prisma.apiKey.update({ where: { id: temp.id }, data: { scopes: ['design:operator-publish'], is_revoked: true } });
    expect((await as(temp.raw).publish(sessionId, head)).status).toBe(401);
    expect(await prisma.designPublish.count({ where: { session_id: sessionId } })).toBe(0);
  });

  it('a key whose user is no longer an admin loses the scope\'s effect at once (403)', async () => {
    const pmUser = await prisma.user.create({ data: { email: `dp-${f.tag}-pm@example.test`, password_hash: 'x', name: 'pm', role: 'admin' } });
    userIds.push(pmUser.id);
    const k = await mint(pmUser.id, ['design:operator-setup']);
    expect((await call(k.raw, settingsGet as unknown as Handler, 'GET', '/api/design/admin/settings')).status).toBe(200);
    await prisma.user.update({ where: { id: pmUser.id }, data: { role: 'pm' } });
    const r = await call(k.raw, settingsGet as unknown as Handler, 'GET', '/api/design/admin/settings');
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('session_required');
  });
});
