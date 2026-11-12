// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';
import { seedWorld, teardownWorlds, type TrackWorld } from '@/lib/design/__tests__/track-world';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { DESIGN_WORKER_SERVICE_EMAIL } from '@/lib/design/helpers';
import { claimJob, expireLeases } from '@/lib/design/track-jobs';
import { completeStageTask, trackTx, queueJob } from '@/lib/design/track-core';
import { homeReady, rebuildHome, signDirection, onFinishGreen } from '@/lib/design/track-stage';
import { computeRecipients } from '@/lib/design/track-runner';
import * as candidates from '../candidates/route';
import * as tracks from '../tracks/route';
import * as track from '../tracks/[id]/route';
import * as claims from '../claims/route';
import * as job from '../jobs/[id]/route';
import * as refs from '../tracks/[id]/references/route';
import * as ref from '../references/[id]/route';
import * as briefs from '../tracks/[id]/briefs/route';
import * as adopt from '../tracks/[id]/adopt/route';
import * as imports from '../tracks/[id]/imports/route';
import * as command from '../../worker/commands/[id]/route';
import * as homeReadyRoute from '../../sessions/[id]/home-ready/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

const BRIEF = {
  version: 1, client: 'Test Co', one_line: 'A calm site for people who work hard.',
  sections: [{ id: 'brand', title: 'Brand', cards: [{ id: 'brand-01', headline: 'Warm and plain', summary: 'Short summary of the finding.', image_asset_ids: [], detail_md: 'Detail.', sources: [{ kind: 'file', path: 'CL/x/profile/brand.md' }], confidence: 'evidenced' }] }],
};

