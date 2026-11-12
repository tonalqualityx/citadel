// @vitest-environment node
/**
 * Work stage F against a real Postgres: the two clocks. Routes run as handlers with the sign-in mocked (the unlaned oracle-user key
 * through the REAL key-to-auth path is in work-callers.integration.test.ts); the machine side (active.py and friends) is not run.
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Seeds its own rows and removes only those. Run on its own
 * clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/work_f_int npx vitest run lib/work/__tests__/stage-f.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(async () => auth.current),
}));

import { prisma } from '@/lib/db/prisma';
import { runHomeUndo, homeActSchema } from '@/lib/home/act';
import { POST as clocksPost } from '@/app/api/oracle/clocks/route';
import { GET as clocksGet } from '@/app/api/work/[key]/clocks/route';
import { POST as reconcilePost } from '@/app/api/home/reconcile/route';
import { POST as trackPost } from '@/app/api/oracle/sessions/[id]/track/route';
import { GET as retainerGet } from '@/app/api/clients/[id]/retainer/route';
import { loadClockSummary } from '../clocks';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const MIN = 60_000;
const HOUR = 3_600_000;

describe.skipIf(!SCRATCH)('Work stage F: the two clocks (real database)', () => {
  const tag = `wf-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const users = [adminId, techId];
  let clientId = '';
  let projectId = '';
  let otherProjectId = '';
  let taskA = '';
  let taskB = '';
  let settingsBefore: { owner_user_id: string | null } | null = null;
  const projectIds: string[] = [];
  const taskIds: string[] = [];

  const as = (a: unknown) => {
    auth.current = a;
  };
  const oracle = () => ({ userId: adminId, email: `oracle-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'oracle', laneEnforced: true });
  const chatLane = () => ({ userId: adminId, email: `bast-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'bast-chat', laneEnforced: true });
  const courier = () => ({ userId: adminId, email: `courier-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'courier', laneEnforced: true });
  const admin = () => ({ userId: adminId, email: `admin-${tag}@example.test`, role: 'admin', via: 'session' });
  const adminKey = () => ({ userId: adminId, email: `admin-${tag}@example.test`, role: 'admin', via: 'api_key', apiKeyId: 'k' });
  const tech = () => ({ userId: techId, email: `sabeen-${tag}@example.test`, role: 'tech', via: 'session' });
  const jreq = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const keyParam = (k: string) => ({ params: Promise.resolve({ key: k }) });
  const sid = (s: string) => ({ params: Promise.resolve({ id: s }) });

  const now = () => new Date();
  const startOfThisMonthPlus = (hours: number) => {
    // inside this month in any zone: the 2nd of the month at noon UTC plus hours, never in the future
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 2, 12, 0) + hours * HOUR);
  };
  const clockRow = (key: string, over: Record<string, unknown> = {}) => {
    const start = startOfThisMonthPlus(0);
    return { kind: 'mike_estimate', target_key: `project:${projectId}`, session_external_id: `sess-${tag}`, source: 'session', started_at: start.toISOString(), ended_at: new Date(start.getTime() + 30 * MIN).toISOString(), minutes: 30, basis: '4 prompts in 1 block, from session timestamps', dedupe_key: `${tag}-${key}`, ...over };
  };
  const post = async (rows: unknown[], a: unknown = oracle()) => {
    as(a);
    const res = await clocksPost(jreq('/api/oracle/clocks', 'POST', { rows }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { created: number; updated: number; refused: { index: number; reason: string; dedupe_key: string | null }[] } };
  };
  const reconcile = async (body: unknown, a: unknown = admin()) => {
    as(a);
    const res = await reconcilePost(jreq('/api/home/reconcile', 'POST', body));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { action_id: string; message: string } };
  };
  const summary = async (key: string, a: unknown = admin()) => {
    as(a);
    const res = await clocksGet(jreq(`/api/work/${key}/clocks`, 'GET'), keyParam(key));
    return { status: res.status, body: (await res.json()) as Awaited<ReturnType<typeof loadClockSummary>> };
  };
  const clocks = () => prisma.workClock.findMany({ where: { dedupe_key: { startsWith: tag } }, orderBy: { dedupe_key: 'asc' } });
  const entries = () => prisma.timeEntry.count({ where: { user_id: adminId } });

  beforeAll(async () => {
    settingsBefore = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin WF', role: 'admin' },
        { id: techId, email: `sabeen-${tag}@example.test`, password_hash: 'x', name: 'Sabeen WF', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({ data: [{ user_id: adminId, home_view: 'home', timezone: TZ }, { user_id: techId, home_view: 'overlook', timezone: TZ }] });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, create: { id: 1, owner_user_id: adminId }, update: { owner_user_id: adminId } });
    clientId = (await prisma.client.create({ data: { name: `Phil Camp ${tag}`, status: 'active', retainer_hours: 10 } as never })).id;
    const p = await prisma.project.create({ data: { name: `Memorial ${tag}`, status: 'in_progress', type: 'project', client_id: clientId } as never });
    projectId = p.id;
    const p2 = await prisma.project.create({ data: { name: `Other ${tag}`, status: 'in_progress', type: 'project', client_id: clientId } as never });
    otherProjectId = p2.id;
    projectIds.push(p.id, p2.id);
    const a = await prisma.task.create({ data: { title: `Build page ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, project_id: projectId, tags: [] } as never });
    const b = await prisma.task.create({ data: { title: `Write copy ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, project_id: projectId, tags: [] } as never });
    taskA = a.id;
    taskB = b.id;
    taskIds.push(a.id, b.id);
  });

  afterAll(async () => {
    const made = await prisma.task.findMany({ where: { OR: [{ client_id: clientId }, { id: { in: taskIds } }] }, select: { id: true } });
    const all = [...new Set([...made.map((t) => t.id), ...taskIds])];
    const allProjects = [...new Set([...(await prisma.project.findMany({ where: { client_id: clientId }, select: { id: true } })).map((p) => p.id), ...projectIds])];
    await prisma.workClock.deleteMany({ where: { OR: [{ dedupe_key: { startsWith: tag } }, { session_external_id: { contains: tag } }, { user_id: { in: users } }] } });
    await prisma.workEvidence.deleteMany({ where: { target_key: { in: [...all.map((i) => `task:${i}`), ...allProjects.map((i) => `project:${i}`)] } } });
    await prisma.workLink.deleteMany({ where: { OR: [{ target_key: { in: [...all.map((i) => `task:${i}`), ...allProjects.map((i) => `project:${i}`)] } }, { ref: { contains: tag } }] } });
    await prisma.timeEntry.deleteMany({ where: { user_id: { in: users } } });
    await prisma.emailAsk.deleteMany({ where: { message_id: { startsWith: tag } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: all } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: users } } });
    await prisma.task.deleteMany({ where: { id: { in: all } } });
    await prisma.project.deleteMany({ where: { id: { in: allProjects } } });
    await prisma.homeReconcileHold.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.activityLog.deleteMany({ where: { user_id: { in: users } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    if (settingsBefore) await prisma.bastChatSettings.update({ where: { id: 1 }, data: { owner_user_id: settingsBefore.owner_user_id } });
    else await prisma.bastChatSettings.deleteMany({ where: { id: 1 } });
    await prisma.userPreference.deleteMany({ where: { user_id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('who may post the clocks', () => {
    it('the oracle lane and the bast-chat lane may; another lane, an admin key without a lane and a tech session may not', async () => {
      expect((await post([clockRow('lane-o')], oracle())).status).toBe(200);
      expect((await post([clockRow('lane-c', { kind: 'bast_run', source: 'citadel-worker', cost_usd: 0.5 })], chatLane())).status).toBe(200);
      expect((await post([clockRow('lane-x')], courier())).status).toBe(403);
      expect((await post([clockRow('lane-t')], tech())).status).toBe(403);
      expect((await clocks()).map((c) => c.dedupe_key)).toEqual([`${tag}-lane-c`, `${tag}-lane-o`]);
    });
    it('an empty list, more than 200 rows and an unknown top-level field are 400 and write nothing', async () => {
      const before = (await clocks()).length;
      as(oracle());
      expect((await clocksPost(jreq('/api/oracle/clocks', 'POST', { rows: [] }))).status).toBe(400);
      expect((await clocksPost(jreq('/api/oracle/clocks', 'POST', { rows: Array.from({ length: 201 }, () => ({})) }))).status).toBe(400);
      expect((await clocksPost(jreq('/api/oracle/clocks', 'POST', { rows: [clockRow('x')], extra: 1 }))).status).toBe(400);
      expect((await clocks()).length).toBe(before);
    });
  });

  describe('posting rows: upsert by dedupe_key, each row judged alone', () => {
    it('saves good rows, refuses the bad ones with a reason, and a 72-hour row is refused', async () => {
      const out = await post([
        clockRow('good-1'),
        clockRow('bad-pair', { source: 'citadel-worker' }),
        clockRow('long', { minutes: 4320 }),
        clockRow('missing', { target_key: `task:${randomUUID()}` }),
        clockRow('window', { ended_at: new Date(Date.now() - 400 * 86_400_000).toISOString(), started_at: new Date().toISOString() }),
        clockRow('task-row', { target_key: `task:${taskA}`, minutes: 20 }),
      ]);
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ result: 'saved', created: 2, updated: 0 });
      expect(out.body.refused.map((r) => `${r.index}:${r.reason}`)).toEqual(['1:bad_pairing', '2:bad_shape', '3:target_missing', '4:bad_window']);
    });
    it('the owner id is set here, a task row carries its project, and the machine cannot choose them', async () => {
      const row = await prisma.workClock.findUniqueOrThrow({ where: { dedupe_key: `${tag}-task-row` } });
      expect(row).toMatchObject({ kind: 'mike_estimate', user_id: adminId, task_id: taskA, project_id: projectId, target_key: `task:${taskA}` });
      const bad = await post([{ ...clockRow('uid'), user_id: techId }, { ...clockRow('te'), time_entry_id: randomUUID() }]);
      expect(bad.body.refused.map((r) => r.reason)).toEqual(['bad_shape', 'bad_shape']);
    });
    it('posting the same row again updates it (no second row) and keeps nothing else', async () => {
      const again = await post([clockRow('good-1', { minutes: 35 })]);
      expect(again.body).toMatchObject({ created: 0, updated: 1 });
      expect((await prisma.workClock.findMany({ where: { dedupe_key: `${tag}-good-1` } })).map((r) => r.minutes)).toEqual([35]);
    });
    it('a row cannot change its kind', async () => {
      const r = await post([clockRow('good-1', { kind: 'bast_run' })]);
      expect(r.body.refused.map((x) => x.reason)).toEqual(['kind_changed']);
    });
    it('writes no time entry, ever, from posting', async () => {
      expect(await entries()).toBe(0);
    });
    it('answers skipped home_off when no owner is set, and writes nothing', async () => {
      await prisma.bastChatSettings.update({ where: { id: 1 }, data: { owner_user_id: null } });
      try {
        const before = (await clocks()).length;
        const out = await post([clockRow('off')]);
        expect(out.body).toMatchObject({ result: 'skipped', skipped: 'home_off' });
        expect((await clocks()).length).toBe(before);
      } finally {
        await prisma.bastChatSettings.update({ where: { id: 1 }, data: { owner_user_id: adminId } });
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the two clocks stay apart; an estimate is shown as an estimate', () => {
    it('three short bursts show the burst time, and a 45-minute build turn is 45 Bast minutes beside at most 5 of his', async () => {
      const s = startOfThisMonthPlus(24);
      const at = (m: number) => new Date(s.getTime() + m * MIN).toISOString();
      await post([
        clockRow('burst-1', { target_key: `project:${otherProjectId}`, session_external_id: `s72-${tag}`, started_at: at(0), ended_at: at(12), minutes: 12, basis: '3 prompts in 1 block' }),
        clockRow('burst-2', { target_key: `project:${otherProjectId}`, session_external_id: `s72-${tag}`, started_at: at(600), ended_at: at(618), minutes: 18, dedupe_key: `${tag}-burst-2` }),
        clockRow('burst-3', { target_key: `project:${otherProjectId}`, session_external_id: `s72-${tag}`, started_at: at(2000), ended_at: at(2010), minutes: 10, dedupe_key: `${tag}-burst-3` }),
        clockRow('build-mike', { target_key: `project:${otherProjectId}`, session_external_id: `sb-${tag}`, started_at: at(3000), ended_at: at(3005), minutes: 5, dedupe_key: `${tag}-build-mike` }),
        clockRow('build-bast', { kind: 'bast_run', target_key: `project:${otherProjectId}`, session_external_id: `sb-${tag}`, started_at: at(3000), ended_at: at(3045), minutes: 45, basis: 'one turn, 45 minutes', dedupe_key: `${tag}-build-bast` }),
      ]);
      const out = await summary(`project:${otherProjectId}`);
      expect(out.status).toBe(200);
      expect(out.body.mike).toMatchObject({ minutes: 45, unlogged_minutes: 45, sessions: 2, suggested: 45 });
      expect(out.body.mike!.minutes).toBeLessThan(72 * 60);
      expect(out.body.mike!.line).toMatch(/^Your time: about 45 m this month \(Bast's estimate from 2 of your sessions on \d+ days?\)\. Log it\?$/);
      expect(out.body.bast).toMatchObject({ minutes: 45, cost_usd: null, line: 'Bast worked: 45 m.' });
    });

    it('a project total includes its tasks; a task shows its own; unattributed rows show nowhere', async () => {
      await post([
        clockRow('unattr', { target_key: null, minutes: 99 }),
        clockRow('task-b', { target_key: `task:${taskB}`, minutes: 15, dedupe_key: `${tag}-task-b` }),
        clockRow('worker', { kind: 'bast_run', source: 'citadel-worker', target_key: `task:${taskB}`, minutes: 20, cost_usd: 3.4, model: 'sonnet', basis: 'worker pass', dedupe_key: `${tag}-worker` }),
      ]);
      const proj = await summary(`project:${projectId}`);
      // project rows: good-1 (35), lane-o (30), task-row (20, task A), task-b (15)
      expect(proj.body.mike?.minutes).toBe(100);
      expect(proj.body.bast).toMatchObject({ minutes: 20 + 30, cost_usd: 3.9 });
      const t = await summary(`task:${taskB}`);
      expect(t.body.mike?.minutes).toBe(15);
      expect(t.body.bast).toMatchObject({ minutes: 20, cost_usd: 3.4, line: 'Bast worked: 20 m, $3.40.' });
      expect(JSON.stringify(proj.body)).not.toContain('99');
    });

    it('the lines have no dash and none of the banned words', async () => {
      const text = JSON.stringify([(await summary(`project:${projectId}`)).body, (await summary(`task:${taskB}`)).body]);
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/priorit|overdue/i);
    });
  });

  describe('who may read the lines', () => {
    it('his session only: a machine key (even an admin key), a tech session and a bad key are refused', async () => {
      expect((await summary(`task:${taskB}`, admin())).status).toBe(200);
      expect((await summary(`task:${taskB}`, oracle())).status).toBe(403);
      expect((await summary(`task:${taskB}`, adminKey())).status).toBe(403);
      expect((await summary(`task:${taskB}`, tech())).status).toBe(403);
      expect((await summary('project:not-a-uuid')).status).toBe(400);
      expect((await summary(`task:${randomUUID()}`)).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('Track it captures the estimated time', () => {
    const track = async (ref: string, body: Record<string, unknown>) => {
      as(oracle());
      const res = await trackPost(jreq(`/api/oracle/sessions/${ref}/track`, 'POST', body), sid(ref));
      return { status: res.status, body: (await res.json()) as Record<string, unknown> & { task_ids: string[]; action_id: string; target_key: string; clock_id: string | null; estimated_minutes: number | null } };
    };
    it('stores ONE estimate row on the new work, labelled with its basis, and makes no time entry', async () => {
      const ref = `tr-${tag}`;
      const before = await entries();
      const out = await track(ref, { title: `Tracked ${tag}`, project_target: null, deliverables: [], estimated_minutes: 50, estimate_basis: '6 prompts before it was tracked' });
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ result: 'tracked', estimated_minutes: 50 });
      taskIds.push(...out.body.task_ids);
      const rows = await prisma.workClock.findMany({ where: { session_external_id: ref } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'mike_estimate', source: 'track', minutes: 50, user_id: adminId, target_key: out.body.target_key, time_entry_id: null, task_id: out.body.task_ids[0], cost_usd: null });
      expect(rows[0].basis).toContain('6 prompts before it was tracked');
      expect(rows[0].basis).toContain("Bast's estimate when you tracked it");
      expect(await entries()).toBe(before);
      const s = await summary(out.body.target_key);
      expect(s.body.mike).toMatchObject({ minutes: 50, sessions: 0 });
      expect(s.body.mike!.line).toContain("Bast's own guess when you tracked it");
    });
    it('Undo removes the estimate row with the work; a track with no estimate writes no row', async () => {
      const ref = `tr2-${tag}`;
      const out = await track(ref, { title: `Tracked two ${tag}`, project_target: null, deliverables: [], estimated_minutes: 25 });
      taskIds.push(...out.body.task_ids);
      expect((await prisma.workClock.count({ where: { session_external_id: ref } }))).toBe(1);
      await runHomeUndo(prisma, adminId, out.body.action_id, now());
      expect((await prisma.workClock.count({ where: { session_external_id: ref } }))).toBe(0);
      const none = await track(`tr3-${tag}`, { title: `Tracked three ${tag}`, project_target: null, deliverables: [] });
      taskIds.push(...none.body.task_ids);
      expect(none.body).toMatchObject({ estimated_minutes: null, clock_id: null });
      expect((await prisma.workClock.count({ where: { session_external_id: `tr3-${tag}` } }))).toBe(0);
    });
    it('a session that already carries work is answered already_tracked and stores no estimate', async () => {
      const before = await prisma.workClock.count();
      const out = await track(`tr-${tag}`, { title: 'Again', project_target: null, deliverables: [], estimated_minutes: 40 });
      expect(out.body).toMatchObject({ already_tracked: true });
      expect(await prisma.workClock.count()).toBe(before);
    });
    it('an estimate above a day or a negative one is a 400', async () => {
      expect((await track(`tr4-${tag}`, { title: 'x', project_target: null, deliverables: [], estimated_minutes: 2000 })).status).toBe(400);
      expect((await track(`tr4-${tag}`, { title: 'x', project_target: null, deliverables: [], estimated_minutes: -5 })).status).toBe(400);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('his tap writes the time entry', () => {
    const retainerUsed = async () => {
      as(admin());
      const res = await retainerGet(jreq(`/api/clients/${clientId}/retainer`, 'GET'), { params: Promise.resolve({ id: clientId }) });
      return ((await res.json()) as { usedMinutes: number }).usedMinutes;
    };

    it('nothing reaches the retainer route from the clocks alone', async () => {
      expect(await retainerUsed()).toBe(0);
      expect(await entries()).toBe(0);
    });

    it('only a browser session can tap; a machine key, a lane and the chat-style act are refused, and nothing is written', async () => {
      const body = { action: 'log_clock', target_key: `task:${taskB}`, minutes: 15 };
      expect((await reconcile(body, oracle())).status).toBe(403);
      expect((await reconcile(body, chatLane())).status).toBe(403);
      expect((await reconcile(body, adminKey())).status).toBe(403);
      expect((await reconcile(body, tech())).status).toBe(403);
      expect(homeActSchema.safeParse(body).success).toBe(false);
      expect(await entries()).toBe(0);
    });

    it('a tap on a task makes ONE entry for the chosen minutes, stamps the estimate rows, leaves Bast rows alone, and the retainer counts it only now', async () => {
      const out = await reconcile({ action: 'log_clock', target_key: `task:${taskB}`, minutes: 15 });
      expect(out.status).toBe(200);
      expect(out.body.message).toBe('Logged 15 m.');
      const list = await prisma.timeEntry.findMany({ where: { user_id: adminId } });
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ task_id: taskB, project_id: projectId, duration: 15, is_running: false, is_billable: true, is_deleted: false });
      expect(list[0].description).toContain('Estimated by Bast');
      expect(list[0].description).toContain('logged by your tap');
      const rows = await prisma.workClock.findMany({ where: { dedupe_key: { in: [`${tag}-task-b`, `${tag}-worker`] } } });
      expect(rows.find((r) => r.kind === 'mike_estimate')?.time_entry_id).toBe(list[0].id);
      expect(rows.find((r) => r.kind === 'bast_run')?.time_entry_id).toBeNull();
      expect(await retainerUsed()).toBe(15);
      // the same estimate is not offered twice
      const s = await summary(`task:${taskB}`);
      expect(s.body.mike).toMatchObject({ unlogged_minutes: 0, logged_minutes: 15, suggested: null });
      expect(s.body.mike!.line).not.toContain('Log it?');
      expect((await reconcile({ action: 'log_clock', target_key: `task:${taskB}`, minutes: 15 })).status).toBe(409);
      expect(await entries()).toBe(1);
    });

    it('a re-post of a logged row keeps its link', async () => {
      await post([clockRow('task-b', { target_key: `task:${taskB}`, minutes: 18, dedupe_key: `${tag}-task-b` })]);
      const row = await prisma.workClock.findUniqueOrThrow({ where: { dedupe_key: `${tag}-task-b` } });
      expect(row.minutes).toBe(18);
      expect(row.time_entry_id).not.toBeNull();
    });

    it('Undo soft deletes the entry, offers the estimate again, and the retainer drops back', async () => {
      const taps = await prisma.homeAction.findMany({ where: { user_id: adminId, action: 'work_log_clock' } });
      expect(taps).toHaveLength(1);
      await runHomeUndo(prisma, adminId, taps[0].id, now());
      expect((await prisma.timeEntry.findMany({ where: { user_id: adminId } })).map((e) => e.is_deleted)).toEqual([true]);
      expect((await prisma.workClock.findUniqueOrThrow({ where: { dedupe_key: `${tag}-task-b` } })).time_entry_id).toBeNull();
      expect(await retainerUsed()).toBe(0);
      expect((await summary(`task:${taskB}`)).body.mike?.suggested).toBe(20);
    });

    it('a tap on a project logs against the project (no task) and stamps the project total, including its tasks', async () => {
      const out = await reconcile({ action: 'log_clock', target_key: `project:${projectId}`, minutes: 90, billable: false });
      expect(out.status).toBe(200);
      const e = await prisma.timeEntry.findFirstOrThrow({ where: { user_id: adminId, is_deleted: false } });
      expect(e).toMatchObject({ task_id: null, project_id: projectId, duration: 90, is_billable: false });
      expect((await summary(`project:${projectId}`)).body.mike?.suggested).toBeNull();
      expect(await prisma.workClock.count({ where: { project_id: projectId, kind: 'mike_estimate', time_entry_id: null } })).toBe(0);
    });

    it('Undo after the entry was edited answers changed since and leaves the stamps', async () => {
      const tap = (await prisma.homeAction.findMany({ where: { user_id: adminId, action: 'work_log_clock', undone_at: null } }))[0];
      await prisma.timeEntry.updateMany({ where: { user_id: adminId, is_deleted: false }, data: { duration: 91 } });
      await expect(runHomeUndo(prisma, adminId, tap.id, now())).rejects.toBeTruthy();
      expect(await prisma.workClock.count({ where: { project_id: projectId, kind: 'mike_estimate', time_entry_id: { not: null } } })).toBeGreaterThan(0);
    });

    it('a target with no estimate, a missing target and a bad key are refused and write nothing', async () => {
      const before = await entries();
      expect((await reconcile({ action: 'log_clock', target_key: `task:${taskA}`, minutes: 20 })).status).toBeGreaterThanOrEqual(409);
      expect((await reconcile({ action: 'log_clock', target_key: `task:${randomUUID()}`, minutes: 20 })).status).toBe(404);
      expect((await reconcile({ action: 'log_clock', target_key: 'nonsense-key-here', minutes: 20 })).status).toBe(404);
      expect((await reconcile({ action: 'log_clock', target_key: `task:${taskB}`, minutes: 0 })).status).toBe(400);
      expect(await entries()).toBe(before);
    });
  });

  describe('nothing was sent and nothing client-facing was touched', () => {
    it('no mail row, no portal notice, no comment on any task came from any of it', async () => {
      expect(await prisma.emailOutbox.count({ where: { created_at: { gte: new Date(Date.now() - 6 * HOUR) } } })).toBe(0);
      expect(await prisma.comment.count({ where: { task_id: { in: taskIds } } })).toBe(0);
    });
  });
});
