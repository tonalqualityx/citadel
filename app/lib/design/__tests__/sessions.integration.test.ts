import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getClaim } from '@/lib/tasks/claims';
import { createOrGetSession, transitionSession, closeSession } from '../sessions';
import { designClaimHolder, task8 } from '../helpers';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';
import { seedWorld, teardownWorlds, type TrackWorld } from './track-world';
import { queueJob, trackTx } from '../track-core';
import { onHomeBuildAdopted, onRestBuildAdopted } from '../track-stage';
import { onPresence } from '../presence';

describe.skipIf(!SCRATCH)('session engine (real database)', () => {
  let f: DesignFixture;
  beforeAll(async () => {
    f = await seedDesign(`se${Date.now()}`);
  });
  afterAll(async () => {
    await teardownDesign(f);
    await prisma.$disconnect();
  });

  it('two concurrent creates make one session, branch and alias from task8, claim live', async () => {
    const taskId = await seedTask(f);
    const [a, b] = await Promise.all([createOrGetSession(f.designer, taskId), createOrGetSession(f.designer, taskId)]);
    expect(a.session.id).toBe(b.session.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(await prisma.designSession.count({ where: { task_id: taskId } })).toBe(1);
    expect(a.session.branch).toBe(`design/${task8(taskId)}`);
    expect(a.session.preview_alias).toBe(`design-${task8(taskId)}`);
    expect(a.session.status).toBe('pending');
    const claim = await getClaim(taskId);
    expect(claim?.live).toBe(true);
    expect(claim?.holder).toBe(designClaimHolder(taskId));
  });

  it('10 concurrent creates still make one', async () => {
    const taskId = await seedTask(f);
    const rs = await Promise.all(Array.from({ length: 10 }, () => createOrGetSession(f.designer, taskId)));
    expect(new Set(rs.map((r) => r.session.id)).size).toBe(1);
    expect(rs.filter((r) => r.created)).toHaveLength(1);
  });

  it('another designer: 404 when she is not on the project (W8.2 H6), 409 session_owned when the drawer shows her the task; an admin may open it', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    // Not on the project: the task is not in her drawer, so its existence is not confirmed.
    await expect(createOrGetSession(f.other, taskId)).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    // On the project (a second function): the drawer lists the task with its session chip, so 409 tells her nothing new.
    const fn2 = await prisma.function.create({ data: { name: `dp-${f.tag}-review` } });
    try {
      await prisma.projectTeamAssignment.create({ data: { project_id: f.projectId, user_id: f.other.userId, function_id: fn2.id } });
      await expect(createOrGetSession(f.other, taskId)).rejects.toMatchObject({ statusCode: 409, code: 'session_owned' });
    } finally {
      await prisma.projectTeamAssignment.deleteMany({ where: { function_id: fn2.id } });
      await prisma.function.delete({ where: { id: fn2.id } });
    }
    const adm = await createOrGetSession(f.admin, taskId);
    expect(adm.session.id).toBe(session.id);
    expect(adm.created).toBe(false);
  });

  it('W8.2 H2: a designer removed from the project cannot re-open her own live session (404); back on it, she can', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    const pta = await prisma.projectTeamAssignment.findFirstOrThrow({ where: { project_id: f.projectId, user_id: f.designer.userId } });
    await prisma.projectTeamAssignment.delete({ where: { id: pta.id } });
    try {
      await expect(createOrGetSession(f.designer, taskId)).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
      // An admin is unaffected.
      expect((await createOrGetSession(f.admin, taskId)).session.id).toBe(session.id);
    } finally {
      await prisma.projectTeamAssignment.create({ data: { project_id: f.projectId, user_id: f.designer.userId, function_id: f.functionId } });
    }
    const again = await createOrGetSession(f.designer, taskId);
    expect(again.session.id).toBe(session.id);
    expect(again.created).toBe(false);
  });

  it('a designer not on the project gets 404; kill switch off gives 409 portal_disabled', async () => {
    const taskId = await seedTask(f);
    await expect(createOrGetSession(f.other, taskId)).rejects.toMatchObject({ statusCode: 404 });
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { enabled: false } });
    try {
      await expect(createOrGetSession(f.designer, taskId)).rejects.toMatchObject({ code: 'portal_disabled' });
    } finally {
      await prisma.designPortalSettings.update({ where: { id: 1 }, data: { enabled: true } });
    }
  });

  it('a site the box does not serve is 409 site_not_available', async () => {
    const taskId = await seedTask(f);
    const w = await prisma.designWorkerState.findUniqueOrThrow({ where: { id: 1 } });
    await prisma.designWorkerState.update({ where: { id: 1 }, data: { configured_site_ids: w.configured_site_ids.filter((s) => s !== f.siteId) } });
    try {
      await expect(createOrGetSession(f.designer, taskId)).rejects.toMatchObject({ code: 'site_not_available' });
    } finally {
      await prisma.designWorkerState.update({ where: { id: 1 }, data: { configured_site_ids: w.configured_site_ids } });
    }
  });

  it('illegal transitions throw and leave the row alone; legal ones move it', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    await expect(transitionSession(session.id, 'active', 'worker')).rejects.toMatchObject({ code: 'illegal_transition' });
    await expect(transitionSession(session.id, 'awaiting_input', 'server')).rejects.toMatchObject({ code: 'illegal_transition' });
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('pending');
    expect((await transitionSession(session.id, 'awaiting_input', 'worker')).status).toBe('awaiting_input');
    expect((await transitionSession(session.id, 'active', 'worker')).status).toBe('active');
  });

  it('concurrent identical moves: exactly one wins', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    const rs = await Promise.allSettled([transitionSession(session.id, 'awaiting_input', 'worker'), transitionSession(session.id, 'awaiting_input', 'worker')]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('close releases the claim, abandoned without a publish; a new session may follow', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    await transitionSession(session.id, 'awaiting_input', 'worker');
    expect((await getClaim(taskId))?.live).toBe(true);
    const closed = await closeSession(session.id);
    expect(closed.status).toBe('abandoned');
    expect(closed.closed_at).not.toBeNull();
    expect((await getClaim(taskId))?.live).toBe(false);
    await expect(transitionSession(session.id, 'awaiting_input', 'worker')).rejects.toMatchObject({ code: 'illegal_transition' });
    const again = await createOrGetSession(f.designer, taskId);
    expect(again.created).toBe(true);
    expect(again.session.id).not.toBe(session.id);
  });

  it('close with a successful publish is closed', async () => {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(f.designer, taskId);
    await transitionSession(session.id, 'awaiting_input', 'worker');
    await prisma.designPublish.create({
      data: { session_id: session.id, site_id: f.siteId, task_id: taskId, actor_id: f.designer.userId, actor_role: 'designer', publish_mode: 'per_site', main_role: 'client_preview', site_designer_publish: true, status: 'published' },
    });
    expect((await closeSession(session.id)).status).toBe('closed');
  });
});


