// @vitest-environment node
// The designer chooses how each build starts, can start "infer the rest" at any build stage, and every design she adds in
// a build stage is built as drawn (Citadel task 0f3205bf). Real database: the stage moves, the job payloads the runner
// reads, and the stage never moving backwards.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';
import { seedWorld, teardownWorlds, type TrackWorld } from '@/lib/design/__tests__/track-world';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { DESIGN_WORKER_SERVICE_EMAIL } from '@/lib/design/helpers';
import { signDirection, addedDesignIds, builtPages } from '@/lib/design/track-stage';
import { trackTx } from '@/lib/design/track-core';
import { addDesignerReference } from '@/lib/design/track-board';
import { loadSessionTrackView } from '@/lib/design/track-session';
import * as tracks from '../tracks/route';
import * as claims from '../claims/route';
import * as job from '../jobs/[id]/route';
import * as briefs from '../tracks/[id]/briefs/route';
import * as adopt from '../tracks/[id]/adopt/route';
import * as command from '../../worker/commands/[id]/route';
import * as inferRoute from '../../sessions/[id]/infer-rest/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const SHA = 'a'.repeat(40);

const BRIEF = {
  version: 1, client: 'Test Co', one_line: 'A calm site for people who work hard.',
  sections: [{ id: 'brand', title: 'Brand', cards: [{ id: 'brand-01', headline: 'Warm and plain', summary: 'Short summary of the finding.', image_asset_ids: [], detail_md: 'Detail.', sources: [{ kind: 'file', path: 'CL/x/profile/brand.md' }], confidence: 'evidenced' }] }],
};

type Payload = { start?: string; design_reference_ids?: string[]; built_pages?: Array<{ path: string; title: string }> };

