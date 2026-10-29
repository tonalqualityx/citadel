// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
const store = vi.hoisted(() => new Map<string, Buffer>());
vi.mock('@/lib/services/s3', () => ({
  PRIVATE_PREFIX: 'portal-private/',
  putPrivateObject: vi.fn(async (k: string, b: Buffer) => { store.set(k, b); }),
  getPrivateObject: vi.fn(async (k: string) => { const b = store.get(k); if (!b) throw new Error('missing'); return b; }),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createOrGetSession } from '@/lib/design/sessions';
import { appendDesignerEvent } from '@/lib/design/events';
import { createCommand } from '@/lib/design/commands';
import * as inbox from '../inbox/route';
import * as heartbeat from '../heartbeat/route';
import * as sessions from '../sessions/route';
import * as session from '../sessions/[id]/route';
import * as asset from '../sessions/[id]/assets/[assetId]/route';
import * as assets from '../sessions/[id]/assets/route';
import * as events from '../sessions/[id]/events/route';
import * as changes from '../sessions/[id]/changes/route';
import * as scope from '../sessions/[id]/scope-flags/route';
import * as change from '../changes/[id]/route';
import * as pin from '../pins/[id]/route';
import * as command from '../commands/[id]/route';
import * as publish from '../publishes/[id]/route';
import { NOT_WORKERS, WORKER as WORKER_BASE, ctx, req } from './harness';
import { DESIGN_WORKER_SERVICE_EMAIL } from '@/lib/design/helpers';

let WORKER = WORKER_BASE;

const P = '/api/design/worker';
const PNG = (n = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 1)]);

function upload(sessionId: string, bytes: Buffer, kind: string, width?: number): NextRequest {
  const fd = new FormData();
  fd.set('file', new Blob([new Uint8Array(bytes)]), 'x.png');
  fd.set('kind', kind);
  if (width !== undefined) fd.set('width', String(width));
  return new NextRequest(`http://localhost:3000${P}/sessions/${sessionId}/assets`, { method: 'POST', body: fd });
}