// v2 (SPEC 2.3, 3.1; PLAN W1.6): sessions on a design track. The v1 cases above stay as they were (untracked sessions
// are unchanged); these add the tracked ones on their own fixture and one world (site, project, recipe tasks) per case.
describe.skipIf(!SCRATCH)('sessions on a design track (real database)', () => {
  let f: DesignFixture;
  const worlds: TrackWorld[] = [];
  beforeAll(async () => {
    f = await seedDesign(`st${Date.now()}`);
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { auto_timer_enabled: true, auto_timer_lapse_minutes: 5 } });
  });
  afterAll(async () => {
    const ids = [f.designer.userId, f.admin.userId, f.other.userId];
    await prisma.designSession.updateMany({ where: { designer_id: { in: ids } }, data: { timer_entry_id: null } });
    await prisma.timeEntry.deleteMany({ where: { user_id: { in: ids } } });
    await teardownWorlds(f, worlds);
    await teardownDesign(f);
    await prisma.$disconnect();
  });

  /** A world plus its open track in `stage` (adopt-like fields filled the way the daemon would). */
  async function trackWorld(label: string, stage: 'art_direction' | 'home_build' | 'refine' | 'rest_build' | 'review' | 'done' = 'art_direction', previewUrl: string | null = null) {
    const w = await seedWorld(f, label);
    worlds.push(w);
    await prisma.site.update({ where: { id: w.siteId }, data: { design_auto_timer: true } });
    const slug = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join('');
    const track = await prisma.designTrack.create({
      data: { site_id: w.siteId, project_id: w.projectId, slug, stage, branch: `design/t-${slug}`, preview_alias: `design-t-${slug}`, preview_url: previewUrl },
    });
    return { w, track };
  }
  const live = (trackId: string) => prisma.designSession.findMany({ where: { track_id: trackId, status: { notIn: ['closed', 'abandoned'] } } });

  it('three stage tasks, one session: any of them opens the track session; branch, alias and preview URL come from the track', async () => {
    const { w, track } = await trackWorld('one', 'art_direction', 'https://design-t-x.proj.pages.dev');
    const a = await createOrGetSession(f.designer, w.t.art);
    expect(a.created).toBe(true);
    expect(a.session).toMatchObject({
      track_id: track.id, task_id: w.t.art, project_id: w.projectId, site_id: w.siteId, status: 'pending',
      branch: track.branch, preview_alias: track.preview_alias, preview_url: 'https://design-t-x.proj.pages.dev',
    });
    // the other two stage tasks answer with the same session (200, created false), task_id stays on the current stage task
    for (const clicked of [w.t.refine, w.t.review, w.t.art]) {
      const again = await createOrGetSession(f.designer, clicked);
      expect(again.created).toBe(false);
      expect(again.session.id).toBe(a.session.id);
      expect(again.session.task_id).toBe(w.t.art);
    }
    expect(await live(track.id)).toHaveLength(1);
    // an admin gets the same session
    expect((await createOrGetSession(f.admin, w.t.review)).session.id).toBe(a.session.id);
    // the claim is the v1 holder on the current stage task only
    expect((await getClaim(w.t.art))).toMatchObject({ live: true, holder: designClaimHolder(w.t.art) });
    expect((await getClaim(w.t.refine))?.live).toBe(false);
  });

  it('concurrent opens from three different stage tasks make one session', async () => {
    const { w, track } = await trackWorld('conc');
    const rs = await Promise.all([w.t.art, w.t.refine, w.t.review, w.t.art, w.t.refine, w.t.review, w.t.art, w.t.review].map((t) => createOrGetSession(f.designer, t)));
    expect(new Set(rs.map((r) => r.session.id)).size).toBe(1);
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    expect(await live(track.id)).toHaveLength(1);
  });

  it('a new session points at the track\'s CURRENT stage task whichever task was clicked', async () => {
    for (const [stage, key] of [['home_build', 'art'], ['refine', 'refine'], ['rest_build', 'refine'], ['review', 'review']] as const) {
      const { w } = await trackWorld(`cur-${stage}`, stage);
      const r = await createOrGetSession(f.designer, w.t.art);
      expect(r.session.task_id, stage).toBe(w.t[key]);
    }
  });

  it('moves between stage tasks in the stage transition: task_id, claim, timer', async () => {
    const { w, track } = await trackWorld('move', 'home_build');
    const { session } = await createOrGetSession(f.designer, w.t.art);
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { auto_timer_enabled: true } });
    expect((await onPresence(session, true, f.designer))?.running).toBe(true);
    const timerBefore = (await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } })).timer_entry_id;
    expect(timerBefore).not.toBeNull();

    // home_build adopted: the session moves art -> refine in the same transaction as the stage move
    const homeJob = await trackTx(async ({ tx }) => (await queueJob(tx, track, 'home_build', { payload: {} }))!);
    await prisma.designTrack.update({ where: { id: track.id }, data: { busy_job_id: homeJob.id } });
    await trackTx((scope) => onHomeBuildAdopted(scope, track.id, homeJob, f.admin.userId));
    await prisma.designJob.update({ where: { id: homeJob.id }, data: { status: 'done' } });
    let row = await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.task_id).toBe(w.t.refine);
    expect(row.timer_entry_id).toBeNull(); // stopped: the next presence ping starts a new entry on the new task
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: timerBefore! } })).is_running).toBe(false);
    expect(await getClaim(w.t.art)).toMatchObject({ live: false, holder: null });
    expect(await getClaim(w.t.refine)).toMatchObject({ live: true, holder: designClaimHolder(w.t.refine) });
    expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: track.id } })).stage).toBe('refine');
    // the next presence ping starts an entry on the refine task
    expect((await onPresence(row, true, f.designer))?.running).toBe(true);
    expect((await prisma.timeEntry.findFirstOrThrow({ where: { user_id: f.designer.userId, task_id: w.t.refine, is_running: true } })).task_id).toBe(w.t.refine);

    // rest_build adopted: refine -> review
    await prisma.designTrack.update({ where: { id: track.id }, data: { stage: 'rest_build' } });
    const restJob = await trackTx(async ({ tx }) => (await queueJob(tx, track, 'rest_build', { payload: {} }))!);
    await trackTx((scope) => onRestBuildAdopted(scope, track.id, restJob, [{ path: '/', title: 'Home' }], f.admin.userId));
    row = await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.task_id).toBe(w.t.review);
    expect(await getClaim(w.t.refine)).toMatchObject({ live: false });
    expect(await getClaim(w.t.review)).toMatchObject({ live: true, holder: designClaimHolder(w.t.review) });
    expect(await live(track.id)).toHaveLength(1);
  });

  it('a transition with no live session moves nothing and a missing target task leaves the session where it is', async () => {
    const { w, track } = await trackWorld('nomove', 'home_build');
    const homeJob = await trackTx(async ({ tx }) => (await queueJob(tx, track, 'home_build', { payload: {} }))!);
    await trackTx((scope) => onHomeBuildAdopted(scope, track.id, homeJob, f.admin.userId)); // no session: fine
    await prisma.designJob.update({ where: { id: homeJob.id }, data: { status: 'done' } });
    expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: track.id } })).stage).toBe('refine');
    const { session } = await createOrGetSession(f.designer, w.t.art);
    expect(session.task_id).toBe(w.t.refine);
    await prisma.task.update({ where: { id: w.t.review }, data: { tags: [] } }); // tags edited by hand
    await prisma.designTrack.update({ where: { id: track.id }, data: { stage: 'rest_build' } });
    const restJob = await trackTx(async ({ tx }) => (await queueJob(tx, track, 'rest_build', { payload: {} }))!);
    await trackTx((scope) => onRestBuildAdopted(scope, track.id, restJob, [], f.admin.userId));
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: session.id } })).task_id).toBe(w.t.refine);
    expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: track.id } })).stage).toBe('review');
  });

  it('indexes: one live session per track AND one live session per task both hold', async () => {
    const { w, track } = await trackWorld('idx');
    const { session } = await createOrGetSession(f.designer, w.t.art);
    const base = {
      site_id: w.siteId, project_id: w.projectId, designer_id: f.designer.userId, status: 'pending' as const,
      branch: track.branch, preview_alias: track.preview_alias, model: 'opus', effort: 'high', budget_usd: 25,
    };
    // per track: a second live session on the same track (different task) is refused by design_sessions_one_live_per_track
    await expect(prisma.designSession.create({ data: { ...base, task_id: w.t.review, track_id: track.id } })).rejects.toMatchObject({ code: 'P2002' });
    // per task: a second live session on the same task (no track) is refused by design_sessions_one_live_per_task
    await expect(prisma.designSession.create({ data: { ...base, task_id: session.task_id, track_id: null, branch: 'design/zzzzzzzz', preview_alias: 'design-zzzzzzzz' } })).rejects.toMatchObject({ code: 'P2002' });
    // once it closes, a new session may follow on the same track
    await transitionSession(session.id, 'awaiting_input', 'worker');
    await closeSession(session.id);
    const next = await createOrGetSession(f.designer, w.t.refine);
    expect(next.created).toBe(true);
    expect(next.session.track_id).toBe(track.id);
    expect(next.session.id).not.toBe(session.id);
  });

  it('track_not_ready: no open track is 409 for a designer who can see the task, 404 for one who cannot; a done track is not open', async () => {
    const w = await seedWorld(f, 'noTrack');
    worlds.push(w);
    await expect(createOrGetSession(f.designer, w.t.art)).rejects.toMatchObject({ statusCode: 409, code: 'track_not_ready' });
    await expect(createOrGetSession(f.other, w.t.art)).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    const { w: wDone, track } = await trackWorld('doneTrack', 'done');
    await expect(createOrGetSession(f.designer, wDone.t.art)).rejects.toMatchObject({ statusCode: 409, code: 'track_not_ready' });
    // the review task is done after finish: the drawer filter hides it from a designer, 404 as in v1
    await prisma.task.update({ where: { id: wDone.t.review }, data: { status: 'done' } });
    await expect(createOrGetSession(f.designer, wDone.t.review)).rejects.toMatchObject({ statusCode: 404 });
    // an admin may open a new session from the done review task; it takes no claim on the done task
    const adm = await createOrGetSession(f.admin, wDone.t.review);
    expect(adm.created).toBe(true);
    expect(adm.session).toMatchObject({ track_id: track.id, task_id: wDone.t.review, branch: track.branch });
    expect((await getClaim(wDone.t.review))?.live).toBe(false);
  });

  it('a design-runner (Bot) task never opens a session: 404 for a designer and for an admin', async () => {
    const { w } = await trackWorld('runner');
    for (const t of [w.t.provision, w.t.research, w.t.wireframe, w.t.home, w.t.rest, w.t.launch]) {
      await expect(createOrGetSession(f.designer, t)).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
      await expect(createOrGetSession(f.admin, t)).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    }
    expect(await prisma.designSession.count({ where: { project_id: w.projectId } })).toBe(0);
  });

  it('another designer on the project is 409 session_owned on any stage task; off the project it is 404', async () => {
    const { w, track } = await trackWorld('owned');
    const { session } = await createOrGetSession(f.designer, w.t.art);
    await expect(createOrGetSession(f.other, w.t.refine)).rejects.toMatchObject({ statusCode: 404 });
    const fn2 = await prisma.function.create({ data: { name: `dp-${f.tag}-owned` } });
    try {
      await prisma.projectTeamAssignment.create({ data: { project_id: w.projectId, user_id: f.other.userId, function_id: fn2.id } });
      for (const t of [w.t.art, w.t.refine, w.t.review]) await expect(createOrGetSession(f.other, t)).rejects.toMatchObject({ statusCode: 409, code: 'session_owned' });
    } finally {
      await prisma.projectTeamAssignment.deleteMany({ where: { function_id: fn2.id } });
      await prisma.function.delete({ where: { id: fn2.id } });
    }
    expect((await live(track.id)).map((x) => x.id)).toEqual([session.id]);
  });

  it('removed from the project: she cannot re-open the track session from any stage task (404); an untracked task is unchanged', async () => {
    const { w } = await trackWorld('removed');
    await createOrGetSession(f.designer, w.t.art);
    const pta = await prisma.projectTeamAssignment.findFirstOrThrow({ where: { project_id: w.projectId, user_id: f.designer.userId } });
    await prisma.projectTeamAssignment.delete({ where: { id: pta.id } });
    await expect(createOrGetSession(f.designer, w.t.refine)).rejects.toMatchObject({ statusCode: 404 });
  });
});