describe.skipIf(!SCRATCH)('design track: start choice, infer the rest, added designs (real database)', () => {
  let f: DesignFixture;
  let bastId: string;
  const worlds: TrackWorld[] = [];
  let RUNNER: Record<string, unknown>;
  let WORKER: Record<string, unknown>;
  const createdUsers: string[] = [];
  let jobNo = 10;

  const asRunner = () => as.mockResolvedValue(RUNNER);
  const asWorker = () => as.mockResolvedValue(WORKER);
  const asDesigner = (userId = f.designer.userId) => as.mockResolvedValue({ userId, email: 'd@example.test', role: 'designer', via: 'session' });

  async function claim(kinds?: string[]) {
    asRunner();
    const res = await claims.POST(json('POST', '/api/design/runner/claims', { runner_id: 'r1', ...(kinds ? { kinds } : {}) }));
    if (res.status === 204) return null;
    expect(res.status).toBe(200);
    return (await res.json()).job as { id: string; kind: string; task_id: string | null; payload: Payload };
  }
  async function report(jobId: string, body: Record<string, unknown>) {
    asRunner();
    return job.PATCH(json('PATCH', `/api/design/runner/jobs/${jobId}`, body), ctx({ id: jobId }));
  }
  /** Adopt a claimed build job and have the daemon complete it with these pages. */
  async function adoptDone(
    t: { id: string; slug: string }, jobId: string, pages: Array<{ path: string; title?: string }>,
    jobPages?: Array<{ path: string; title?: string | null }>, outlinePages?: string[],
  ) {
    asRunner();
    const body = {
      job_id: jobId, job_branch: `design/t-${t.slug}-job-${jobNo++}`, expected_base: SHA,
      ...(jobPages ? { pages: jobPages } : {}), ...(outlinePages ? { outline_pages: outlinePages } : {}),
    };
    const a = await adopt.POST(json('POST', `/api/design/runner/tracks/${t.id}/adopt`, body), ctx({ id: t.id }));
    expect(a.status).toBe(201);
    const cmdId = (await a.json()).command.id;
    asWorker();
    expect((await command.PATCH(json('PATCH', `/api/design/worker/commands/${cmdId}`, { action: 'claim' }), ctx({ id: cmdId }))).status).toBe(200);
    const head = 'c'.repeat(40);
    const res = await command.PATCH(json('PATCH', `/api/design/worker/commands/${cmdId}`, {
      action: 'complete', status: 'done', result: { head_sha: head, preview_url: 'https://design-t-x.example.pages.dev', preview_sha: head, pages },
    }), ctx({ id: cmdId }));
    expect(res.status).toBe(200);
  }
  const row = (id: string) => prisma.designTrack.findUniqueOrThrow({ where: { id } });
  const task = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const jobRow = (id: string) => prisma.designJob.findUniqueOrThrow({ where: { id } });

  /** A world whose track is in home_build with the home build queued, and a live tracked session. */
  async function toHomeBuild(label: string, buildPayload: Record<string, unknown> = { art_direction_id: 'x', start: 'inspiration' }) {
    const w = await seedWorld(f, label);
    worlds.push(w);
    asRunner();
    const res = await tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.provision }));
    expect(res.status).toBe(201);
    const t = (await res.json()).track as { id: string; slug: string; branch: string; preview_alias: string };
    await report((await claim(['provision']))!.id, { action: 'done' });
    await report((await claim(['research']))!.id, { action: 'done' });
    const wf = await claim(['wireframe']);
    await adoptDone(t, wf!.id, [{ path: '/', title: 'Home' }]);
    asRunner();
    expect((await briefs.POST(json('POST', `/api/design/runner/tracks/${t.id}/briefs`, { body: BRIEF }), ctx({ id: t.id }))).status).toBe(201);
    await signDirection(t.id, { designerId: f.designer.userId, clientEmailPayload: { art_direction_id: 'x' }, buildPayload });
    expect((await row(t.id)).stage).toBe('home_build');
    const sess = await prisma.designSession.create({
      data: {
        task_id: w.t.refine, site_id: w.siteId, project_id: w.projectId, designer_id: f.designer.userId, status: 'awaiting_input',
        branch: t.branch, preview_alias: t.preview_alias, model: 'opus', effort: 'high', budget_usd: 25, track_id: t.id,
      },
    });
    return { w, t, sess };
  }
  /** A world whose track is in refine (home built at /), with a live tracked session. */
  async function toRefine(label: string, buildPayload: Record<string, unknown> = { art_direction_id: 'x', start: 'inspiration' }) {
    const out = await toHomeBuild(label, buildPayload);
    const hb = await claim(['home_build']);
    await adoptDone(out.t, hb!.id, [{ path: '/', title: 'Home' }]);
    expect((await row(out.t.id)).stage).toBe('refine');
    return out;
  }
  const infer = async (sessionId: string) => {
    asDesigner();
    return inferRoute.POST(json('POST', `/api/design/sessions/${sessionId}/infer-rest`, {}), ctx({ id: sessionId }));
  };
  const figma = (n: number) => `https://www.figma.com/design/ABCDEFGHIJ${1000 + n}/Site?node-id=1-${n}`;

  beforeAll(async () => {
    f = await seedDesign(`sc${Date.now()}`);
    const bast = await prisma.user.create({ data: { email: `bast-${f.tag}@example.test`, password_hash: 'x', name: 'Bast test', role: 'pm' } });
    createdUsers.push(bast.id);
    bastId = bast.id;
    const wk = (await prisma.user.findUnique({ where: { email: DESIGN_WORKER_SERVICE_EMAIL } }))
      ?? (await prisma.user.create({ data: { email: DESIGN_WORKER_SERVICE_EMAIL, password_hash: 'x', name: 'worker', role: 'tech' } }));
    RUNNER = { userId: bastId, email: bast.email, role: 'pm', via: 'api_key', apiKeyId: 'k-run', lane: 'design-track', laneEnforced: true };
    WORKER = { userId: wk.id, email: DESIGN_WORKER_SERVICE_EMAIL, role: 'tech', via: 'api_key', apiKeyId: 'k-wrk', lane: 'design-worker', laneEnforced: true };
    await prisma.designJob.updateMany({ where: { status: 'queued' }, data: { status: 'cancelled' } });
  });
  afterAll(async () => {
    await teardownWorlds(f, worlds);
    await prisma.designCommand.deleteMany({ where: { created_by_id: bastId } });
    await teardownDesign(f);
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    as.mockReset();
    await prisma.designJob.updateMany({ where: { status: 'queued' }, data: { status: 'cancelled' } });
  });

  it('the home build payload carries the start the designer chose', async () => {
    const { t } = await toRefine('start', { art_direction_id: 'x', start: 'own_design', design_reference_ids: [] });
    const home = await prisma.designJob.findFirstOrThrow({ where: { track_id: t.id, kind: 'home_build' } });
    expect((home.payload as Payload).start).toBe('own_design');
  });

  it('infer the rest: in refine it moves to rest_build; in review it stays and the new pages join the review', async () => {
    const { w, t, sess } = await toRefine('infer');
    const res = await infer(sess.id);
    expect(res.status).toBe(202);
    const out = await res.json();
    expect(out.stage).toBe('rest_build');
    const after = await row(t.id);
    expect([after.stage, after.busy_job_id]).toEqual(['rest_build', out.job_id]);
    const j = await jobRow(out.job_id);
    expect([j.kind, j.task_id]).toEqual(['rest_build', w.t.rest]);
    expect(j.payload).toEqual({ start: 'infer_rest', built_pages: [{ path: '/', title: 'Home' }], design_reference_ids: [] });
    const refine = await task(w.t.refine);
    expect([refine.status, refine.approved_by_id]).toEqual(['done', f.designer.userId]);
    expect((await loadSessionTrackView({ track_id: t.id }))?.busy_line).toBe('Bast is building the pages nobody has drawn yet');

    const rb = await claim(['rest_build']);
    expect(rb!.payload.start).toBe('infer_rest');
    await adoptDone(t, rb!.id, [{ path: '/about/', title: 'About' }]);
    expect((await row(t.id)).stage).toBe('review');
    expect((await prisma.designPageReview.findMany({ where: { track_id: t.id } })).map((p) => p.page_path)).toEqual(['/about/']);

    // review: infer again, the stage stays, the job runs beside the stage (no recipe task), built pages are named
    const r2 = await infer(sess.id);
    expect(r2.status).toBe(202);
    const o2 = await r2.json();
    expect([o2.stage, o2.after_build]).toEqual(['review', false]);
    const j2 = await jobRow(o2.job_id);
    expect(j2.task_id).toBeNull();
    expect((j2.payload as Payload).built_pages).toEqual([{ path: '/', title: 'Home' }, { path: '/about/', title: 'About' }]);
    const rb2 = await claim(['rest_build']);
    await adoptDone(t, rb2!.id, [{ path: '/faq/', title: 'FAQ' }]);
    const final = await row(t.id);
    expect([final.stage, final.busy_job_id]).toEqual(['review', null]);
    expect((await prisma.designPageReview.findMany({ where: { track_id: t.id }, orderBy: { created_at: 'asc' } })).map((p) => p.page_path)).toEqual(['/about/', '/faq/']);
    expect(((await task(w.t.review)).requirements as Array<{ text: string }>).map((r) => r.text)).toEqual(['Review About (/about/)', 'Review FAQ (/faq/)']);
  });

  it('infer the rest is refused before the build starts', async () => {
    const w = await seedWorld(f, 'early');
    worlds.push(w);
    asRunner();
    const t = (await (await tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.provision }))).json()).track as { id: string; branch: string; preview_alias: string };
    const sess = await prisma.designSession.create({
      data: {
        task_id: w.t.art, site_id: w.siteId, project_id: w.projectId, designer_id: f.designer.userId, status: 'awaiting_input',
        branch: t.branch, preview_alias: t.preview_alias, model: 'opus', effort: 'high', budget_usd: 25, track_id: t.id,
      },
    });
    const res = await infer(sess.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('illegal_transition');
    expect((await row(t.id)).stage).toBe('research');
  });

  it('a design added in a build stage is built as drawn; one added while a build runs is queued by the adopt that ends it', async () => {
    const { t, sess } = await toRefine('added');
    // a design on the board before the build started is the home build's starting set, never queued again
    expect(await trackTx(({ tx }) => addedDesignIds(tx, t.id))).toEqual([]);

    asDesigner();
    const r1 = await addDesignerReference(t.id, sess.id, { url: figma(1), expect: 'figma' });
    const s1 = await row(t.id);
    expect(s1.stage).toBe('refine'); // the stage never moves
    expect(s1.busy_job_id).not.toBeNull();
    const j1 = await jobRow(s1.busy_job_id!);
    expect([j1.kind, j1.task_id]).toEqual(['rest_build', null]); // beside the stage: the rest build's recipe task stays open
    expect(j1.payload).toEqual({ start: 'own_design', design_reference_ids: [r1.id], built_pages: [{ path: '/', title: 'Home' }] });
    expect((await loadSessionTrackView({ track_id: t.id }))?.busy_line).toBe('Bast is building your new designs');
    const lines = await prisma.designEvent.findMany({ where: { session_id: sess.id, kind: 'track_stage' } });
    expect(lines.some((l) => (l.payload as { line?: string }).line === 'Bast is building your new designs')).toBe(true);

    // the build waits while her Figma frame is still being read
    expect(await claim(['rest_build'])).toBeNull();
    await prisma.designReference.update({ where: { id: r1.id }, data: { capture_status: 'captured' } });
    await prisma.designJob.updateMany({ where: { track_id: t.id, kind: 'capture', status: 'queued' }, data: { status: 'cancelled' } });
    const c1 = await claim(['rest_build']);
    expect(c1!.id).toBe(j1.id);

    // added while that build runs: nothing new queued now
    const r2 = await addDesignerReference(t.id, sess.id, { url: figma(2), expect: 'figma' });
    expect(await prisma.designJob.count({ where: { track_id: t.id, kind: 'rest_build' } })).toBe(1);

    // the adopt ends the build: the stage stays refine, and the design added meanwhile is queued next
    await adoptDone(t, c1!.id, [{ path: '/services/', title: 'Services' }]);
    const s2 = await row(t.id);
    expect(s2.stage).toBe('refine');
    expect(s2.busy_job_id).not.toBeNull();
    const j2 = await jobRow(s2.busy_job_id!);
    expect((j2.payload as Payload).start).toBe('own_design');
    expect((j2.payload as Payload).design_reference_ids).toEqual([r2.id]);
    expect((j2.payload as Payload).built_pages).toEqual([{ path: '/', title: 'Home' }, { path: '/services/', title: 'Services' }]);
    expect(await trackTx(({ tx }) => builtPages(tx, t.id))).toEqual([{ path: '/', title: 'Home' }, { path: '/services/', title: 'Services' }]);
  });

  it('a design added before the build starts queues no build', async () => {
    const w = await seedWorld(f, 'prebuild');
    worlds.push(w);
    asRunner();
    const t = (await (await tracks.POST(json('POST', '/api/design/runner/tracks', { task_id: w.t.provision }))).json()).track as { id: string; branch: string; preview_alias: string };
    const sess = await prisma.designSession.create({
      data: {
        task_id: w.t.art, site_id: w.siteId, project_id: w.projectId, designer_id: f.designer.userId, status: 'awaiting_input',
        branch: t.branch, preview_alias: t.preview_alias, model: 'opus', effort: 'high', budget_usd: 25, track_id: t.id,
      },
    });
    asDesigner();
    await addDesignerReference(t.id, sess.id, { url: figma(3), expect: 'figma' });
    expect(await prisma.designJob.count({ where: { track_id: t.id, kind: { in: ['home_build', 'rest_build'] } } })).toBe(0);
    expect((await row(t.id)).busy_job_id).toBeNull();
  });

  it('infer the rest tapped during the home build is held, then queued beside refine when the home build ends', async () => {
    const { w, t, sess } = await toHomeBuild('held');
    const res = await infer(sess.id);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ stage: 'home_build', busy: true, job_id: null, after_build: true });
    expect((await row(t.id)).infer_requested_at).not.toBeNull();
    expect((await loadSessionTrackView({ track_id: t.id }))?.infer_requested).toBe(true);
    // a second tap while held changes nothing
    expect((await (await infer(sess.id)).json()).after_build).toBe(true);
    expect(await prisma.designJob.count({ where: { track_id: t.id, kind: 'rest_build' } })).toBe(0);

    const hb = await claim(['home_build']);
    await adoptDone(t, hb!.id, [{ path: '/', title: 'Home' }]);
    const after = await row(t.id);
    expect([after.stage, after.infer_requested_at]).toEqual(['refine', null]); // the home build's own move; never past refine
    const j = await jobRow(after.busy_job_id!);
    expect([j.kind, j.task_id]).toEqual(['rest_build', null]);
    expect(j.payload).toEqual({ start: 'infer_rest', built_pages: [{ path: '/', title: 'Home' }], design_reference_ids: [] });
    expect((await task(w.t.refine)).status).not.toBe('done'); // her refine task is hers to finish
    expect((await loadSessionTrackView({ track_id: t.id }))?.busy_line).toBe('Bast is building the pages nobody has drawn yet');

    // the inferred pages are reviewed once the track reaches review
    const rb = await claim(['rest_build']);
    await adoptDone(t, rb!.id, [{ path: '/about/', title: 'About' }]);
    expect((await row(t.id)).stage).toBe('refine');
    expect(await trackTx(({ tx }) => builtPages(tx, t.id))).toEqual([{ path: '/', title: 'Home' }, { path: '/about/', title: 'About' }]);
  });

  it('a held infer the rest is dropped when the running build fails for good', async () => {
    const { t, sess } = await toHomeBuild('heldfail');
    expect((await (await infer(sess.id)).json()).after_build).toBe(true);
    const hb = await claim(['home_build']);
    await prisma.designJob.update({ where: { id: hb!.id }, data: { attempts: 99 } });
    expect((await report(hb!.id, { action: 'failed', error: 'boom' })).status).toBe(200);
    const after = await row(t.id);
    expect([after.busy_job_id, after.infer_requested_at]).toEqual([null, null]);
    expect(await prisma.designJob.count({ where: { track_id: t.id, kind: 'rest_build' } })).toBe(0);
  });

  it('two designs added before the first added-designs build is claimed are both built by it', async () => {
    const { t, sess } = await toRefine('twoadds');
    asDesigner();
    const r1 = await addDesignerReference(t.id, sess.id, { url: figma(11), expect: 'figma' });
    const j1 = (await row(t.id)).busy_job_id!;
    const r2 = await addDesignerReference(t.id, sess.id, { url: figma(12), expect: 'figma' });
    expect(await prisma.designJob.count({ where: { track_id: t.id, kind: 'rest_build' } })).toBe(1);
    await prisma.designReference.updateMany({ where: { id: { in: [r1.id, r2.id] } }, data: { capture_status: 'captured' } });
    await prisma.designJob.updateMany({ where: { track_id: t.id, kind: 'capture', status: 'queued' }, data: { status: 'cancelled' } });
    const c1 = await claim(['rest_build']);
    expect(c1!.id).toBe(j1);
    expect(c1!.payload.design_reference_ids).toEqual([r1.id, r2.id]);
    expect(((await jobRow(j1)).payload as Payload).design_reference_ids).toEqual([r1.id, r2.id]);
    await adoptDone(t, c1!.id, [{ path: '/a/', title: 'A' }, { path: '/b/', title: 'B' }]);
    const after = await row(t.id);
    expect([after.stage, after.busy_job_id]).toEqual(['refine', null]); // nothing left on the board unbuilt
    expect(await trackTx(({ tx }) => addedDesignIds(tx, t.id))).toEqual([]);
  });

  it('a build stores only the pages it made: outline pages and the components page stay out of built_pages and the reviews', async () => {
    const { w, t, sess } = await toHomeBuild('madepages');
    // the preview serves the outline pages and the components page beside the home page the build made
    const preview = [
      { path: '/', title: 'Home' }, { path: '/about/', title: 'About (outline)' }, { path: '/contact/', title: 'Contact (outline)' },
      { path: '/design/components/', title: 'Components' },
    ];
    const hb = await claim(['home_build']);
    await adoptDone(t, hb!.id, preview, [{ path: '/', title: 'Home' }]);
    const home = await jobRow(hb!.id);
    expect((home.result as { pages: unknown }).pages).toEqual([{ path: '/', title: 'Home' }]);
    expect((home.result as { preview_pages: unknown }).preview_pages).toEqual(preview);
    expect(await trackTx(({ tx }) => builtPages(tx, t.id))).toEqual([{ path: '/', title: 'Home' }]);

    // infer the rest builds /about/ only; /contact/ stays an outline. A page the preview does not serve is not stored,
    // a duplicate counts once, and a page with no title takes the preview's.
    expect((await infer(sess.id)).status).toBe(202);
    const rb = await claim(['rest_build']);
    expect(rb!.payload.built_pages).toEqual([{ path: '/', title: 'Home' }]);
    await adoptDone(t, rb!.id, [...preview.slice(0, 1), { path: '/about/', title: 'About' }, ...preview.slice(2)],
      [{ path: '/about/', title: null }, { path: '/about/', title: 'Again' }, { path: '/gone/', title: 'Gone' }]);
    expect((await row(t.id)).stage).toBe('review');
    expect(((await jobRow(rb!.id)).result as { pages: unknown }).pages).toEqual([{ path: '/about/', title: 'About' }]);
    expect((await prisma.designPageReview.findMany({ where: { track_id: t.id } })).map((p) => p.page_path)).toEqual(['/about/']);
    expect(((await task(w.t.review)).requirements as Array<{ text: string }>).map((r) => r.text)).toEqual(['Review About (/about/)']);
    expect(await trackTx(({ tx }) => builtPages(tx, t.id))).toEqual([{ path: '/', title: 'Home' }, { path: '/about/', title: 'About' }]);
  });

  it('outline pages an older build stored as built stay out of built_pages and the reviews once a build names them', async () => {
    const { w, t, sess } = await toHomeBuild('oldlist');
    // a home build adopted before the runner sent its page list: every page of the preview was stored
    const preview = [{ path: '/', title: 'Home' }, { path: '/about/', title: 'About (outline)' }, { path: '/contact/', title: 'Contact (outline)' }];
    const hb = await claim(['home_build']);
    await adoptDone(t, hb!.id, preview);
    expect(await trackTx(({ tx }) => builtPages(tx, t.id))).toEqual(preview);

    // infer the rest builds /about/ and leaves /contact/ an outline (a drawn page)
    expect((await infer(sess.id)).status).toBe(202);
    const rb = await claim(['rest_build']);
    await adoptDone(t, rb!.id, [preview[0], { path: '/about/', title: 'About' }, preview[2]], [{ path: '/about/', title: 'About' }], ['/contact/']);
    expect((await row(t.id)).stage).toBe('review');
    expect(((await jobRow(rb!.id)).result as { outline_pages: unknown }).outline_pages).toEqual(['/contact/']);
    expect((await prisma.designPageReview.findMany({ where: { track_id: t.id } })).map((p) => p.page_path)).toEqual(['/about/']);
    expect(((await task(w.t.review)).requirements as Array<{ text: string }>).map((r) => r.text)).toEqual(['Review About (/about/)']);
    expect((await trackTx(({ tx }) => builtPages(tx, t.id))).map((p) => p.path)).toEqual(['/', '/about/']);
  });

  it('the adopt route refuses a malformed page list', async () => {
    const { t } = await toHomeBuild('badpages');
    const hb = await claim(['home_build']);
    asRunner();
    const post = (pages: unknown) => adopt.POST(json('POST', `/api/design/runner/tracks/${t.id}/adopt`, {
      job_id: hb!.id, job_branch: `design/t-${t.slug}-job-${jobNo++}`, expected_base: SHA, pages,
    }), ctx({ id: t.id }));
    for (const bad of [[{ path: 'about' }], [{ path: '/', extra: 1 }], 'x', [{ path: '/', title: 'x'.repeat(201) }]]) {
      expect((await post(bad)).status).toBe(400);
    }
    const postOutlines = (outline_pages: unknown) => adopt.POST(json('POST', `/api/design/runner/tracks/${t.id}/adopt`, {
      job_id: hb!.id, job_branch: `design/t-${t.slug}-job-${jobNo++}`, expected_base: SHA, outline_pages,
    }), ctx({ id: t.id }));
    for (const bad of [['about'], [3], 'x']) expect((await postOutlines(bad)).status).toBe(400);
    expect(await prisma.designCommand.count({ where: { verb: 'adopt_branch', payload: { path: ['job_id'], equals: hb!.id } } })).toBe(0);
  });
});