describe.skipIf(!SCRATCH)('design track engine (real database)', () => {
  let f: DesignFixture;
  let bastId: string;
  let workerId: string;
  const worlds: TrackWorld[] = [];
  let RUNNER: Record<string, unknown>;
  let WORKER: Record<string, unknown>;
  const createdUsers: string[] = [];

  const world = async (label: string, opts: Parameters<typeof seedWorld>[2] = {}) => {
    const w = await seedWorld(f, label, opts);
    worlds.push(w);
    return w;
  };
  const asRunner = () => as.mockResolvedValue(RUNNER);
  const asWorker = () => as.mockResolvedValue(WORKER);
  const asDesigner = (userId = f.designer.userId) => as.mockResolvedValue({ userId, email: 'd@example.test', role: 'designer', via: 'session' });

  /** Start the world's track through the route. */
  async function start(w: TrackWorld) {
    asRunner();
    const res = await tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.provision }));
    expect(res.status).toBe(201);
    return (await res.json()).track as { id: string; slug: string; stage: string; branch: string; preview_alias: string };
  }
  async function claim(kinds?: string[]) {
    asRunner();
    const res = await claims.POST(json('POST', '/api/design/runner/claims', { runner_id: 'r1', ...(kinds ? { kinds } : {}) }));
    if (res.status === 204) return null;
    expect(res.status).toBe(200);
    return (await res.json()).job as { id: string; kind: string; status: string; attempts: number; track_id: string; task_id: string | null; error: string | null; lease_until: string };
  }
  async function report(jobId: string, body: Record<string, unknown>) {
    asRunner();
    return job.PATCH(json('PATCH', `/api/design/runner/jobs/${jobId}`, body), ctx({ id: jobId }));
  }
  async function adoptJob(trackId: string, slug: string, jobId: string, n = 1) {
    asRunner();
    return adopt.POST(json('POST', `/api/design/runner/tracks/${trackId}/adopt`, { job_id: jobId, job_branch: `design/t-${slug}-job-${n}`, expected_base: SHA }), ctx({ id: trackId }));
  }
  /** The daemon: claim the command, then complete it. */
  async function daemon(cmdId: string, status: 'done' | 'failed', result?: Record<string, unknown>, error?: string) {
    asWorker();
    const c = await command.PATCH(json('PATCH', `/api/design/worker/commands/${cmdId}`, { action: 'claim' }), ctx({ id: cmdId }));
    expect(c.status).toBe(200);
    return command.PATCH(json('PATCH', `/api/design/worker/commands/${cmdId}`, { action: 'complete', status, ...(result ? { result } : {}), ...(error ? { error } : {}) }), ctx({ id: cmdId }));
  }
  const adoptOk = (pages: Array<{ path: string; title?: string }> = [{ path: '/', title: 'Home' }], head = SHA2) => ({
    head_sha: head, preview_url: 'https://design-t-x.example.pages.dev', preview_sha: head, pages,
  });
  const task = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const stage = async (id: string) => (await prisma.designTrack.findUniqueOrThrow({ where: { id } })).stage;

  /** Run the world's track from start to art_direction. Returns the track. */
  async function toArtDirection(w: TrackWorld) {
    const t = await start(w);
    const p = await claim(['provision']);
    expect((await report(p!.id, { action: 'done' })).status).toBe(200);
    const r = await claim(['research']);
    expect((await report(r!.id, { action: 'done' })).status).toBe(200);
    const wf = await claim(['wireframe']);
    const a = await adoptJob(t.id, t.slug, wf!.id);
    expect(a.status).toBe(201);
    const cmdId = (await a.json()).command.id;
    expect((await daemon(cmdId, 'done', adoptOk())).status).toBe(200);
    asRunner();
    const b = await briefs.POST(json('POST', `/api/design/runner/tracks/${t.id}/briefs`, { body: BRIEF }), ctx({ id: t.id }));
    expect(b.status).toBe(201);
    expect((await b.json()).entered_art_direction).toBe(true);
    return t;
  }

  beforeAll(async () => {
    f = await seedDesign(`tk${Date.now()}`);
    const mk = async (email: string, role: 'pm' | 'tech') => {
      const u = (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { email, password_hash: 'x', name: email, role } }));
      return u;
    };
    const bast = await prisma.user.create({ data: { email: `bast-${f.tag}@example.test`, password_hash: 'x', name: 'Bast test', role: 'pm' } });
    createdUsers.push(bast.id);
    bastId = bast.id;
    const wk = await mk(DESIGN_WORKER_SERVICE_EMAIL, 'tech');
    workerId = wk.id;
    RUNNER = { userId: bastId, email: bast.email, role: 'pm', via: 'api_key', apiKeyId: 'k-run', lane: 'design-track', laneEnforced: true };
    WORKER = { userId: workerId, email: DESIGN_WORKER_SERVICE_EMAIL, role: 'tech', via: 'api_key', apiKeyId: 'k-wrk', lane: 'design-worker', laneEnforced: true };
    // an earlier run's queued jobs must not be claimed by these tests
    await prisma.designJob.updateMany({ where: { status: 'queued' }, data: { status: 'cancelled' } });
  });
  afterAll(async () => {
    await teardownWorlds(f, worlds);
    await prisma.designCommand.deleteMany({ where: { created_by_id: bastId } });
    await teardownDesign(f);
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  });
  // claims are global: each test starts with no queued job from any earlier test
  beforeEach(async () => {
    as.mockReset();
    await prisma.designJob.updateMany({ where: { status: 'queued' }, data: { status: 'cancelled' } });
  });

  // -----------------------------------------------------------------------------------------------------------
  describe('start and candidates', () => {
    it('lists a ready portal task, reports why a site is not ready, and starts one open track per site', async () => {
      const w = await world('cand');
      asRunner();
      const list = (await (await candidates.GET()).json()).candidates as Array<Record<string, unknown>>;
      const mine = list.filter((c) => c.project_id === w.projectId);
      expect(mine.map((c) => c.kind).sort()).toEqual(['provision', 'research']);
      expect(mine.every((c) => c.blocked_reason === null)).toBe(true);

      await prisma.site.update({ where: { id: w.siteId }, data: { bast_enabled: false } });
      const blocked = ((await (await candidates.GET()).json()).candidates as Array<Record<string, unknown>>).filter((c) => c.project_id === w.projectId);
      expect(blocked.every((c) => c.blocked_reason === 'bast_enabled_false')).toBe(true);
      const refused = await tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.provision }));
      expect(refused.status).toBe(409);
      expect((await refused.json()).code).toBe('site_not_ready');
      await prisma.site.update({ where: { id: w.siteId }, data: { bast_enabled: true } });

      const [a, b] = await Promise.all([
        tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.provision })),
        tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.research })),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      const [ta, tb] = [(await a.json()).track, (await b.json()).track];
      expect(ta.id).toBe(tb.id);
      expect(ta.slug).toMatch(/^[a-z2-7]{16}$/);
      expect(ta.branch).toBe(`design/t-${ta.slug}`);
      expect(ta.preview_alias).toBe(`design-t-${ta.slug}`);
      expect(ta.stage).toBe('research');
      const jobs = await prisma.designJob.findMany({ where: { track_id: ta.id }, orderBy: { kind: 'asc' } });
      expect(jobs.map((j) => [j.kind, j.status, j.task_id])).toEqual([['provision', 'queued', w.t.provision], ['research', 'queued', w.t.research]]);
      // the task is no longer a candidate once the runner claims its job (in_progress); a non-candidate task is refused
      const notCand = await tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.art }));
      expect(notCand.status).toBe(409);
    });

    it('a site off the portal design path is not a candidate and cannot start a track', async () => {
      const w = await world('legacy');
      await prisma.site.update({ where: { id: w.siteId }, data: { design_path: 'designer' } });
      asRunner();
      const list = (await (await candidates.GET()).json()).candidates as Array<Record<string, unknown>>;
      expect(list.some((c) => c.project_id === w.projectId)).toBe(false);
      expect((await tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.provision }))).status).toBe(409);
    });
  });

  // -----------------------------------------------------------------------------------------------------------
  describe('the whole track: every legal transition', () => {
    it('walks research -> art_direction -> home_build -> refine -> rest_build -> review -> done with its task effects', async () => {
      const w = await world('walk');
      const t = await toArtDirection(w);
      expect(await stage(t.id)).toBe('art_direction');
      // Bot tasks closed by Bast, approved; the art direction task unblocked by the approval-gated propagation
      for (const id of [w.t.provision, w.t.research, w.t.wireframe]) {
        const row = await task(id);
        expect([row.status, row.approved, row.approved_by_id]).toEqual(['done', true, bastId]);
      }
      expect((await task(w.t.art)).status).toBe('not_started');
      expect((await task(w.t.wireframe)).assignee_id).toBe(bastId); // assigned when the runner claimed its job

      // art_direction -> home_build (the sign route, W1.3, calls this)
      const signed = await signDirection(t.id, { designerId: f.designer.userId, modules: [{ feature: 'commerce' }], clientEmailPayload: { art_direction_id: 'x' }, buildPayload: { art_direction_id: 'x' } });
      const afterSign = await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } });
      expect(afterSign.stage).toBe('home_build');
      expect(afterSign.busy_job_id).toBe(signed.buildJobId);
      const art = await task(w.t.art);
      expect([art.status, art.approved, art.approved_by_id]).toEqual(['done', true, f.designer.userId]);
      expect((await task(w.t.home)).status).toBe('not_started');
      const queued = await prisma.designJob.findMany({ where: { track_id: t.id, status: 'queued' }, orderBy: { kind: 'asc' } });
      expect(queued.map((j) => j.kind).sort()).toEqual(['brief', 'client_brief_email', 'home_build', 'module']); // the brief job is still waiting out its 20 minutes

      // home_build -> refine on the adopt completion
      const hb = await claim(['home_build']);
      expect(hb!.task_id).toBe(w.t.home);
      expect((await task(w.t.home)).status).toBe('in_progress');
      expect((await report(hb!.id, { action: 'done' })).status).toBe(409); // adopt_pending
      const a = await adoptJob(t.id, t.slug, hb!.id, 2);
      const cmd = (await a.json()).command;
      expect(cmd.verb).toBe('adopt_branch');
      expect(cmd.payload).toEqual({
        track_id: t.id, site_id: w.siteId, job_id: hb!.id, job_kind: 'home_build', branch: t.branch, preview_alias: t.preview_alias,
        job_branch: `design/t-${t.slug}-job-2`, expected_base: SHA,
      });
      expect(cmd.session_id).toBeNull();
      expect((await daemon(cmd.id, 'done', adoptOk())).status).toBe(200);
      const afterHome = await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } });
      expect([afterHome.stage, afterHome.busy_job_id, afterHome.head_sha, afterHome.preview_url]).toEqual(['refine', null, SHA2, 'https://design-t-x.example.pages.dev']);
      expect((await task(w.t.home)).status).toBe('done');
      expect((await task(w.t.refine)).status).toBe('not_started');
      expect((await prisma.designJob.findUniqueOrThrow({ where: { id: hb!.id } })).status).toBe('done');

      // refine -> rest_build: the designer's "Home is ready" through the route, on a tracked session
      const sess = await prisma.designSession.create({
        data: {
          task_id: w.t.refine, site_id: w.siteId, project_id: w.projectId, designer_id: f.designer.userId, status: 'awaiting_input',
          branch: t.branch, preview_alias: t.preview_alias, model: 'opus', effort: 'high', budget_usd: 25, track_id: t.id,
        },
      });
      const plain = await prisma.designSession.create({
        data: {
          task_id: w.t.home, site_id: w.siteId, project_id: w.projectId, designer_id: f.designer.userId, status: 'closed',
          branch: 'design/00000000', preview_alias: 'design-00000000', model: 'opus', effort: 'high', budget_usd: 25,
        },
      });
      asDesigner(f.other.userId);
      expect((await homeReadyRoute.POST(json('POST', `/api/design/sessions/${sess.id}/home-ready`, {}), ctx({ id: sess.id }))).status).toBe(404);
      asDesigner();
      expect((await homeReadyRoute.POST(json('POST', `/api/design/sessions/${plain.id}/home-ready`, {}), ctx({ id: plain.id }))).status).toBe(404); // untracked
      const hr = await homeReadyRoute.POST(json('POST', `/api/design/sessions/${sess.id}/home-ready`, {}), ctx({ id: sess.id }));
      expect(hr.status).toBe(202);
      const afterReady = await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } });
      expect(afterReady.stage).toBe('rest_build');
      expect(afterReady.busy_job_id).not.toBeNull();
      const refine = await task(w.t.refine);
      expect([refine.status, refine.approved, refine.approved_by_id]).toEqual(['done', true, f.designer.userId]);
      expect((await prisma.designJob.findUniqueOrThrow({ where: { id: afterReady.busy_job_id! } })).kind).toBe('rest_build');
      const lines = await prisma.designEvent.findMany({ where: { session_id: sess.id, kind: 'track_stage' } });
      expect(lines.length).toBeGreaterThan(0); // a status line for the live session, role system, never delivered
      expect(lines.every((l) => l.role === 'system')).toBe(true);
      // a second tap is an illegal transition
      asDesigner();
      const again = await homeReadyRoute.POST(json('POST', `/api/design/sessions/${sess.id}/home-ready`, {}), ctx({ id: sess.id }));
      expect(again.status).toBe(409);
      expect((await again.json()).code).toBe('illegal_transition');

      // rest_build -> review: page reviews, one requirement per page, task moves
      const rb = await claim(['rest_build']);
      const a2 = await adoptJob(t.id, t.slug, rb!.id, 3);
      const pages = [{ path: '/', title: 'Home' }, { path: '/about/', title: 'Our Story' }, { path: '/contact/' }];
      expect((await daemon((await a2.json()).command.id, 'done', adoptOk(pages, 'c'.repeat(40)))).status).toBe(200);
      const afterRest = await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } });
      expect([afterRest.stage, afterRest.busy_job_id]).toEqual(['review', null]);
      expect((await task(w.t.rest)).status).toBe('done');
      const reviews = await prisma.designPageReview.findMany({ where: { track_id: t.id }, orderBy: { page_path: 'asc' } });
      expect(reviews.map((r) => [r.page_path, r.title, r.status])).toEqual([['/', 'Home', 'not_opened'], ['/about/', 'Our Story', 'not_opened'], ['/contact/', '/contact/', 'not_opened']]);
      const reqs = (await task(w.t.review)).requirements as Array<{ id: string; text: string }>;
      expect(reqs.map((r) => r.text)).toEqual(['Review Home (/)', 'Review Our Story (/about/)', 'Review /contact/ (/contact/)']);
      expect(reviews.map((r) => r.requirement_id)).toEqual(reqs.map((r) => r.id));
      expect((await task(w.t.review)).status).toBe('not_started');

      // review -> done: finish_gates red first (stays), then green with a moved head (stays), then green (done)
      const mkFinish = async (head: string) => {
        const c = await prisma.designCommand.create({ data: { session_id: sess.id, verb: 'finish_gates', payload: { track_id: t.id, head_sha: head }, created_by_id: f.designer.userId } });
        await prisma.designTrack.update({ where: { id: t.id }, data: { finish_command_id: c.id } });
        return c.id;
      };
      const red = await mkFinish(afterRest.head_sha!);
      expect((await daemon(red, 'done', { green: false, results: [{ path: '/', ok: false }] })).status).toBe(200);
      expect(await stage(t.id)).toBe('review');
      expect(((await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } })).finish_result as { green: boolean }).green).toBe(false);
      const moved = await mkFinish('d'.repeat(40));
      expect((await daemon(moved, 'done', { green: true })).status).toBe(200);
      expect(await stage(t.id)).toBe('review');
      const green = await mkFinish(afterRest.head_sha!);
      expect((await daemon(green, 'done', { results: [{ path: '/', ok: true }, { path: '/about/', ok: true }] })).status).toBe(200);
      const done = await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } });
      expect(done.stage).toBe('done');
      expect(done.finished_at).not.toBeNull();
      const rv = await task(w.t.review);
      expect([rv.status, rv.approved, rv.approved_by_id]).toEqual(['done', true, f.designer.userId]);
      expect((await task(w.t.launch)).status).toBe('not_started');
      expect((await prisma.designJob.findMany({ where: { track_id: t.id, kind: 'launch_readiness' } })).map((j) => [j.status, j.task_id])).toEqual([['queued', w.t.launch]]);

      // launch_readiness done queues the client review email and closes its task
      const lr = await claim(['launch_readiness']);
      expect((await report(lr!.id, { action: 'done', result: { green: true } })).status).toBe(200);
      expect((await task(w.t.launch)).status).toBe('done');
      expect((await prisma.designJob.findMany({ where: { track_id: t.id, kind: 'client_review_email' } })).length).toBe(1);
    });

    it('the brief and the wireframe adopt can land in either order', async () => {
      const w = await world('order');
      const t = await start(w);
      asRunner();
      const b = await briefs.POST(json('POST', `/api/design/runner/tracks/${t.id}/briefs`, { body: BRIEF }), ctx({ id: t.id }));
      expect((await b.json()).entered_art_direction).toBe(false);
      expect(await stage(t.id)).toBe('research');
      await report((await claim(['provision']))!.id, { action: 'done' });
      const wf = await claim(['wireframe']);
      const a = await adoptJob(t.id, t.slug, wf!.id);
      await daemon((await a.json()).command.id, 'done', adoptOk());
      expect(await stage(t.id)).toBe('art_direction');
    });

    it('a transition whose stage task is missing still moves the track and comments on the other stage tasks', async () => {
      const w = await world('notags');
      const t = await toArtDirection(w);
      await prisma.task.update({ where: { id: w.t.art }, data: { tags: [] } });
      await signDirection(t.id, { designerId: f.designer.userId });
      expect(await stage(t.id)).toBe('home_build');
      expect((await task(w.t.art)).status).not.toBe('done');
      const c = await prisma.comment.findMany({ where: { task_id: w.t.refine } });
      expect(c.some((x) => x.content.includes('design-stage:art_direction') && x.is_internal)).toBe(true);
    });

    it('an ordering-only project unblocks on done alone; an approval-gated one needs the approval completeStageTask writes', async () => {
      const w = await world('order-only', { orderingOnly: true });
      expect(await completeStageTask(w.t.provision, bastId)).toBe(true);
      expect((await task(w.t.wireframe)).status).toBe('not_started');
      expect(await completeStageTask(w.t.provision, bastId)).toBe(false); // idempotent
      const g = await world('gated');
      await prisma.task.update({ where: { id: g.t.provision }, data: { status: 'done' } }); // done but NOT approved
      expect((await task(g.t.wireframe)).status).toBe('blocked');
      expect(await completeStageTask(g.t.provision, bastId)).toBe(true);
      expect((await task(g.t.wireframe)).status).toBe('not_started');
    });
  });

  // -----------------------------------------------------------------------------------------------------------
  describe('illegal transitions are refused', () => {
    it('each stage refuses the moves it does not own and changes nothing', async () => {
      const w = await world('illegal');
      const t = await start(w); // research
      await expect(signDirection(t.id, { designerId: f.designer.userId })).rejects.toMatchObject({ statusCode: 409, code: 'illegal_transition' });
      await expect(homeReady(t.id, f.designer.userId)).rejects.toMatchObject({ statusCode: 409, code: 'illegal_transition' });
      await expect(rebuildHome(t.id, { designerId: f.designer.userId })).rejects.toMatchObject({ statusCode: 409, code: 'illegal_transition' });
      expect(await trackTx((s) => onFinishGreen(s, t.id, f.designer.userId))).toBe(false);
      expect(await stage(t.id)).toBe('research');
      expect(await prisma.designJob.count({ where: { track_id: t.id, kind: { in: ['home_build', 'rest_build', 'module', 'client_brief_email'] } } })).toBe(0);

      await prisma.designTrack.update({ where: { id: t.id }, data: { stage: 'art_direction' } });
      await expect(homeReady(t.id, f.designer.userId)).rejects.toMatchObject({ code: 'illegal_transition' });
      await expect(rebuildHome(t.id, { designerId: f.designer.userId })).rejects.toMatchObject({ code: 'illegal_transition' });
      await prisma.designTrack.update({ where: { id: t.id }, data: { stage: 'review' } });
      await expect(signDirection(t.id, { designerId: f.designer.userId })).rejects.toMatchObject({ code: 'illegal_transition' });
      await expect(homeReady(t.id, f.designer.userId)).rejects.toMatchObject({ code: 'illegal_transition' });
      await prisma.designTrack.update({ where: { id: t.id }, data: { stage: 'done' } });
      await expect(signDirection(t.id, { designerId: f.designer.userId })).rejects.toMatchObject({ code: 'illegal_transition' });
      await expect(rebuildHome(t.id, { designerId: f.designer.userId })).rejects.toMatchObject({ code: 'illegal_transition' });
      await prisma.designTrack.update({ where: { id: t.id }, data: { stage: 'cancelled' } });
      await expect(homeReady(t.id, f.designer.userId)).rejects.toMatchObject({ code: 'illegal_transition' });
    });

    it('revise direction: rebuild from refine and review; from home_build only after the build failed for good', async () => {
      const w = await world('rebuild');
      const t = await toArtDirection(w);
      await signDirection(t.id, { designerId: f.designer.userId });
      // home_build with the build job still active: refused
      await expect(rebuildHome(t.id, { designerId: f.designer.userId })).rejects.toMatchObject({ code: 'illegal_transition' });
      // fail the build for good (two attempts)
      for (let i = 0; i < 2; i++) {
        const j = await claim(['home_build']);
        expect((await report(j!.id, { action: 'failed', error: `boom ${i}` })).status).toBe(200);
      }
      const failed = await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } });
      expect(failed.busy_job_id).toBeNull();
      const out = await rebuildHome(t.id, { designerId: f.designer.userId, buildPayload: { mode: 'rebuild' } });
      expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } })).busy_job_id).toBe(out.buildJobId);
      expect(await stage(t.id)).toBe('home_build');
      await prisma.designTrack.update({ where: { id: t.id }, data: { stage: 'refine', busy_job_id: null } });
      await prisma.designJob.updateMany({ where: { id: out.buildJobId }, data: { status: 'cancelled' } });
      const again = await rebuildHome(t.id, { designerId: f.designer.userId });
      expect(await stage(t.id)).toBe('home_build');
      expect(again.buildJobId).not.toBe(out.buildJobId);
    });

    it('two active build jobs on one track are refused by the database index (409 build_running)', async () => {
      const w = await world('twobuild');
      const t = await start(w);
      await trackTx(async ({ tx }) => { await queueJob(tx, { id: t.id, project_id: w.projectId }, 'home_build'); });
      await expect(trackTx(async ({ tx }) => { await queueJob(tx, { id: t.id, project_id: w.projectId }, 'rest_build'); })).rejects.toMatchObject({ statusCode: 409, code: 'build_running' });
    });
  });

  // -----------------------------------------------------------------------------------------------------------
  describe('claim and lease', () => {
    it('claims the oldest job with a 10 minute lease, attempts + 1, the task in_progress and Bast assigned', async () => {
      const w = await world('claim');
      const t = await start(w);
      const first = await claim();
      expect(first!.kind).toBe('provision'); // oldest
      expect(first!.status).toBe('claimed');
      expect(first!.attempts).toBe(1);
      const lease = new Date(first!.lease_until).getTime() - Date.now();
      expect(lease).toBeGreaterThan(9 * 60_000);
      expect(lease).toBeLessThan(10.5 * 60_000);
      expect((await prisma.designJob.findUniqueOrThrow({ where: { id: first!.id } })).claimed_by).toBe('r1');
      const p = await task(w.t.provision);
      expect([p.status, p.assignee_id]).toEqual(['in_progress', bastId]);
      const second = await claim();
      expect(second!.kind).toBe('research');
      expect(await claim()).toBeNull(); // nothing left: 204
      expect(t.id).toBeTruthy();
    });

    it('keeps an existing assignee on claim', async () => {
      const w = await world('assignee');
      await start(w);
      await prisma.task.update({ where: { id: w.t.provision }, data: { assignee_id: f.admin.userId } });
      await claim(['provision']);
      expect((await task(w.t.provision)).assignee_id).toBe(f.admin.userId);
    });

    it('two concurrent claims on one queued job give one winner; on two jobs they get one each', async () => {
      const w = await world('race');
      const t = await start(w);
      await prisma.designJob.updateMany({ where: { track_id: t.id, kind: 'research' }, data: { status: 'cancelled' } });
      const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => claimJob({ userId: bastId, runnerId: `r${i}` })));
      expect(rs.filter(Boolean)).toHaveLength(1);
      expect(rs.find(Boolean)!.attempts).toBe(1);
      const w2 = await world('race2');
      const t2 = await start(w2);
      const pair = await Promise.all(Array.from({ length: 5 }, (_, i) => claimJob({ userId: bastId, runnerId: `p${i}` })));
      const won = pair.filter(Boolean).filter((j) => j!.track_id === t2.id);
      expect(new Set(won.map((j) => j!.id)).size).toBe(won.length);
      expect(won).toHaveLength(2);
    });

    it('an expired lease returns the job to the queue on the next claim; the second expiry fails it for good and parks it', async () => {
      const w = await world('lease');
      const t = await start(w);
      await prisma.designJob.updateMany({ where: { track_id: t.id, kind: 'research' }, data: { status: 'cancelled' } });
      const j1 = await claim(['provision']);
      expect(j1!.attempts).toBe(1);
      await prisma.designJob.update({ where: { id: j1!.id }, data: { lease_until: new Date(Date.now() - 60_000) } });
      const j2 = await claim(['provision']);
      expect([j2!.id, j2!.attempts]).toEqual([j1!.id, 2]);
      expect(j2!.error).toContain('lease_expired');
      // second expiry: attempts is 2, so it stays failed and the task is parked
      await prisma.designJob.update({ where: { id: j2!.id }, data: { lease_until: new Date(Date.now() - 60_000) } });
      expect(await claim(['provision'])).toBeNull();
      const row = await prisma.designJob.findUniqueOrThrow({ where: { id: j1!.id } });
      expect([row.status, row.attempts, row.claimed_by, row.lease_until]).toEqual(['failed', 2, null, null]);
      const p = await task(w.t.provision);
      expect(p.tags).toContain('needs-mike');
      const comments = await prisma.comment.findMany({ where: { task_id: w.t.provision } });
      expect(comments.some((c) => c.content.includes('lease_expired') && c.is_internal)).toBe(true);
    });

    it('a renewed lease is not expired; a late renew after the job was handed on is 409', async () => {
      const w = await world('renew');
      const t = await start(w);
      await prisma.designJob.updateMany({ where: { track_id: t.id, kind: 'research' }, data: { status: 'cancelled' } });
      const j = await claim(['provision']);
      await prisma.designJob.update({ where: { id: j!.id }, data: { lease_until: new Date(Date.now() - 1000) } });
      expect((await report(j!.id, { action: 'renew', runner_id: 'r1' })).status).toBe(200);
      expect(await trackTx((s) => expireLeases(s, bastId))).toBe(0);
      expect((await report(j!.id, { action: 'renew', runner_id: 'someone-else' })).status).toBe(409);
      await prisma.designJob.update({ where: { id: j!.id }, data: { lease_until: new Date(Date.now() - 1000) } });
      await claim(['provision']); // hands it on (attempt 2)
      await prisma.designJob.update({ where: { id: j!.id }, data: { status: 'queued', claimed_by: null } });
      expect((await report(j!.id, { action: 'renew' })).status).toBe(409);
    });

    it('not_before holds a job back; the kinds filter narrows the claim; a brief job is claimable once references settle', async () => {
      const w = await world('before');
      const t = await start(w);
      await prisma.designJob.updateMany({ where: { track_id: t.id }, data: { status: 'cancelled' } });
      await trackTx(async ({ tx }) => {
        await queueJob(tx, { id: t.id, project_id: w.projectId }, 'brief', { notBefore: new Date(Date.now() + 20 * 60_000), taskId: null });
        await queueJob(tx, { id: t.id, project_id: w.projectId }, 'capture', { notBefore: new Date(Date.now() + 20 * 60_000), taskId: null });
      });
      asRunner();
      const added = await refs.POST(json('POST', `/api/design/runner/tracks/${t.id}/references`, { references: [{ source: 'bast_pick', url: 'https://example.com/a', title: 'A' }, { source: 'client_named', title: 'No url' }] }), ctx({ id: t.id }));
      expect(added.status).toBe(201);
      const created = (await added.json()).references as Array<{ id: string; capture_status: string }>;
      expect(created.map((c) => c.capture_status)).toEqual(['queued', 'none']);
      expect(await claim(['capture'])).not.toBeNull(); // the capture queued by the reference route (no not_before)
      expect(await claim(['brief'])).toBeNull(); // 20 minutes not up, a capture is still unsettled
      asRunner();
      const patched = await ref.PATCH(json('PATCH', `/api/design/runner/references/${created[0].id}`, { capture_status: 'failed', capture_error: 'timeout' }), ctx({ id: created[0].id }));
      expect(patched.status).toBe(200);
      const b = await claim(['brief']);
      expect(b!.kind).toBe('brief');
      // a duplicate URL is skipped
      asRunner();
      const dup = await refs.POST(json('POST', `/api/design/runner/tracks/${t.id}/references`, { references: [{ source: 'bast_pick', url: 'https://example.com/a', title: 'A again' }] }), ctx({ id: t.id }));
      expect((await dup.json()).skipped).toEqual(['https://example.com/a']);
    });
  });

  // -----------------------------------------------------------------------------------------------------------
  describe('failure, park and follow-ons', () => {
    it('a failed report with attempts left requeues with the error kept; the second failure parks the task with needs-mike and clears busy', async () => {
      const w = await world('park');
      const t = await toArtDirection(w);
      const out = await signDirection(t.id, { designerId: f.designer.userId });
      const j1 = await claim(['home_build']);
      const r1 = await report(j1!.id, { action: 'failed', error: 'first failure', cost_usd: 1.25 });
      expect((await r1.json()).job.status).toBe('queued');
      expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } })).busy_job_id).toBe(out.buildJobId); // still building
      const j2 = await claim(['home_build']);
      expect([j2!.id, j2!.attempts, j2!.error]).toEqual([j1!.id, 2, 'first failure']);
      const r2 = await report(j2!.id, { action: 'failed', error: 'x'.repeat(2000) + ' the tail' });
      expect((await r2.json()).job.status).toBe('failed');
      expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } })).busy_job_id).toBeNull();
      expect((await task(w.t.home)).tags).toContain('needs-mike');
      const cm = await prisma.comment.findMany({ where: { task_id: w.t.home } });
      expect(cm.some((c) => c.content.includes('the tail'))).toBe(true);
      // a finished job cannot be reported again
      expect((await report(j2!.id, { action: 'failed' })).status).toBe(409);
    });

    it('provision done queues the wireframe once; research done queues a brief 20 minutes out; research task waits for the brief', async () => {
      const w = await world('followon');
      const t = await start(w);
      const p = await claim(['provision']);
      await report(p!.id, { action: 'done' });
      expect((await task(w.t.provision)).status).toBe('done');
      const r = await claim(['research']);
      await report(r!.id, { action: 'done' });
      expect((await task(w.t.research)).status).toBe('in_progress'); // closes with the brief and outline, not before
      const brief = await prisma.designJob.findFirstOrThrow({ where: { track_id: t.id, kind: 'brief' } });
      const wait = brief.not_before!.getTime() - Date.now();
      expect(wait).toBeGreaterThan(19 * 60_000);
      expect(wait).toBeLessThan(21 * 60_000);
      expect(await prisma.designJob.count({ where: { track_id: t.id, kind: 'wireframe' } })).toBe(1);
    });
  });

  // -----------------------------------------------------------------------------------------------------------
  describe('adopt', () => {
    it('validates the job, the branch and the base; is idempotent; and refuses jobs that do not adopt', async () => {
      const w = await world('adoptv');
      const t = await start(w);
      const prov = await claim(['provision']);
      // provision does not adopt
      expect((await adoptJob(t.id, t.slug, prov!.id)).status).toBe(409);
      await report(prov!.id, { action: 'done' });
      const wf = await claim(['wireframe']);
      asRunner();
      const bad = (body: Record<string, unknown>) => adopt.POST(json('POST', `/api/design/runner/tracks/${t.id}/adopt`, body), ctx({ id: t.id }));
      expect((await bad({ job_id: wf!.id, job_branch: 'design/t-aaaaaaaaaaaaaaaa-job-1', expected_base: SHA })).status).toBe(400); // another track's slug
      expect((await bad({ job_id: wf!.id, job_branch: `design/t-${t.slug}-job-1`, expected_base: 'abc123' })).status).toBe(400);
      expect((await bad({ job_id: wf!.id, job_branch: `design/t-${t.slug}-job-12345`, expected_base: SHA })).status).toBe(400);
      expect((await bad({ job_id: wf!.id, job_branch: `design/t-${t.slug}-job-1`, expected_base: SHA, extra: 1 })).status).toBe(400);
      expect((await bad({ job_id: '00000000-0000-4000-8000-000000000000', job_branch: `design/t-${t.slug}-job-1`, expected_base: SHA })).status).toBe(404);
      const ok = await bad({ job_id: wf!.id, job_branch: `design/t-${t.slug}-job-1`, expected_base: SHA });
      expect(ok.status).toBe(201);
      const c1 = (await ok.json()).command;
      const again = await bad({ job_id: wf!.id, job_branch: `design/t-${t.slug}-job-1`, expected_base: SHA });
      expect(again.status).toBe(200);
      expect((await again.json()).command.id).toBe(c1.id);
      expect(await prisma.designCommand.count({ where: { verb: 'adopt_branch', payload: { path: ['job_id'], equals: wf!.id } } })).toBe(1);
      expect((await prisma.designJob.findUniqueOrThrow({ where: { id: wf!.id } })).status).toBe('running');
      // a job claimed by nobody (queued) cannot adopt
      const other = await prisma.designJob.create({ data: { track_id: t.id, kind: 'module', payload: {} } });
      expect((await bad({ job_id: other.id, job_branch: `design/t-${t.slug}-job-2`, expected_base: SHA })).status).toBe(409);
    });

    it('a failed adopt (conflict) puts the job back in the queue; the second failure parks it', async () => {
      const w = await world('conflict');
      const t = await start(w);
      await prisma.designJob.updateMany({ where: { track_id: t.id, kind: { not: 'provision' } }, data: { status: 'cancelled' } });
      await report((await claim(['provision']))!.id, { action: 'done' });
      const wf1 = await claim(['wireframe']);
      const a1 = await adoptJob(t.id, t.slug, wf1!.id);
      expect((await daemon((await a1.json()).command.id, 'failed', { reason: 'conflict' })).status).toBe(200);
      const queued = await prisma.designJob.findUniqueOrThrow({ where: { id: wf1!.id } });
      expect([queued.status, queued.error]).toEqual(['queued', 'adopt_failed: conflict']);
      const wf2 = await claim(['wireframe']);
      expect(wf2!.attempts).toBe(2);
      const a2 = await adoptJob(t.id, t.slug, wf2!.id, 2);
      expect((await daemon((await a2.json()).command.id, 'failed', { reason: 'conflict' })).status).toBe(200);
      expect((await prisma.designJob.findUniqueOrThrow({ where: { id: wf1!.id } })).status).toBe('failed');
      expect((await task(w.t.wireframe)).tags).toContain('needs-mike');
      expect(await stage(t.id)).toBe('research');
    });

    it('a module adopt moves the head and closes the job but never a stage; a bad done result fails the job', async () => {
      const w = await world('module');
      const t = await toArtDirection(w);
      const out = await signDirection(t.id, { designerId: f.designer.userId, modules: [{ feature: 'commerce' }] });
      const m = await claim(['module']);
      expect(m!.task_id).toBeNull();
      const a = await adoptJob(t.id, t.slug, m!.id, 4);
      expect((await daemon((await a.json()).command.id, 'done', adoptOk([], 'e'.repeat(40)))).status).toBe(200);
      const row = await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } });
      expect([row.stage, row.head_sha, row.busy_job_id]).toEqual(['home_build', 'e'.repeat(40), out.buildJobId]);
      expect((await prisma.designJob.findUniqueOrThrow({ where: { id: m!.id } })).status).toBe('done');
      // malformed result: the command still completes, the job is requeued with bad_adopt_result, the head does not move
      const hb = await claim(['home_build']);
      const a2 = await adoptJob(t.id, t.slug, hb!.id, 5);
      expect((await daemon((await a2.json()).command.id, 'done', { head_sha: 'not hex' })).status).toBe(200);
      expect((await prisma.designJob.findUniqueOrThrow({ where: { id: hb!.id } })).error).toBe('adopt_failed: bad_adopt_result');
      expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } })).head_sha).toBe('e'.repeat(40));
      expect(await stage(t.id)).toBe('home_build');
    });

    it('an adopt result with a long page list (over 8 KB) is accepted for the track verbs, and a plain verb still caps at 8 KB', async () => {
      const w = await world('bigpages');
      const t = await toArtDirection(w);
      await signDirection(t.id, { designerId: f.designer.userId });
      const hb = await claim(['home_build']);
      const a = await adoptJob(t.id, t.slug, hb!.id, 6);
      const pages = Array.from({ length: 400 }, (_, i) => ({ path: `/page-${i}/`, title: `Page number ${i}` }));
      expect(JSON.stringify(pages).length).toBeGreaterThan(8 * 1024);
      expect((await daemon((await a.json()).command.id, 'done', adoptOk(pages))).status).toBe(200);
      expect(await stage(t.id)).toBe('refine');
      // v1 verbs keep the 8 KB cap
      const sess = await prisma.designSession.create({
        data: { task_id: w.t.refine, site_id: w.siteId, project_id: w.projectId, designer_id: f.designer.userId, status: 'awaiting_input', branch: t.branch, preview_alias: t.preview_alias, model: 'opus', effort: 'high', budget_usd: 25, track_id: t.id },
      });
      const c = await prisma.designCommand.create({ data: { session_id: sess.id, verb: 'refresh_client_files', created_by_id: f.designer.userId } });
      const big = await daemon(c.id, 'done', { blob: 'x'.repeat(9000) });
      expect(big.status).toBe(413);
    });
  });

  // -----------------------------------------------------------------------------------------------------------
  describe('track read, briefs, imports, recipients', () => {
    it('reads the track with includes and rejects an unknown include', async () => {
      const w = await world('read');
      const t = await toArtDirection(w);
      asRunner();
      const res = await track.GET(new NextRequest(`http://localhost:3000/api/design/runner/tracks/${t.id}?include=brief,references,direction,client_statements,brand_profile,pages,imports,recipients`), ctx({ id: t.id }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.track.stage).toBe('art_direction');
      expect(body.brief.status).toBe('published');
      expect(Object.keys(body).sort()).toEqual(['brand_profile', 'brief', 'client_statements', 'direction', 'imports', 'pages', 'recipients', 'references', 'track']);
      expect((await track.GET(new NextRequest(`http://localhost:3000/api/design/runner/tracks/${t.id}?include=secrets`), ctx({ id: t.id }))).status).toBe(400);
      expect((await track.GET(new NextRequest('http://localhost:3000/api/design/runner/tracks/nope'), ctx({ id: 'nope' }))).status).toBe(404);
    });

    it('a new brief supersedes the old one; an invalid brief is 400; a brief after art direction is 409', async () => {
      const w = await world('briefs');
      const t = await toArtDirection(w);
      asRunner();
      const post = (body: unknown) => briefs.POST(json('POST', `/api/design/runner/tracks/${t.id}/briefs`, { body }), ctx({ id: t.id }));
      expect((await post({ ...BRIEF, one_line: 'x'.repeat(161) })).status).toBe(400);
      expect((await post({ ...BRIEF, sections: [{ id: 'nope', title: 'x', cards: [] }] })).status).toBe(400);
      expect((await post({ ...BRIEF, extra: true })).status).toBe(400);
      expect((await post(BRIEF)).status).toBe(201);
      const all = await prisma.designBrief.findMany({ where: { track_id: t.id }, orderBy: { version: 'asc' } });
      expect(all.map((b) => [b.version, b.status])).toEqual([[1, 'superseded'], [2, 'published']]);
      expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: t.id } })).brief_id).toBe(all[1].id);
      await prisma.designTrack.update({ where: { id: t.id }, data: { stage: 'refine' } });
      expect((await post(BRIEF)).status).toBe(409);
    });

    it('registers an import from a design-import task, once; candidates list one until then', async () => {
      const w = await world('imp');
      const t = await start(w);
      const it1 = await prisma.task.create({ data: { title: `${f.tag} import`, client_id: f.clientId, project_id: w.projectId, site_id: w.siteId, tags: ['design-import', 'design-runner'] } });
      f.taskIds.push(it1.id);
      asRunner();
      const list = ((await (await candidates.GET()).json()).candidates as Array<Record<string, unknown>>).filter((c) => c.task_id === it1.id);
      expect(list.map((c) => [c.kind, c.track_id])).toEqual([['import', t.id]]);
      const body = { task_id: it1.id, template_page_path: '/shop/signature-tee/', source_paths: ['CL/x/content/imports/shop/catalog.csv'], expected_count: 18 };
      const ok = await imports.POST(json('POST', `/api/design/runner/tracks/${t.id}/imports`, body), ctx({ id: t.id }));
      expect(ok.status).toBe(201);
      expect((await imports.POST(json('POST', `/api/design/runner/tracks/${t.id}/imports`, body), ctx({ id: t.id }))).status).toBe(409);
      expect((await imports.POST(json('POST', `/api/design/runner/tracks/${t.id}/imports`, { ...body, task_id: w.t.art }), ctx({ id: t.id }))).status).toBe(404);
      const after = ((await (await candidates.GET()).json()).candidates as Array<Record<string, unknown>>).filter((c) => c.task_id === it1.id);
      expect(after).toHaveLength(0);
    });

    it('computes recipients: grants (owner, member) first; the client fallback only without grants and on the site domain', async () => {
      const w = await world('rcpt');
      const site = await prisma.site.findUniqueOrThrow({ where: { id: w.siteId } });
      const host = new URL(site.url!).hostname;
      const mk = (email: string, can: boolean, extra: Record<string, unknown> = {}) =>
        prisma.clientContact.create({ data: { client_id: f.clientId, email, name: email.split('@')[0], can_initiate_work: can, ...extra } });
      const owner = await mk(`owner@${host}`, true);
      const viewer = await mk(`viewer@${host}`, false);
      const outsider = await mk('outsider@elsewhere.test', true);
      const gone = await mk(`gone@${host}`, true, { is_deleted: true });
      // no grants: fallback contacts who can initiate work, on the site's domain only
      const fallback = await computeRecipients(w.projectId);
      expect(fallback.map((r) => [r.email, r.basis])).toEqual(expect.arrayContaining([[owner.email, 'client_fallback']]));
      expect(fallback.some((r) => r.email === outsider.email || r.email === gone.email || r.email === viewer.email)).toBe(false);
      // grants exist: only owner and member grants count, other domains with a grant included, no fallback
      await prisma.projectContact.createMany({ data: [
        { project_id: w.projectId, contact_id: viewer.id, role: 'viewer' },
        { project_id: w.projectId, contact_id: outsider.id, role: 'member' },
        { project_id: w.projectId, contact_id: gone.id, role: 'owner' },
      ] });
      const granted = await computeRecipients(w.projectId);
      expect(granted.map((r) => [r.email, r.basis])).toEqual([[outsider.email, 'grant']]);
      await prisma.projectContact.deleteMany({ where: { project_id: w.projectId } });
      await prisma.clientContact.deleteMany({ where: { id: { in: [owner.id, viewer.id, outsider.id, gone.id] } } });
    });

    it('recipients (W6.1 F9): no fallback for a site with no URL; a contact on a parent or public-suffix domain needs a grant', async () => {
      const w = await world('rcpt2');
      const mk = (email: string) => prisma.clientContact.create({ data: { client_id: f.clientId, email, name: email.split('@')[0], can_initiate_work: true } });
      const tag = f.tag.toLowerCase().replace(/[^a-z0-9]/g, '');
      const onSite = await mk(`owner@w63${tag}.co.uk`);
      const onSub = await mk(`team@mail.w63${tag}.co.uk`);
      const onSuffix = await mk(`anyone@co.uk`);
      try {
        await prisma.site.update({ where: { id: w.siteId }, data: { url: null } });
        expect(await computeRecipients(w.projectId)).toEqual([]);
        await prisma.site.update({ where: { id: w.siteId }, data: { url: `https://www.w63${tag}.co.uk./` } });
        const got = (await computeRecipients(w.projectId)).map((r) => r.email);
        expect(got).toEqual(expect.arrayContaining([onSite.email, onSub.email]));
        expect(got).not.toContain(onSuffix.email);
        // a site on a subdomain no longer accepts a contact on the parent domain without a grant
        await prisma.site.update({ where: { id: w.siteId }, data: { url: `https://shop.w63${tag}.co.uk` } });
        expect((await computeRecipients(w.projectId)).map((r) => r.email)).toEqual([]);
      } finally {
        await prisma.clientContact.deleteMany({ where: { id: { in: [onSite.id, onSub.id, onSuffix.id] } } });
      }
    });
  });
});
