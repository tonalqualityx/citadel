// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';
import { seedWorld, teardownWorlds, type TrackWorld } from '@/lib/design/__tests__/track-world';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createOrGetSession, transitionSession } from '@/lib/design/sessions';
import { findForbiddenKeys } from '@/lib/design/projections';
import * as sessionsRoute from '../route';
import * as sessionRoute from '../[id]/route';
import * as messages from '../[id]/messages/route';
import * as apply from '../[id]/apply/route';
import * as pins from '../[id]/pins/route';
import * as restore from '../[id]/restore/route';
import * as publish from '../[id]/publish/route';
import * as requestPublish from '../[id]/request-publish/route';
import * as close from '../[id]/close/route';
import * as siteTasks from '../[id]/site-tasks/route';
import * as work from '../../work/route';
import * as tasksRoute from '../../tasks/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const SHA = 'a'.repeat(40);

// v2 (SPEC 2.2, 2.3; PLAN W1.6): the 409 answers `track_busy`, `track_done`, `track_not_ready`, `track_live`, and the
// `design-runner` filter, through the real routes on the scratch database.
describe.skipIf(!SCRATCH)('track guards on the designer routes (real database)', () => {
  let f: DesignFixture;
  const worlds: TrackWorld[] = [];
  const asDesigner = (userId = f.designer.userId) => as.mockResolvedValue({ userId, email: 'd@example.test', role: 'designer', via: 'session' });
  const asAdmin = () => as.mockResolvedValue({ userId: f.admin.userId, email: 'a@example.test', role: 'admin', via: 'session' });
  beforeAll(async () => { f = await seedDesign(`tg${Date.now()}`); });
  beforeEach(() => asDesigner());
  afterAll(async () => {
    // opening the workspace starts the automatic timer: its entries reference the fixture's users and tasks
    const ids = [f.designer.userId, f.admin.userId, f.other.userId];
    await prisma.designSession.updateMany({ where: { designer_id: { in: ids } }, data: { timer_entry_id: null } });
    await prisma.timeEntry.deleteMany({ where: { user_id: { in: ids } } });
    await teardownWorlds(f, worlds);
    await teardownDesign(f);
    await prisma.$disconnect();
  });

  async function tracked(label: string, stage: 'refine' | 'rest_build' | 'review' | 'done') {
    const w = await seedWorld(f, label);
    worlds.push(w);
    const slug = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join('');
    const track = await prisma.designTrack.create({
      data: { site_id: w.siteId, project_id: w.projectId, slug, stage, branch: `design/t-${slug}`, preview_alias: `design-t-${slug}`, preview_url: `https://design-t-${slug}.proj.pages.dev` },
    });
    const res = await sessionsRoute.POST(json('POST', '/api/design/sessions', { task_id: w.t.art }));
    expect(res.status).toBe(201);
    const session = (await res.json()).session as { id: string; track: Record<string, unknown> | null };
    await transitionSession(session.id, 'awaiting_input', 'worker');
    return { w, track, session };
  }
  async function setBusy(trackId: string, on: boolean) {
    if (on) {
      const job = await prisma.designJob.create({ data: { track_id: trackId, kind: 'rest_build', status: 'running', payload: {} } });
      await prisma.designTrack.update({ where: { id: trackId }, data: { busy_job_id: job.id } });
    } else {
      await prisma.designTrack.update({ where: { id: trackId }, data: { busy_job_id: null } });
      await prisma.designJob.deleteMany({ where: { track_id: trackId } });
    }
  }
  const code = async (res: Response) => ((await res.json()) as { code?: string }).code;

  /** The routes that answer 409 track_busy while Bast builds (SPEC 2.2), each with a plausible request. */
  const busyCalls = (id: string): Array<[string, () => Promise<Response>]> => [
    ['messages', () => messages.POST(json('POST', `/api/design/sessions/${id}/messages`, { client_ref: crypto.randomUUID(), text: 'hi' }), ctx(id))],
    ['apply', () => apply.POST(json('POST', `/api/design/sessions/${id}/apply`, {}), ctx(id))],
    ['pins', () => pins.POST(json('POST', `/api/design/sessions/${id}/pins`, {}), ctx(id))],
    ['restore', () => restore.POST(json('POST', `/api/design/sessions/${id}/restore`, { to_sha: SHA }), ctx(id))],
    ['publish', () => publish.POST(json('POST', `/api/design/sessions/${id}/publish`, { head_sha: SHA }), ctx(id))],
    ['request-publish', () => requestPublish.POST(json('POST', `/api/design/sessions/${id}/request-publish`, {}), ctx(id))],
  ];

  it('while the track is busy every listed write is 409 track_busy and stores nothing; free again, they are not', async () => {
    const { track, session } = await tracked('busy', 'rest_build');
    await setBusy(track.id, true);
    for (const [name, call] of busyCalls(session.id)) {
      const res = await call();
      expect(res.status, name).toBe(409);
      expect(await code(res), name).toBe('track_busy');
    }
    expect(await prisma.designEvent.count({ where: { session_id: session.id } })).toBe(0);
    expect(await prisma.designCommand.count({ where: { session_id: session.id } })).toBe(0);
    // reads, stop and close stay open while busy
    const read = await sessionRoute.GET(json('GET', `/api/design/sessions/${session.id}`), ctx(session.id));
    expect(read.status).toBe(200);
    expect((await read.json()).session.track).toMatchObject({ id: track.id, stage: 'rest_build', busy: true, busy_line: 'Bast is building the remaining pages' });
    await setBusy(track.id, false);
    const free = await messages.POST(json('POST', `/api/design/sessions/${session.id}/messages`, { client_ref: crypto.randomUUID(), text: 'hi' }), ctx(session.id));
    expect(free.status).toBe(201);
  });

  it('close is open while busy', async () => {
    const { track, session } = await tracked('busyclose', 'rest_build');
    await setBusy(track.id, true);
    const res = await close.POST(json('POST', `/api/design/sessions/${session.id}/close`, {}), ctx(session.id));
    expect(res.status).not.toBe(409);
    await setBusy(track.id, false);
  });

  it('once the track is done: messages, apply, pins and restore are 409 track_done; publish and request-publish stay open; reads stay open', async () => {
    const { track, session } = await tracked('done', 'review');
    await prisma.designTrack.update({ where: { id: track.id }, data: { stage: 'done', finished_at: new Date(), finish_result: { green: true } } });
    const calls = busyCalls(session.id);
    for (const [name, call] of calls) {
      const res = await call();
      if (['publish', 'request-publish'].includes(name)) {
        // the v1 publish path is the launch merge: whatever it answers, it is not a track refusal
        expect(['track_done', 'track_busy'], name).not.toContain(await code(res));
      } else {
        expect(res.status, name).toBe(409);
        expect(await code(res), name).toBe('track_done');
      }
    }
    const read = await sessionRoute.GET(json('GET', `/api/design/sessions/${session.id}`), ctx(session.id));
    expect(read.status).toBe(200);
    const body = await read.json();
    expect(body.session.track).toMatchObject({ stage: 'done', busy: false, finish: { green: true } });
    expect(findForbiddenKeys(body)).toEqual([]);
  });

  it('another designer gets 404 (not 409) on a busy track: access comes first', async () => {
    const { track, session } = await tracked('stranger', 'rest_build');
    await setBusy(track.id, true);
    asDesigner(f.other.userId);
    for (const [name, call] of busyCalls(session.id)) expect((await call()).status, name).toBe(404);
    await setBusy(track.id, false);
  });

  it('an untracked session is never held: v1 behaviour', async () => {
    const t = await prisma.task.create({ data: { title: `${f.tag} plain`, client_id: f.clientId, project_id: f.projectId, site_id: f.siteId, status: 'not_started' } });
    f.taskIds.push(t.id);
    const { session } = await createOrGetSession(f.designer, t.id);
    await transitionSession(session.id, 'awaiting_input', 'worker');
    const res = await messages.POST(json('POST', `/api/design/sessions/${session.id}/messages`, { client_ref: crypto.randomUUID(), text: 'hi' }), ctx(session.id));
    expect(res.status).toBe(201);
    const read = await sessionRoute.GET(json('GET', `/api/design/sessions/${session.id}`), ctx(session.id));
    expect((await read.json()).session.track).toBeNull();
  });

  it('POST /sessions on a stage task: 201 with the track view, 409 track_not_ready without an open track, 404 on a design-runner task', async () => {
    const { w, track, session } = await tracked('open', 'refine');
    expect(session.track).toMatchObject({ id: track.id, stage: 'refine', busy: false, busy_line: null, preview_alias: track.preview_alias, finish: null });
    const again = await sessionsRoute.POST(json('POST', '/api/design/sessions', { task_id: w.t.review }));
    expect(again.status).toBe(200);
    expect((await again.json()).session.id).toBe(session.id);

    const bare = await seedWorld(f, 'bare');
    worlds.push(bare);
    const notReady = await sessionsRoute.POST(json('POST', '/api/design/sessions', { task_id: bare.t.art }));
    expect(notReady.status).toBe(409);
    expect(await code(notReady)).toBe('track_not_ready');
    for (const t of [w.t.provision, w.t.home, w.t.launch]) {
      const res = await sessionsRoute.POST(json('POST', '/api/design/sessions', { task_id: t }));
      expect(res.status).toBe(404);
      expect(await code(res)).toBe('not_found');
    }
  });

  it('the drawer hides Bast-run tasks and shows stage tasks with track_stage; the list carries track_stage; Start new work is 409 track_live', async () => {
    const { w, track } = await tracked('drawer', 'refine');
    const drawer = await (await tasksRoute.GET(json('GET', `/api/design/tasks?project_id=${w.projectId}`) as never)).json();
    const tasks = drawer.projects.flatMap((p: { phases: Array<{ tasks: Array<{ id: string; track_stage: string | null; session: { chip: string } | null }> }> }) => p.phases.flatMap((ph) => ph.tasks));
    const ids = tasks.map((t: { id: string }) => t.id);
    for (const hidden of [w.t.provision, w.t.research, w.t.wireframe, w.t.home, w.t.rest, w.t.launch]) expect(ids).not.toContain(hidden);
    for (const stage of [w.t.art, w.t.refine, w.t.review]) {
      const t = tasks.find((x: { id: string }) => x.id === stage);
      expect(t, stage).toBeTruthy();
      expect(t.track_stage).toBe('refine');
      expect(t.session).not.toBeNull(); // the one track session shows on every stage task
    }
    expect(findForbiddenKeys(drawer)).toEqual([]);

    const list = await (await sessionsRoute.GET(json('GET', '/api/design/sessions') as never)).json();
    expect(list.sessions.find((s: { track_stage: string | null }) => s.track_stage === 'refine')).toBeTruthy();

    asAdmin();
    const startWork = await work.POST(json('POST', '/api/design/work', { site_id: w.siteId, title: 'More work' }));
    expect(startWork.status).toBe(409);
    expect(await code(startWork)).toBe('track_live');
    expect(await prisma.task.count({ where: { project_id: w.projectId, tags: { has: 'design-work' } } })).toBe(0);
    // a finished track no longer holds the site
    await prisma.designTrack.update({ where: { id: track.id }, data: { stage: 'done' } });
    const after = await work.POST(json('POST', '/api/design/work', { site_id: w.siteId, title: 'More work' }));
    expect(await code(after)).not.toBe('track_live');
  });

  it('the Tasks tab lists stage tasks but never a Bast-run task', async () => {
    const { w, session } = await tracked('tab', 'refine');
    const res = await siteTasks.GET(json('GET', `/api/design/sessions/${session.id}/site-tasks`) as never, ctx(session.id));
    const ids = ((await res.json()).tasks as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([w.t.art, w.t.refine, w.t.review]));
    for (const hidden of [w.t.provision, w.t.research, w.t.wireframe, w.t.home, w.t.rest, w.t.launch]) expect(ids).not.toContain(hidden);
  });
});