describe.skipIf(!SCRATCH)('worker routes (real database)', () => {
  let f: DesignFixture;
  let sid: string;
  let tid: string;
  let svcCreated = false;
  const origSettings = { owner: null as string | null, enabled: true };
  const set = (id: string) => ctx({ id });

  beforeAll(async () => {
    f = await seedDesign(`wk${Date.now()}`);
    // The service user must exist for rows the worker creates (created_by).
    const svc = (await prisma.user.findUnique({ where: { email: DESIGN_WORKER_SERVICE_EMAIL } }))
      ?? (await prisma.user.create({ data: { email: DESIGN_WORKER_SERVICE_EMAIL, password_hash: 'x', name: 'Designer worker', role: 'tech' } }));
    svcCreated = !(await prisma.user.count({ where: { id: svc.id, created_at: { lt: new Date(Date.now() - 5000) } } }));
    WORKER = { ...WORKER_BASE, userId: svc.id };
    tid = await seedTask(f);
    sid = (await createOrGetSession(f.designer, tid)).session.id;
    const st = await prisma.designPortalSettings.findUnique({ where: { id: 1 } });
    origSettings.owner = st?.owner_user_id ?? null;
    origSettings.enabled = st?.enabled ?? true;
  });
  afterAll(async () => {
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { owner_user_id: origSettings.owner, enabled: origSettings.enabled } }).catch(() => {});
    await prisma.task.deleteMany({ where: { tags: { has: 'design-followup' }, client_id: f.clientId } });
    const others = await prisma.project.findMany({ where: { name: `${f.tag} other` }, select: { id: true } });
    await prisma.projectTeamAssignment.deleteMany({ where: { project_id: { in: others.map((o) => o.id) } } });
    await prisma.task.deleteMany({ where: { project_id: { in: others.map((o) => o.id) } } });
    await prisma.project.deleteMany({ where: { id: { in: others.map((o) => o.id) } } });
    await teardownDesign(f);
    if (svcCreated) await prisma.user.deleteMany({ where: { email: DESIGN_WORKER_SERVICE_EMAIL } }).catch(() => {});
    await prisma.$disconnect();
  });
  beforeEach(() => { vi.mocked(requireAuth).mockResolvedValue(WORKER); });

  describe('session state and fields', () => {
    it('lists non-terminal sessions, filtered by status, and rejects unknown statuses', async () => {
      let res = await sessions.GET(req('GET', `${P}/sessions?status=active,awaiting_input`));
      expect(res.status).toBe(200);
      expect((await res.json()).sessions.find((s: { id: string }) => s.id === sid)).toBeUndefined();
      res = await sessions.GET(req('GET', `${P}/sessions?status=pending`));
      expect((await res.json()).sessions.map((s: { id: string }) => s.id)).toContain(sid);
      expect((await sessions.GET(req('GET', `${P}/sessions?status=closed`))).status).toBe(400);
    });

    it('walks the worker-legal transitions and 409s the illegal ones', async () => {
      const patch = (body: object) => session.PATCH(req('PATCH', `${P}/sessions/${sid}`, body), set(sid));
      expect((await patch({ status: 'active' })).status).toBe(409); // pending -> active
      expect((await patch({ status: 'awaiting_input', worktree_path: '/tmp/wt', base_sha: 'abcdef1', head_sha: 'abcdef1' })).status).toBe(200);
      expect((await patch({ status: 'publishing' })).status).toBe(409); // server only
      expect((await patch({ status: 'active' })).status).toBe(200);
      const res = await patch({ status: 'awaiting_input', sdk_session_id: 'sdk-1' });
      expect(res.status).toBe(200);
      expect((await res.json()).session).toMatchObject({ status: 'awaiting_input', sdk_session_id: 'sdk-1', worktree_path: '/tmp/wt' });
      expect((await patch({ status: 'awaiting_input' })).status).toBe(200); // same state is a no-op
    });

    it('active -> stopped (integrity stop) is worker-legal; no other caller may make it; stopped resumes (W8.1 R1)', async () => {
      const patch = (body: object) => session.PATCH(req('PATCH', `${P}/sessions/${sid}`, body), set(sid));
      expect((await patch({ status: 'active' })).status).toBe(200);
      for (const [, auth] of NOT_WORKERS) {
        vi.mocked(requireAuth).mockResolvedValue(auth);
        expect((await patch({ status: 'stopped' })).status).toBe(403);
      }
      vi.mocked(requireAuth).mockResolvedValue(WORKER);
      expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sid } })).status).toBe('active');
      const res = await patch({ status: 'stopped' });
      expect(res.status).toBe(200);
      expect((await res.json()).session.status).toBe('stopped');
      expect((await patch({ status: 'awaiting_input' })).status).toBe(200);
    });

    it('cost_usd is monotonic', async () => {
      const patch = (body: object) => session.PATCH(req('PATCH', `${P}/sessions/${sid}`, body), set(sid));
      expect((await patch({ cost_usd: 1.5 })).status).toBe(200);
      expect((await patch({ cost_usd: 1.0 })).status).toBe(409);
      expect((await patch({ cost_usd: 1.5 })).status).toBe(200);
      expect((await (await patch({ cost_usd: 2 })).json()).session.cost_usd).toBe(2);
    });

    it('preview_url host must be <alias>.<project>.pages.dev; unknown and publish fields are refused', async () => {
      const s = await prisma.designSession.findUniqueOrThrow({ where: { id: sid } });
      const patch = (body: object) => session.PATCH(req('PATCH', `${P}/sessions/${sid}`, body), set(sid));
      expect((await patch({ preview_url: 'https://evil.example.com/' })).status).toBe(400);
      expect((await patch({ preview_url: 'https://design-zzzz.proj.pages.dev' })).status).toBe(400);
      expect((await patch({ preview_url: `https://${s.preview_alias}.proj.pages.dev`, preview_sha: 'abcdef1' })).status).toBe(200);
      for (const bad of [{ last_publish_id: sid }, { publish_requested_at: new Date() }, { designer_id: sid }, { verb: 'stop' }, { task_id: sid }]) {
        expect((await patch(bad)).status).toBe(400);
      }
    });

    it('GET session returns the box context with drive_folder_id (override > client > null)', async () => {
      const get = async () => (await (await session.GET(req('GET', `${P}/sessions/${sid}`), set(sid))).json());
      expect((await get()).drive_folder_id).toBeNull();
      await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: 'client-folder' } });
      expect((await get()).drive_folder_id).toBe('client-folder');
      await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: 'project-folder' } });
      const body = await get();
      expect(body.drive_folder_id).toBe('project-folder');
      expect(body.task.id).toBe(tid);
      expect(body.site.id).toBe(f.siteId);
      expect(body.designer.name).toContain(f.tag);
      expect(body.pins).toEqual([]);
      await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: null } });
      await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: null } });
    });
  });

  describe('events', () => {
    it('allocates seqs, acks designer events, and caps at 100 events and 32 KB', async () => {
      const { seq } = await appendDesignerEvent({ sessionId: sid, authorId: f.designer.userId, kind: 'text', payload: { text: 'hi' }, clientRef: 'c1' });
      const post = (body: object) => events.POST(req('POST', `${P}/sessions/${sid}/events`, body), set(sid));
      const r = await post({ acks: [seq], events: [{ role: 'assistant', kind: 'text', payload: { text: 'hello' } }] });
      expect(r.status).toBe(200);
      expect((await r.json()).last_seq).toBeGreaterThan(seq);
      expect((await prisma.designEvent.findFirstOrThrow({ where: { session_id: sid, seq } })).delivered_at).not.toBeNull();
      const many = Array.from({ length: 101 }, () => ({ role: 'tool', kind: 'action', payload: { tool: 't' } }));
      expect((await post({ events: many })).status).toBe(413);
      expect((await post({ events: [{ role: 'tool', kind: 'result', payload: { big: 'x'.repeat(33 * 1024) } }] })).status).toBe(413);
      expect((await post({ events: [{ role: 'designer', kind: 'text', payload: {} }] })).status).toBe(400);
    });
    it('accepts a lib_index event (W6.10) and stores it', async () => {
      const post = (body: object) => events.POST(req('POST', `${P}/sessions/${sid}/events`, body), set(sid));
      const payload = { sha: 'abc1234', index: { hero: { pages: 3, sample: ['/', '/about/'] } } };
      expect((await post({ events: [{ role: 'tool', kind: 'lib_index', payload }] })).status).toBe(200);
      const row = await prisma.designEvent.findFirstOrThrow({ where: { session_id: sid, kind: 'lib_index' }, orderBy: { seq: 'desc' } });
      expect(row.payload).toEqual(payload);
    });
  });

  describe('assets', () => {
    it('stores a PNG privately, serves it back by session, rejects non-PNG, oversize and foreign sessions', async () => {
      const ok = await assets.POST(upload(sid, PNG(), 'crop', 390), set(sid));
      expect(ok.status).toBe(201);
      const { asset_id } = await ok.json();
      const row = await prisma.designAsset.findUniqueOrThrow({ where: { id: asset_id } });
      expect(row).toMatchObject({ kind: 'crop', content_type: 'image/png', width: 390, storage_key: `design/${sid}/${asset_id}` });
      expect(store.has(`portal-private/design/${sid}/${asset_id}`)).toBe(true);

      const got = await asset.GET(req('GET', `${P}/x`), ctx({ id: sid, assetId: asset_id }));
      expect(got.status).toBe(200);
      expect(got.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await got.arrayBuffer()).equals(PNG())).toBe(true);

      expect((await assets.POST(upload(sid, Buffer.from('GIF89a-not-png'), 'crop'), set(sid))).status).toBe(400);
      expect((await assets.POST(upload(sid, Buffer.concat([PNG(), Buffer.alloc(4 * 1024 * 1024)]), 'before'), set(sid))).status).toBe(413);
      expect((await assets.POST(upload(sid, PNG(), 'bogus'), set(sid))).status).toBe(400);
      expect((await assets.POST(upload(sid, Buffer.alloc(1024 * 1024 + 1, 97), 'gate_log'), set(sid))).status).toBe(413);
      const log = await assets.POST(upload(sid, Buffer.from('gate output'), 'gate_log'), set(sid));
      expect(log.status).toBe(201);
      expect((await prisma.designAsset.findUniqueOrThrow({ where: { id: (await log.json()).asset_id } })).content_type).toBe('text/plain');

      const tid2 = await seedTask(f, 'second');
      await prisma.designSession.update({ where: { id: sid }, data: { status: 'awaiting_input' } });
      const other = (await createOrGetSession(f.admin, tid2)).session.id;
      const foreign = await asset.GET(req('GET', `${P}/x`), ctx({ id: other, assetId: asset_id }));
      expect(foreign.status).toBe(404);
    });
  });

  describe('changes, pins, scope flags', () => {
    let pinId: string;
    let pin2: string;
    let assetId: string;
    beforeAll(async () => {
      const mk = () => prisma.designPin.create({
        data: { session_id: sid, author_id: f.designer.userId, status: 'sent', note: 'n', page_path: '/', selector: 'h1', bbox: { x: 0, y: 0, w: 1, h: 1 }, viewport_width: 390 },
      });
      pinId = (await mk()).id;
      pin2 = (await mk()).id;
      assetId = (await prisma.designAsset.findFirstOrThrow({ where: { session_id: sid } })).id;
    });

    it('POST changes: 201, repeat is 200, listed pins resolve', async () => {
      const body = { commit_sha: 'abc1234', parent_sha: 'abc0000', summary: 'Tighten hero', files: ['a.njk'], pin_ids: [pinId] };
      const first = await changes.POST(req('POST', `${P}/sessions/${sid}/changes`, body), set(sid));
      expect(first.status).toBe(201);
      const changeId = (await first.json()).change.id;
      const again = await changes.POST(req('POST', `${P}/sessions/${sid}/changes`, body), set(sid));
      expect(again.status).toBe(200);
      expect((await again.json()).change.id).toBe(changeId);
      expect((await prisma.designPin.findUniqueOrThrow({ where: { id: pinId } })).status).toBe('resolved');

      const ok = await change.PATCH(req('PATCH', `${P}/changes/${changeId}`, { before_asset_ids: [assetId], gates: [{ name: 'build', ok: true }] }), set(changeId));
      expect(ok.status).toBe(200);
      expect((await prisma.designChange.findUniqueOrThrow({ where: { id: changeId } })).before_asset_ids).toEqual([assetId]);
      const foreign = await change.PATCH(req('PATCH', `${P}/changes/${changeId}`, { after_asset_ids: ['22222222-2222-4222-8222-222222222222'] }), set(changeId));
      expect(foreign.status).toBe(400);
    });

    it('PATCH pins: crop, status, and a foreign asset is refused', async () => {
      const res = await pin.PATCH(req('PATCH', `${P}/pins/${pin2}`, { crop_asset_id: assetId }), set(pin2));
      expect(res.status).toBe(200);
      expect((await res.json()).pin.crop_asset_id).toBe(assetId);
      expect((await pin.PATCH(req('PATCH', `${P}/pins/${pin2}`, { crop_asset_id: '22222222-2222-4222-8222-222222222222' }), set(pin2))).status).toBe(400);
      expect((await pin.PATCH(req('PATCH', `${P}/pins/${pin2}`, { status: 'discarded' }), set(pin2))).status).toBe(400);
    });

    it('scope-flags builds the follow-up: Follow-up: title, design-followup tag, never the owner, never needs-mike', async () => {
      await prisma.designPortalSettings.update({ where: { id: 1 }, data: { owner_user_id: f.admin.userId } });
      const post = (body: object) => scope.POST(req('POST', `${P}/sessions/${sid}/scope-flags`, body), set(sid));
      const res = await post({ title: 'Footer is a different job', detail: 'Wider than this task', pin_ids: [pin2], asset_ids: [assetId] });
      expect(res.status).toBe(201);
      const task = await prisma.task.findUniqueOrThrow({ where: { id: (await res.json()).task_id } });
      f.taskIds.push(task.id);
      expect(task.title).toBe('Follow-up: Footer is a different job');
      expect(task.tags).toEqual(['design-followup']);
      expect(task.assignee_id).toBeNull();
      expect(task.status).toBe('not_started');
      expect(task.source).toBe('internal');
      expect(task.project_id).toBe(f.projectId);
      expect(task.client_id).toBe(f.clientId);
      expect(task.site_id).toBe(f.siteId);
      expect(task.description).toContain(`/design/s/${sid}`);
      expect(task.description).toContain(assetId);
      expect(task.tags.some((t) => t.includes('needs-mike'))).toBe(false);
      const p = await prisma.designPin.findUniqueOrThrow({ where: { id: pin2 } });
      expect(p).toMatchObject({ status: 'followup', followup_task_id: task.id });

      const mine = await post({ title: 'For me', assign_to_designer: true });
      const t2 = await prisma.task.findUniqueOrThrow({ where: { id: (await mine.json()).task_id } });
      f.taskIds.push(t2.id);
      expect(t2.assignee_id).toBe(f.designer.userId);
      expect(t2.assignee_id).not.toBe(f.admin.userId);

      // Even if the designer were the owner, the owner is not assigned.
      await prisma.designPortalSettings.update({ where: { id: 1 }, data: { owner_user_id: f.designer.userId } });
      const t3 = await prisma.task.findUniqueOrThrow({ where: { id: (await (await post({ title: 'Owner case', assign_to_designer: true })).json()).task_id } });
      f.taskIds.push(t3.id);
      expect(t3.assignee_id).toBeNull();
    });

    it('scope-flags validates: foreign pins, a project the designer is not on, long titles', async () => {
      const post = (body: object) => scope.POST(req('POST', `${P}/sessions/${sid}/scope-flags`, body), set(sid));
      expect((await post({ title: 'x', pin_ids: ['22222222-2222-4222-8222-222222222222'] })).status).toBe(400);
      const stranger = await prisma.project.create({ data: { name: `${f.tag} other`, client_id: f.clientId, status: 'in_progress' } });
      expect((await post({ title: 'x', project_id: stranger.id })).status).toBe(400);
      expect((await post({ title: 'x'.repeat(201) })).status).toBe(400);
      await prisma.projectTeamAssignment.create({ data: { project_id: stranger.id, user_id: f.designer.userId, function_id: f.functionId } });
      const ok = await post({ title: 'Other project', project_id: stranger.id });
      expect(ok.status).toBe(201);
      const t = await prisma.task.findUniqueOrThrow({ where: { id: (await ok.json()).task_id } });
      f.taskIds.push(t.id);
      expect(t.project_id).toBe(stranger.id);
      await prisma.task.deleteMany({ where: { id: t.id } });
      await prisma.projectTeamAssignment.deleteMany({ where: { project_id: stranger.id } });
      await prisma.project.delete({ where: { id: stranger.id } });
    });
  });

  describe('commands and inbox', () => {
    it('claim is compare-and-set; complete needs a claim; publish commands need a final publish', async () => {
      const { command: c } = await createCommand({ sessionId: sid, verb: 'restore', payload: { to_sha: 'abc1234' }, createdById: f.designer.userId });
      const patch = (id: string, body: object) => command.PATCH(req('PATCH', `${P}/commands/${id}`, body), set(id));
      expect((await patch(c.id, { action: 'complete', status: 'done' })).status).toBe(409);
      expect((await patch(c.id, { action: 'claim' })).status).toBe(200);
      expect((await patch(c.id, { action: 'claim' })).status).toBe(409);
      expect((await patch(c.id, { action: 'complete', status: 'done', result: { x: 'y'.repeat(9000) } })).status).toBe(413);
      expect((await patch(c.id, { action: 'complete', status: 'done', result: { ok: true } })).status).toBe(200);

      const pub = await prisma.designPublish.create({
        data: { session_id: sid, site_id: f.siteId, task_id: tid, actor_id: f.admin.userId, actor_role: 'admin', publish_mode: 'per_site', main_role: 'production', site_designer_publish: true, status: 'running', head_sha: 'abc1234' },
      });
      const { command: pc } = await createCommand({ sessionId: sid, verb: 'publish', payload: { publish_id: pub.id }, createdById: f.admin.userId });
      await patch(pc.id, { action: 'claim' });
      expect((await patch(pc.id, { action: 'complete', status: 'done' })).status).toBe(409);
      await prisma.designPublish.update({ where: { id: pub.id }, data: { status: 'published' } });
      expect((await patch(pc.id, { action: 'complete', status: 'done' })).status).toBe(200);
    });

    it('inbox: commands first oldest first with the publish snapshot, messages, new sessions, settings; empty when disabled', async () => {
      const t0 = new Date(Date.now() - 60_000);
      const target = await prisma.designPublish.create({
        data: {
          session_id: sid, site_id: f.siteId, task_id: tid, actor_id: f.admin.userId, actor_role: 'admin', publish_mode: 'per_site', main_role: 'client_preview',
          site_designer_publish: true, status: 'published', head_sha: 'aaa1111', from_main_sha: 'bbb2222', result_sha: 'ccc3333',
          confirmed_at: t0, confirmation_shown: { live_url: 'https://live.example.test', main_role: 'client_preview', main_branch: 'main' },
        },
      });
      const rb = await prisma.designPublish.create({
        data: {
          session_id: sid, site_id: f.siteId, task_id: tid, kind: 'rollback', rolls_back_id: target.id, actor_id: f.admin.userId, actor_role: 'admin',
          publish_mode: 'per_site', main_role: 'client_preview', site_designer_publish: true, status: 'queued',
        },
      });
      const first = (await createCommand({ sessionId: sid, verb: 'stop', createdById: f.designer.userId })).command;
      const second = (await createCommand({ sessionId: sid, verb: 'rollback', payload: { publish_id: rb.id, target_publish_id: target.id }, createdById: f.admin.userId })).command;
      await prisma.designCommand.update({ where: { id: first.id }, data: { created_at: new Date(Date.now() - 5000) } });
      await prisma.designCommand.update({ where: { id: second.id }, data: { created_at: new Date(Date.now() - 1000) } });
      await prisma.designSession.update({ where: { id: sid }, data: { status: 'awaiting_input' } }).catch(() => {});
      await appendDesignerEvent({ sessionId: sid, authorId: f.designer.userId, kind: 'text', payload: { text: 'steer' }, clientRef: 'c2' });
      await prisma.designPortalSettings.update({ where: { id: 1 }, data: { enabled: true } });

      const body = await (await inbox.GET(req('GET', `${P}/inbox?max=200`))).json();
      const mine = body.commands.filter((c: { session_id: string }) => c.session_id === sid);
      expect(mine.map((c: { id: string }) => c.id).slice(0, 2)).toEqual([first.id, second.id]);
      const times = body.commands.map((c: { created_at: string }) => Date.parse(c.created_at));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      const rollback = mine.find((c: { id: string }) => c.id === second.id);
      expect(rollback.publish).toMatchObject({
        id: rb.id, kind: 'rollback', status: 'queued', rolls_back_id: target.id, actor_role: 'admin', publish_mode: 'per_site',
        main_role: 'client_preview', live_url: 'https://live.example.test', site_designer_publish: true,
        from_main_sha: 'bbb2222', result_sha: 'ccc3333',
      });
      expect(rollback.publish).toHaveProperty('confirmed_at');
      expect(rollback.publish).toHaveProperty('head_sha');
      expect(rollback.created_by).toMatchObject({ id: f.admin.userId, role: 'admin' });
      expect(mine.find((c: { id: string }) => c.id === first.id).publish).toBeUndefined();

      const msg = body.messages.find((m: { session_id: string; payload: { text?: string } }) => m.session_id === sid && m.payload.text === 'steer');
      expect(msg).toBeTruthy();
      expect(msg.author.name).toContain(f.tag);
      expect(body.settings).toMatchObject({ enabled: true });
      expect(body.settings).toHaveProperty('idle_close_minutes');
      expect(body.settings).toHaveProperty('max_live_sessions');
      for (const s of body.new_sessions) expect(s).toHaveProperty('drive_folder_id');

      await prisma.designPortalSettings.update({ where: { id: 1 }, data: { enabled: false } });
      const off = await (await inbox.GET(req('GET', `${P}/inbox`))).json();
      expect(off).toMatchObject({ commands: [], messages: [], new_sessions: [], settings: { enabled: false } });
      await prisma.designPortalSettings.update({ where: { id: 1 }, data: { enabled: true } });
    });

    it('inbox new_sessions carry drive_folder_id: override > client > null', async () => {
      await prisma.designSession.update({ where: { id: sid }, data: { status: 'pending' } });
      const look = async () => (await (await inbox.GET(req('GET', `${P}/inbox?max=200`))).json()).new_sessions.find((s: { id: string }) => s.id === sid);
      expect((await look()).drive_folder_id).toBeNull();
      await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: 'cf' } });
      expect((await look()).drive_folder_id).toBe('cf');
      await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: 'pf' } });
      const s = await look();
      expect(s.drive_folder_id).toBe('pf');
      expect(s).toMatchObject({ id: sid, task_id: tid, site_id: f.siteId, branch: expect.stringMatching(/^design\//) });
      await prisma.project.update({ where: { id: f.projectId }, data: { drive_folder_id: null } });
      await prisma.client.update({ where: { id: f.clientId }, data: { drive_folder_id: null } });
      await prisma.designSession.update({ where: { id: sid }, data: { status: 'awaiting_input' } });
    });
  });

  describe('publishes', () => {
    it('cannot move a row out of awaiting_confirmation, cannot touch audit fields, moves queued rows forward only', async () => {
      await prisma.designPublish.deleteMany({ where: { site_id: f.siteId, status: { in: ['queued', 'running'] } } });
      const mk = (status: 'awaiting_confirmation' | 'queued') => prisma.designPublish.create({
        data: { session_id: sid, site_id: f.siteId, task_id: tid, actor_id: f.admin.userId, actor_role: 'admin', publish_mode: 'per_site', main_role: 'production', site_designer_publish: true, status, confirmed_at: status === 'queued' ? new Date() : null },
      });
      const patch = (id: string, body: object) => publish.PATCH(req('PATCH', `${P}/publishes/${id}`, body), set(id));
      const awaiting = await mk('awaiting_confirmation');
      for (const status of ['running', 'published', 'failed']) expect((await patch(awaiting.id, { status })).status).toBe(409);
      expect((await prisma.designPublish.findUniqueOrThrow({ where: { id: awaiting.id } })).status).toBe('awaiting_confirmation');
      for (const bad of [{ status: 'queued' }, { status: 'awaiting_confirmation' }, { status: 'running', actor_role: 'designer' }, { status: 'running', main_role: 'production' },
        { status: 'running', confirmation_typed: 'main' }, { status: 'running', publish_mode: 'off' }, { status: 'running', site_designer_publish: false }, { status: 'running', kind: 'rollback' }]) {
        expect((await patch(awaiting.id, bad)).status).toBe(400);
      }
      await prisma.designPublish.delete({ where: { id: awaiting.id } });
      const queued = await mk('queued');
      expect((await patch(queued.id, { status: 'running', from_main_sha: 'abc1234' })).status).toBe(200);
      expect((await prisma.designPublish.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe('running');
      expect((await patch(queued.id, { status: 'failed', error: 'boom' })).status).toBe(200);
      expect((await patch(queued.id, { status: 'running' })).status).toBe(409);
      await prisma.designPublish.delete({ where: { id: queued.id } });
    });
  });

  describe('heartbeat', () => {
    it('stores main_role and live_url per site, bumps listed sessions, renews their claims', async () => {
      const saved = await prisma.designWorkerState.findUniqueOrThrow({ where: { id: 1 } });
      try {
        await prisma.task.update({ where: { id: tid }, data: { claim_holder: `design:${tid.replace(/-/g, '').slice(0, 8)}`, claim_token: sid, lease_until: new Date(Date.now() + 1000), claimed_at: new Date() } });
        const res = await heartbeat.POST(req('POST', `${P}/heartbeat`, {
          version: '1.0.0', sdk_version: '0.2.0', paused: true, pause_reason: 'fleet_pause',
          configured_site_ids: [f.siteId], site_main_roles: { [f.siteId]: 'client_preview' }, site_live_urls: { [f.siteId]: 'https://live.example.test' },
          sessions: [{ id: sid, alive: true, status: 'awaiting_input' }],
        }));
        expect(res.status).toBe(200);
        const out = await res.json();
        expect(out.ok).toBe(true);
        expect(out.renew_claims).toContain(tid);
        const w = await prisma.designWorkerState.findUniqueOrThrow({ where: { id: 1 } });
        expect(w).toMatchObject({ version: '1.0.0', paused: true, pause_reason: 'fleet_pause', live_sessions: 1, configured_site_ids: [f.siteId] });
        expect(w.site_main_roles).toEqual({ [f.siteId]: 'client_preview' });
        expect(w.site_live_urls).toEqual({ [f.siteId]: 'https://live.example.test' });
        expect(w.last_heartbeat_at).not.toBeNull();
        expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sid } })).last_heartbeat_at).not.toBeNull();
        expect((await heartbeat.POST(req('POST', `${P}/heartbeat`, { configured_site_ids: ['nope'] }))).status).toBe(400);
        expect((await heartbeat.POST(req('POST', `${P}/heartbeat`, { configured_site_ids: [], site_live_urls: { [f.siteId]: 'not a url' } }))).status).toBe(400);
      } finally {
        await prisma.designWorkerState.update({
          where: { id: 1 },
          data: {
            ...saved, site_main_roles: saved.site_main_roles ?? undefined, site_live_urls: saved.site_live_urls ?? undefined,
          } as never,
        });
      }
    });
  });

  describe('closing', () => {
    it('the server picks abandoned when no publish succeeded', async () => {
      await prisma.designPublish.deleteMany({ where: { session_id: sid } });
      await prisma.designCommand.deleteMany({ where: { session_id: sid } });
      const res = await session.PATCH(req('PATCH', `${P}/sessions/${sid}`, { status: 'closed' }), set(sid));
      expect(res.status).toBe(200);
      expect((await res.json()).session.status).toBe('abandoned');
    });
  });
});
