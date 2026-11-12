// @vitest-environment node
/**
 * Work stage E against a real Postgres: sessions. The session routes and the home act run as handlers and functions with the sign-in
 * mocked; the machine side (the hooks) is not run. Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Seeds its
 * own rows and removes only those (and puts the one BastChatSettings row back as it found it). Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/work_e_int npx vitest run lib/work/__tests__/stage-e.integration.test.ts
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
import { loadHomeInputs, loadSessionAsksFor } from '@/lib/home/load';
import { loadItemStates } from '@/lib/home/state';
import { selectHome } from '@/lib/home/select';
import { runHomeAct, runHomeUndo, zonedDateString } from '@/lib/home/act';
import { GET as indexGet } from '@/app/api/oracle/work-index/route';
import { POST as linksPost } from '@/app/api/oracle/sessions/[id]/links/route';
import { POST as evidencePost } from '@/app/api/oracle/sessions/[id]/evidence/route';
import { POST as closePost } from '@/app/api/oracle/sessions/[id]/close-task/route';
import { POST as trackPost } from '@/app/api/oracle/sessions/[id]/track/route';
import { POST as stalePost } from '@/app/api/oracle/sessions/stale-asks/route';
import { loadSessionFinishedCards } from '../sessions-store';
import { sessionRunKey, shortIdOf } from '../sessions';
import { workState } from '../state';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.skipIf(!SCRATCH)('Work stage E: sessions (real database)', () => {
  const tag = `we-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const users = [adminId, techId];
  const root = `/tmp/${tag}`;
  const alpha = `${root}/alpha`;
  const beta = `${root}/beta`;
  let clientId = '';
  let machineId = '';
  let settingsBefore: { owner_user_id: string | null } | null = null;
  const ids: Record<string, string> = {};
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  const sessionIds: string[] = [];

  const as = (a: unknown) => {
    auth.current = a;
  };
  const oracle = () => ({ userId: adminId, email: `oracle-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'oracle', laneEnforced: true });
  const porter = () => ({ userId: adminId, email: `porter-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'porter', laneEnforced: true });
  const admin = () => ({ userId: adminId, email: `admin-${tag}@example.test`, role: 'admin', via: 'session' });
  const jreq = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const sid = (s: string) => ({ params: Promise.resolve({ id: s }) });
  const opts = (now = NOW) => ({ now, timezone: TZ, date: zonedDateString(now, TZ) });
  const act = (req: Parameters<typeof runHomeAct>[2], now = NOW) => runHomeAct(prisma, adminId, req, opts(now));

  const project = async (k: string, over: Record<string, unknown> = {}) => {
    const p = await prisma.project.create({ data: { name: `${k} ${tag}`, status: 'in_progress', type: 'project', client_id: clientId, ...over } as never });
    ids[k] = p.id;
    projectIds.push(p.id);
    return p;
  };
  const task = async (k: string, over: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${k} ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, tags: [], ...over } as never });
    ids[k] = t.id;
    taskIds.push(t.id);
    return t;
  };
  const session = async (ext: string, over: Record<string, unknown> = {}) => {
    sessionIds.push(ext);
    return prisma.oracleSession.create({ data: { machine_id: machineId, external_id: ext, source: 'claude_code', title: `Session ${ext}`, cwd: alpha, status: 'running', last_event_at: NOW, started_at: ago(1), ...over } as never });
  };
  const status = async (k: string) => (await prisma.task.findUniqueOrThrow({ where: { id: ids[k] } })).status;
  const links = (ref: string, state?: string) => prisma.workLink.findMany({ where: { kind: 'session', ref, ...(state ? { state } : {}) }, orderBy: { created_at: 'asc' } });
  const window = () => ({ from: new Date(NOW.getTime() - 3 * HOUR).toISOString(), to: new Date(Date.now() + HOUR).toISOString() });
  const at = (minAgo = 5) => new Date(Date.now() - minAgo * 60_000).toISOString();
  const commit = (cwd: string, subject: string, sha: string, minAgo = 5) => ({ kind: 'commit', ref: `${sha}@${cwd}`, at: at(minAgo), repo: cwd, cwd, subject });
  const postEvidence = async (ref: string, items: unknown[], w = window()) => {
    as(oracle());
    const res = await evidencePost(jreq(`/api/oracle/sessions/${ref}/evidence`, 'POST', { window: w, items }), sid(ref));
    return { res, body: (await res.json()) as Record<string, unknown> & { proofs: { task_id: string; decision: string; strength: string }[] } };
  };
  const close = async (ref: string, taskKey: string) => {
    as(oracle());
    const res = await closePost(jreq(`/api/oracle/sessions/${ref}/close-task`, 'POST', { task_id: ids[taskKey] }), sid(ref));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const screen = async (userId = adminId, now = NOW) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, now, { timezone: TZ }), loadItemStates(prisma, userId)]);
    const sel = selectHome({ raw, states, now });
    const all = Object.values(sel.sections as unknown as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v : [])) as { key?: string; title?: string; type?: string; finished?: { rows: { key: string; task_id: string; group: string; close_on_task_page?: boolean }[] } }[];
    return { raw, sel, all };
  };
  const snapshot = async () => ({
    tasks: (await prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' }, select: { id: true, status: true, updated_at: true } })).map((t) => `${t.id}:${t.status}:${t.updated_at.toISOString()}`),
    count: await prisma.task.count({ where: { client_id: clientId } }),
    comments: await prisma.comment.count({ where: { task_id: { in: taskIds } } }),
    actions: await prisma.homeAction.count({ where: { user_id: adminId } }),
    items: await prisma.workFinishedItem.count({ where: { user_id: adminId } }),
    evidence: await prisma.workEvidence.count({ where: { session_id: { in: sessionIds } } }),
    links: await prisma.workLink.count({ where: { kind: 'session', ref: { in: sessionIds } } }),
    states: await prisma.homeItemState.count({ where: { user_id: adminId } }),
    ledger: await prisma.workStaleAskClear.count({ where: { user_id: adminId } }),
    outbox: await prisma.emailOutbox.count({ where: { created_at: { gte: ago(1) } } }),
  });

  beforeAll(async () => {
    settingsBefore = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin WE', role: 'admin' },
        { id: techId, email: `sabeen-${tag}@example.test`, password_hash: 'x', name: 'Sabeen WE', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({ data: [{ user_id: adminId, home_view: 'home', timezone: TZ }, { user_id: techId, home_view: 'overlook', timezone: TZ }] });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, create: { id: 1, owner_user_id: adminId }, update: { owner_user_id: adminId } });
    clientId = (await prisma.client.create({ data: { name: `Thermalnetics ${tag}`, status: 'active' } })).id;
    machineId = (await prisma.oracleMachine.create({ data: { name: `m-${tag}`, hostname: `h-${tag}` } as never })).id;
    await project('alpha', { plan_folder: alpha });
    await project('beta', { plan_folder: beta });
    await project('finishedproj', { status: 'done', completed_date: ago(30) });
    await task('Hosting comparison', { project_id: ids.alpha });
    await task('Migrate DNS records', { project_id: ids.alpha });
    await task('Unrelated chore', { project_id: ids.alpha });
    await task('Audit logins', { project_id: ids.alpha, tags: ['security'] });
    await task('Update footer', { project_id: ids.alpha, requirements: [{ id: 'a', text: 'one', completed: true, sort_order: 0 }, { id: 'b', text: 'two', completed: false, sort_order: 1 }] });
    await task('Newsletter template', { project_id: ids.beta });
    await task('Sabeens task', { project_id: ids.alpha, assignee_id: techId });
    await prisma.emailAsk.create({
      data: { message_id: `${tag}-ask`, thread_id: `${tag}-th`, account: 'mike@becomeindelible.com', from_name: 'Ashlei', from_email: `a-${tag}@client.test`, subject: 'Hosting', gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', client_id: clientId, task_id: ids['Hosting comparison'], received_at: ago(3), deep_link: `https://mail.google.com/mail/u/0/#all/${tag}-ask` } as never,
    });
  });

  afterAll(async () => {
    const made = await prisma.task.findMany({ where: { OR: [{ client_id: clientId }, { id: { in: taskIds } }] }, select: { id: true } });
    const all = [...new Set([...made.map((t) => t.id), ...taskIds])];
    const allProjects = [...new Set([...(await prisma.project.findMany({ where: { client_id: clientId }, select: { id: true } })).map((p) => p.id), ...projectIds])];
    const targets = [...all.map((i) => `task:${i}`), ...allProjects.map((i) => `project:${i}`)];
    await prisma.workEvidence.deleteMany({ where: { OR: [{ target_key: { in: targets } }, { session_id: { in: sessionIds } }] } });
    await prisma.workLink.deleteMany({ where: { OR: [{ target_key: { in: targets } }, { ref: { in: sessionIds } }] } });
    await prisma.workFinishedItem.deleteMany({ where: { user_id: { in: users } } });
    await prisma.workStaleAskClear.deleteMany({ where: { user_id: { in: users } } });
    await prisma.emailAsk.deleteMany({ where: { message_id: { startsWith: tag } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: all } } });
    await prisma.wait.deleteMany({ where: { task_id: { in: all } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: users } } });
    await prisma.task.deleteMany({ where: { id: { in: all } } });
    await prisma.project.deleteMany({ where: { id: { in: allProjects } } });
    await prisma.oracleSession.deleteMany({ where: { external_id: { in: sessionIds } } });
    await prisma.oracleMachine.deleteMany({ where: { id: machineId } });
    await prisma.homeReconcileHold.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: users } } }).catch(() => undefined);
    await prisma.activityLog.deleteMany({ where: { user_id: { in: users } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    if (settingsBefore) await prisma.bastChatSettings.update({ where: { id: 1 }, data: { owner_user_id: settingsBefore.owner_user_id } });
    else await prisma.bastChatSettings.deleteMany({ where: { id: 1 } });
    await prisma.userPreference.deleteMany({ where: { user_id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the index and the lane', () => {
    it('the work index lists live projects with folders and open tasks with short ids, and no mail', async () => {
      as(oracle());
      const res = await indexGet(jreq('/api/oracle/work-index', 'GET'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { projects: { id: string; plan_folder: string | null; target_key: string }[]; tasks: { id: string; short_id: string; security: boolean }[]; session_links: unknown[] };
      const a = body.projects.find((p) => p.id === ids.alpha);
      expect(a).toMatchObject({ plan_folder: alpha, target_key: `project:${ids.alpha}` });
      expect(body.projects.some((p) => p.id === ids.finishedproj)).toBe(false); // a finished project is never listed
      const t = body.tasks.find((x) => x.id === ids['Hosting comparison']);
      expect(t?.short_id).toBe(shortIdOf(ids['Hosting comparison']));
      expect(body.tasks.find((x) => x.id === ids['Audit logins'])?.security).toBe(true);
      expect(body.tasks.some((x) => x.id === ids['Sabeens task'])).toBe(false); // another person's task is not offered
      expect(JSON.stringify(body)).not.toMatch(/@client\.test/);
    });

    it('only the oracle lane may call the session routes (another lane is refused, nothing is written)', async () => {
      const before = await snapshot();
      as(porter());
      await expect(indexGet(jreq('/api/oracle/work-index', 'GET'))).resolves.toMatchObject({ status: 403 });
      const res = await trackPost(jreq('/api/oracle/sessions/x/track', 'POST', { title: 'x', project_target: null, deliverables: [] }), sid('x'));
      expect(res.status).toBe(403);
      expect(await snapshot()).toEqual(before);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('links: a quiet attach, a wandering session, one question', () => {
    const wander = `wander-${tag}`;
    it('a session in a plan folder attaches quietly, and the same call again is the same link', async () => {
      await session(wander, { cwd: `${alpha}/app` });
      as(oracle());
      const res = await linksPost(jreq(`/api/oracle/sessions/${wander}/links`, 'POST', { propose: true, cwd: `${alpha}/app`, basis: 'plan_folder' }), sid(wander));
      expect(await res.json()).toMatchObject({ result: 'attached', target_key: `project:${ids.alpha}` });
      expect(await prisma.homeAction.count({ where: { user_id: adminId, action: 'work_attach' } })).toBeGreaterThan(0);
      const again = await linksPost(jreq(`/api/oracle/sessions/${wander}/links`, 'POST', { propose: true, cwd: `${alpha}/app` }), sid(wander));
      expect(await again.json()).toMatchObject({ result: 'already' });
      expect(await links(wander, 'active')).toHaveLength(1);
    });

    it('the same session working in a second project gets a second link (one per project it worked in)', async () => {
      as(oracle());
      const res = await linksPost(jreq(`/api/oracle/sessions/${wander}/links`, 'POST', { propose: true, cwd: `${beta}/site` }), sid(wander));
      expect(await res.json()).toMatchObject({ result: 'attached', target_key: `project:${ids.beta}` });
      const active = await links(wander, 'active');
      expect(active.map((l) => l.target_key).sort()).toEqual([`project:${ids.alpha}`, `project:${ids.beta}`].sort());
      const row = await prisma.oracleSession.findFirstOrThrow({ where: { external_id: wander } });
      expect(row.work_checked_at).not.toBeNull();
    });

    it('an unclear match is ONE question per session, with a link on each candidate, and asking again makes no second', async () => {
      const unsure = `unsure-${tag}`;
      await session(unsure, { cwd: `${root}/elsewhere` });
      as(oracle());
      const body = { propose: true, cwd: `${root}/elsewhere`, client_id: clientId };
      const r1 = (await (await linksPost(jreq(`/api/oracle/sessions/${unsure}/links`, 'POST', body), sid(unsure))).json()) as { result: string; candidates: { href: string }[] };
      expect(r1.result).toBe('proposed');
      expect(r1.candidates.length).toBeGreaterThanOrEqual(2);
      expect(r1.candidates.every((c) => c.href.startsWith('/projects/'))).toBe(true);
      await linksPost(jreq(`/api/oracle/sessions/${unsure}/links`, 'POST', body), sid(unsure));
      expect(await prisma.workLink.count({ where: { kind: 'session', ref: unsure, state: 'proposed' } })).toBe(1);
      // The owner sees the one question, with links.
      const { raw } = await screen();
      expect((raw.attach_questions ?? []).filter((q) => q.ref === unsure)).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('evidence: proof only for each project\'s own tasks, one card per session', () => {
    const wander = `wander-${tag}`;
    it('a wandering session gets proof for each project\'s own commits only', async () => {
      const hc = shortIdOf(ids['Hosting comparison']);
      const nl = shortIdOf(ids['Newsletter template']);
      const { res, body } = await postEvidence(wander, [
        commit(`${alpha}/app`, `Finish ${hc} hosting move`, 'aaaaaaa1'),
        commit(`${beta}/site`, `Ship ${nl} template`, 'bbbbbbb1'),
        // Project beta's folder naming a task of project alpha: no match (it is not in beta's segment).
        commit(`${beta}/site`, `Also ${hc} again`, 'bbbbbbb2'),
        // Medium: a title overlap on alpha's DNS task, no id.
        commit(`${alpha}/app`, 'Migrate DNS records for the site', 'aaaaaaa2'),
        // Outside the window and outside every folder.
        { ...commit(`${alpha}/app`, `Old ${hc}`, 'aaaaaaa3'), at: new Date(NOW.getTime() - 40 * DAY).toISOString() },
        commit(`${root}/elsewhere`, `Elsewhere ${hc}`, 'ccccccc1'),
      ]);
      expect(res.status).toBe(200);
      expect(body.outside_window).toBe(1);
      expect(body.unmatched).toBe(2); // the beta commit naming alpha's task, and the one in no linked folder
      const byTask = Object.fromEntries(body.proofs.map((p) => [p.task_id, p]));
      expect(byTask[ids['Hosting comparison']]).toMatchObject({ decision: 'card', strength: 'strong' });
      expect(byTask[ids['Newsletter template']]).toMatchObject({ decision: 'card', strength: 'strong' });
      expect(byTask[ids['Migrate DNS records']]).toMatchObject({ decision: 'note', strength: 'medium' });
      expect(byTask[ids['Unrelated chore']]).toBeUndefined();
      // Proof rows: the beta commit that named alpha's task wrote nothing for it.
      const rows = await prisma.workEvidence.findMany({ where: { session_id: wander, task_id: ids['Hosting comparison'] } });
      expect(rows.map((r) => r.ref)).toEqual([`aaaaaaa1@${alpha}/app`]);
      // A note on the medium task, no card; nothing for the no-proof task.
      expect(await prisma.workFinishedItem.count({ where: { user_id: adminId, task_id: ids['Migrate DNS records'] } })).toBe(0);
      const notes = await prisma.comment.findMany({ where: { task_id: ids['Migrate DNS records'], is_internal: true } });
      expect(notes).toHaveLength(1);
      expect(notes[0].content).not.toMatch(/[–—]/);
      expect(await prisma.comment.count({ where: { task_id: ids['Unrelated chore'] } })).toBe(0);
      expect(await prisma.workEvidence.count({ where: { task_id: ids['Unrelated chore'] } })).toBe(0);
    });

    it('reporting the same window again changes nothing (one card per session)', async () => {
      const hc = shortIdOf(ids['Hosting comparison']);
      const before = await prisma.workFinishedItem.count({ where: { user_id: adminId, run_key: sessionRunKey(wander) } });
      expect(before).toBe(2);
      const rows = await prisma.workEvidence.count({ where: { session_id: wander } });
      const w = window();
      const items = [commit(`${alpha}/app`, `Finish ${hc} hosting move`, 'aaaaaaa1')];
      const first = await postEvidence(wander, items, w);
      expect(first.body.duplicates).toBe(0); // a later `at`: a new commit moment is new proof, not a second card
      const same = await postEvidence(wander, items.map((i) => ({ ...i, at: (first.body as unknown as { proofs: unknown[] }) && i.at })), w);
      expect(same.res.status).toBe(200);
      expect(await prisma.workFinishedItem.count({ where: { user_id: adminId, run_key: sessionRunKey(wander) } })).toBe(2);
      expect(await prisma.workEvidence.count({ where: { session_id: wander } })).toBeGreaterThanOrEqual(rows);
    });

    it('a session with no links writes no proof', async () => {
      const lone = `lone-${tag}`;
      await session(lone);
      const before = await snapshot();
      const { body } = await postEvidence(lone, [commit(alpha, `Finish ${shortIdOf(ids['Hosting comparison'])}`, 'ddddddd1')]);
      expect(body).toMatchObject({ unlinked: true, written: 0 });
      expect((await snapshot()).evidence).toBe(before.evidence);
    });

    it('the card waits two hours while the session is open, shows at once when it ended, and there is one card per session', async () => {
      const w = wander;
      const hidden = await screen(adminId, NOW);
      expect(hidden.all.some((i) => i.key?.startsWith('finished:s-'))).toBe(false); // the in-session question comes first
      const later = new Date(NOW.getTime() + 3 * HOUR);
      const cards = await loadSessionFinishedCards(prisma, adminId, later);
      expect(cards).toHaveLength(1);
      expect(cards[0].rows.map((r) => r.task_id).sort()).toEqual([ids['Hosting comparison'], ids['Newsletter template']].sort());
      // A second session with its own proof is its own card, shown at once because it has ended.
      // The task names the file, so the delivered file is strong proof.
      await prisma.task.update({ where: { id: ids['Migrate DNS records'] }, data: { description: 'Write up migrate-dns-records.md for the client' } });
      const second = `second-${tag}`;
      await session(second, { status: 'ended', ended_at: new Date(), cwd: `${alpha}/app` });
      as(oracle());
      await linksPost(jreq(`/api/oracle/sessions/${second}/links`, 'POST', { target_key: `task:${ids['Migrate DNS records']}`, cwd: `${alpha}/app` }), sid(second));
      await postEvidence(second, [{ kind: 'delivered_file', ref: `${alpha}/migrate-dns-records.md`, at: at(2), path: `${alpha}/migrate-dns-records.md`, cwd: `${alpha}/app` }]);
      void w;
      const scr = await screen(adminId, later);
      const sessionCards = scr.all.filter((i) => i.key?.startsWith('finished:s-'));
      expect(sessionCards).toHaveLength(2);
      expect(sessionCards.every((c) => c.type === 'finished' && /^This session's work looks done/.test(c.title ?? ''))).toBe(true);
      // The ended session's card shows without waiting.
      const nowOnly = await screen(adminId, NOW);
      expect(nowOnly.all.filter((i) => i.key?.startsWith('finished:s-'))).toHaveLength(1);
    });

    it('another user sees no change (Sabeen has no session card)', async () => {
      const tech = await screen(techId, new Date(NOW.getTime() + 3 * HOUR));
      expect(tech.raw.session_finished ?? []).toHaveLength(0);
      expect(tech.all.some((i) => i.key?.startsWith('finished:s-'))).toBe(false);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('close-task: only on proof', () => {
    const wander = `wander-${tag}`;
    it('no proof answers 409 no_proof and changes nothing', async () => {
      const before = await snapshot();
      const r = await close(wander, 'Unrelated chore');
      // Linked (its project is linked) but no proof for it.
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'no_proof' });
      expect(await snapshot()).toEqual(before);
    });

    it('only title-overlap proof (a note) is not enough to close', async () => {
      const r = await close(wander, 'Migrate DNS records');
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'no_proof' });
      expect(await status('Migrate DNS records')).toBe('in_progress');
    });

    it('a task the session is not linked to answers 409 not_linked', async () => {
      const lone = `lone-${tag}`;
      const r = await close(lone, 'Hosting comparison');
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'not_linked' });
      expect(await status('Hosting comparison')).toBe('in_progress');
    });

    it('a security task answers 409 security always, even with recorded proof and a link', async () => {
      await prisma.workEvidence.create({ data: { target_key: `task:${ids['Audit logins']}`, task_id: ids['Audit logins'], project_id: ids.alpha, kind: 'commit', ref: 'sec@x', at: new Date(), line: 'Commit sec', source: 'session', session_id: wander, dedupe_key: `${tag}|sec` } });
      const r = await close(wander, 'Audit logins');
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'security' });
      const unlinked = await close(`lone-${tag}`, 'Audit logins');
      expect(unlinked.body).toMatchObject({ code: 'security' });
      expect(await status('Audit logins')).toBe('in_progress');
    });

    it('a task with an unticked checklist item answers 409 unticked', async () => {
      await prisma.workEvidence.create({ data: { target_key: `task:${ids['Update footer']}`, task_id: ids['Update footer'], project_id: ids.alpha, kind: 'commit', ref: 'foot@x', at: new Date(), line: 'Commit foot', source: 'session', session_id: wander, dedupe_key: `${tag}|foot` } });
      const r = await close(wander, 'Update footer');
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'unticked' });
      expect(await status('Update footer')).toBe('in_progress');
    });

    it('with a matching commit it closes, closes the linked email through Stage A, writes a Handled line, and Undo puts it back', async () => {
      const r = await close(wander, 'Hosting comparison');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ closed: true });
      expect(await status('Hosting comparison')).toBe('done');
      expect((await prisma.emailAsk.findUniqueOrThrow({ where: { message_id: `${tag}-ask` } })).state).not.toBe('open');
      const line = await prisma.homeAction.findFirstOrThrow({ where: { user_id: adminId, id: r.body.action_id as string } });
      expect(line.undo_until).not.toBeNull();
      expect(JSON.stringify(line.after)).not.toMatch(/[–—]/);
      // Both rows of the session's card for this task are answered; the other row stays.
      expect(await prisma.workFinishedItem.count({ where: { user_id: adminId, task_id: ids['Hosting comparison'], state: 'open' } })).toBe(0);
      expect(await prisma.workFinishedItem.count({ where: { user_id: adminId, task_id: ids['Newsletter template'], state: 'open' } })).toBe(1);
      const again = await close(wander, 'Hosting comparison');
      expect(again.body).toMatchObject({ closed: false, already_done: true });

      await runHomeUndo(prisma, adminId, line.id, NOW);
      expect(await status('Hosting comparison')).toBe('in_progress');
      expect((await prisma.emailAsk.findUniqueOrThrow({ where: { message_id: `${tag}-ask` } })).state).toBe('open');
    });

    it('a task assigned to another person answers 409 not_linked and stays open', async () => {
      await prisma.workEvidence.create({ data: { target_key: `task:${ids['Sabeens task']}`, task_id: ids['Sabeens task'], project_id: ids.alpha, kind: 'commit', ref: 'sab@x', at: new Date(), line: 'Commit sab', source: 'session', session_id: wander, dedupe_key: `${tag}|sab` } });
      const r = await close(wander, 'Sabeens task');
      expect(r.status).toBe(409);
      expect(await status('Sabeens task')).toBe('in_progress');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the card: a security row is never closed by the card, a main row closes on his tap with Undo', () => {
    it('a security task a session found proof for shows its proof, "close it yourself", and refuses a close from the card', async () => {
      const sec = `sec-${tag}`;
      await session(sec, { status: 'ended', ended_at: new Date(), cwd: `${alpha}/app` });
      as(oracle());
      await linksPost(jreq(`/api/oracle/sessions/${sec}/links`, 'POST', { target_key: `project:${ids.alpha}`, cwd: `${alpha}/app` }), sid(sec));
      const { body } = await postEvidence(sec, [commit(`${alpha}/app`, `Fix ${shortIdOf(ids['Audit logins'])} login audit`, 'eeeeeee1')]);
      expect(body.proofs.find((p) => p.task_id === ids['Audit logins'])).toMatchObject({ decision: 'card' });
      const scr = await screen(adminId, NOW);
      const card = scr.all.find((i) => i.finished?.rows.some((r) => r.task_id === ids['Audit logins']));
      const row = card?.finished?.rows.find((r) => r.task_id === ids['Audit logins']);
      expect(row).toMatchObject({ group: 'security', close_on_task_page: true });
      await expect(act({ action: 'finished_close_one', item_key: row!.key })).rejects.toBeTruthy();
      await expect(act({ action: 'finished_close', item_keys: [row!.key] })).rejects.toBeTruthy();
      expect(await status('Audit logins')).toBe('in_progress');
    });

    it('a main row closes on his tap through the card, and Undo restores it', async () => {
      const later = new Date(NOW.getTime() + 3 * HOUR);
      const scr = await screen(adminId, later);
      const card = scr.all.find((i) => i.finished?.rows.some((r) => r.task_id === ids['Newsletter template']));
      const row = card?.finished?.rows.find((r) => r.task_id === ids['Newsletter template']);
      expect(row).toBeDefined();
      const res = await act({ action: 'finished_close', item_keys: [row!.key] }, later);
      expect(await status('Newsletter template')).toBe('done');
      await runHomeUndo(prisma, adminId, (res as { action_id: string }).action_id, later);
      expect(await status('Newsletter template')).toBe('in_progress');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('Track this? goes through the guard', () => {
    it('a session that carries work answers already_tracked and creates nothing, even if a machine says create_anyway', async () => {
      const before = await snapshot();
      as(oracle());
      const res = await trackPost(jreq(`/api/oracle/sessions/wander-${tag}/track`, 'POST', { title: 'Another thing', project_target: null, deliverables: [], create_anyway: true }), sid(`wander-${tag}`));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ already_tracked: true });
      expect((await snapshot()).count).toBe(before.count);
    });

    it('an unlinked session makes a task for the owner with the session attached, one Handled line, and Undo abandons it', async () => {
      const fresh = `fresh-${tag}`;
      await session(fresh, { cwd: `${root}/nowhere` });
      as(oracle());
      const res = await trackPost(jreq(`/api/oracle/sessions/${fresh}/track`, 'POST', { title: `Hosting plan ${tag}`, project_target: null, deliverables: [] }), sid(fresh));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: string; task_ids: string[]; action_id: string; target_key: string };
      expect(body.result).toBe('tracked');
      const t = await prisma.task.findUniqueOrThrow({ where: { id: body.task_ids[0] } });
      taskIds.push(t.id);
      expect(t).toMatchObject({ assignee_id: adminId, status: 'not_started', source: 'session', source_session_external_id: fresh });
      expect((await links(fresh, 'active')).map((l) => l.target_key)).toEqual([`task:${t.id}`]);
      // Asking again: the session now carries work.
      const again = await trackPost(jreq(`/api/oracle/sessions/${fresh}/track`, 'POST', { title: `Hosting plan ${tag}`, project_target: null, deliverables: [] }), sid(fresh));
      expect(await again.json()).toMatchObject({ already_tracked: true });
      await runHomeUndo(prisma, adminId, body.action_id, NOW);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('abandoned');
      expect(await links(fresh, 'active')).toHaveLength(0);
    });

    it('a named live project takes the deliverables as its tasks; a finished project is refused; several deliverables with no client and no project is refused', async () => {
      const s2 = `proj-${tag}`;
      await session(s2, { cwd: `${root}/nowhere2` });
      as(oracle());
      const ok = await trackPost(jreq(`/api/oracle/sessions/${s2}/track`, 'POST', { title: `Site pages ${tag}`, project_target: `project:${ids.beta}`, deliverables: [`Home page ${tag}`, `About page ${tag}`] }), sid(s2));
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { task_ids: string[]; project_id: string };
      expect(body.task_ids).toHaveLength(2);
      body.task_ids.forEach((i) => taskIds.push(i));
      expect(body.project_id).toBe(ids.beta);
      const fin = await trackPost(jreq(`/api/oracle/sessions/${s2}x/track`, 'POST', { title: 'x', project_target: `project:${ids.finishedproj}`, deliverables: [] }), sid(`${s2}x`));
      expect(fin.status).toBe(409);
      expect(await fin.json()).toMatchObject({ code: 'target_finished' });
      const s3 = `noclient-${tag}`;
      await session(s3, { cwd: `${root}/nowhere3` });
      const nc = await trackPost(jreq(`/api/oracle/sessions/${s3}/track`, 'POST', { title: 'Two things', project_target: null, deliverables: ['one', 'two'] }), sid(s3));
      expect(nc.status).toBe(409);
      expect(await nc.json()).toMatchObject({ code: 'no_client' });
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the worker keeps off work a live session has', () => {
    it('an attached running session makes the state with_mike_session, and an ended one does not', async () => {
      const st = await workState(prisma, `project:${ids.alpha}`);
      expect(st).toMatchObject({ state: 'with_mike_session', live_session: true });
      expect(st?.line).toMatch(/^With Mike in a session/);
      await prisma.oracleSession.updateMany({ where: { external_id: `wander-${tag}` }, data: { status: 'ended' } });
      await prisma.oracleSession.updateMany({ where: { external_id: { in: [`second-${tag}`, `sec-${tag}`] } }, data: { status: 'ended' } });
      const after = await workState(prisma, `project:${ids.alpha}`);
      expect(after?.live_session).toBe(false);
      expect(after?.state).not.toBe('with_mike_session');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the one-time clear of old parked questions', () => {
    const ask = (k: string, over: Record<string, unknown> = {}) => session(`${k}-${tag}`, { cwd: null, status: 'idle', waiting_on: `Which hosting plan? (${k})`, ask_severity: 'internal', last_event_at: ago(20), ...over });
    let runKey = '';

    it('seeds the parked questions (some protected)', async () => {
      await ask('old1');
      await ask('old2');
      await ask('oldblank', { ask_severity: null });
      await ask('clientb', { ask_severity: 'client_blocking' });
      await ask('launchb', { ask_severity: 'launch_blocking' });
      await ask('sectext', { waiting_on: 'The site was compromised: ok to rotate the keys?' });
      await ask('running', { status: 'running' });
      await ask('newer', { last_event_at: ago(2) });
      await ask('ended', { status: 'ended' });
      await ask('manual');
      const linked = `seclink-${tag}`;
      await ask('seclink');
      await prisma.workLink.create({ data: { target_key: `task:${ids['Audit logins']}`, task_id: ids['Audit logins'], project_id: ids.alpha, kind: 'session', ref: linked, attached_by: 'mike', state: 'active' } });
      await prisma.homeItemState.create({ data: { user_id: adminId, item_key: `session:manual-${tag}`, session_cleared_at: new Date(), session_cleared_hash: 'handmade' } as never });
      const owner = await loadSessionAsksFor(prisma, adminId);
      expect(owner.filter((a) => a.external_id.endsWith(tag) && /^(old1|old2)/.test(a.external_id)).length).toBe(2);
    });

    it('a dry run reports counts and writes NOTHING', async () => {
      const before = await snapshot();
      as(oracle());
      const res = await stalePost(jreq('/api/oracle/sessions/stale-asks', 'POST', { dry: true }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { dry: boolean; would_clear: number; cleared: number; kept: Record<string, number>; sample: { title: string }[] };
      expect(body).toMatchObject({ dry: true, would_clear: 3, cleared: 0 });
      expect(body.kept).toMatchObject({ client_blocking: 1, launch_blocking: 1, security: 2, live: 1, too_new: 1, ended_hidden: 1, already_cleared: 1 });
      expect(await snapshot()).toEqual(before);
    });

    it('the real run clears only the three, ledgers each first, writes one Handled line, and never touches the session record', async () => {
      const sessionsBefore = await prisma.oracleSession.findMany({ where: { external_id: { in: sessionIds } }, orderBy: { external_id: 'asc' }, select: { external_id: true, waiting_on: true, status: true, ask_severity: true, updated_at: true } });
      as(oracle());
      const res = await stalePost(jreq('/api/oracle/sessions/stale-asks', 'POST', { dry: false }));
      const body = (await res.json()) as { cleared: number; run_key: string; action_id: string };
      expect(body.cleared).toBe(3);
      runKey = body.run_key;
      expect(await prisma.workStaleAskClear.count({ where: { user_id: adminId, run_key: runKey, state: 'cleared' } })).toBe(3);
      const ledger = await prisma.workStaleAskClear.findMany({ where: { user_id: adminId } });
      expect(ledger.every((l) => l.ask_text.startsWith('Which hosting plan?'))).toBe(true);
      const shown = (await loadSessionAsksFor(prisma, adminId)).map((a) => a.external_id);
      for (const k of ['old1', 'old2', 'oldblank']) expect(shown).not.toContain(`${k}-${tag}`);
      // Protected ones stay on the screen.
      for (const k of ['clientb', 'launchb', 'sectext', 'seclink', 'running', 'newer']) expect(shown).toContain(`${k}-${tag}`);
      const line = await prisma.homeAction.findUniqueOrThrow({ where: { id: body.action_id } });
      expect(line.undo_until).not.toBeNull();
      expect(JSON.stringify(line.after)).toMatch(/Cleared 3 old session questions/);
      expect(JSON.stringify(line.after)).not.toMatch(/[–—]/);
      const sessionsAfter = await prisma.oracleSession.findMany({ where: { external_id: { in: sessionIds } }, orderBy: { external_id: 'asc' }, select: { external_id: true, waiting_on: true, status: true, ask_severity: true, updated_at: true } });
      expect(sessionsAfter).toEqual(sessionsBefore);
    });

    it('another user still sees every question (Sabeen is unchanged)', async () => {
      const shown = (await loadSessionAsksFor(prisma, techId)).map((a) => a.external_id);
      expect(shown).toContain(`old1-${tag}`);
    });

    it('a second run clears nothing more', async () => {
      as(oracle());
      const res = await stalePost(jreq('/api/oracle/sessions/stale-asks', 'POST', { dry: false }));
      expect(await res.json()).toMatchObject({ cleared: 0 });
    });

    it('Undo on the Handled line brings all three back', async () => {
      const line = await prisma.homeAction.findFirstOrThrow({ where: { user_id: adminId, action: 'work_stale_clear', undone_at: null } });
      await runHomeUndo(prisma, adminId, line.id, NOW);
      const shown = (await loadSessionAsksFor(prisma, adminId)).map((a) => a.external_id);
      for (const k of ['old1', 'old2', 'oldblank']) expect(shown).toContain(`${k}-${tag}`);
      expect(await prisma.workStaleAskClear.count({ where: { user_id: adminId, state: 'restored' } })).toBe(3);
    });

    it('a restored question is not cleared again the same day; restore by run key works later and leaves a mark the owner changed', async () => {
      as(oracle());
      const again = await stalePost(jreq('/api/oracle/sessions/stale-asks', 'POST', { dry: false }));
      expect(await again.json()).toMatchObject({ cleared: 0 });
      // Clear fresh ones under a new run key by pretending it is another day: write the ledger by hand is not needed; use older_than_days.
      await prisma.workStaleAskClear.deleteMany({ where: { user_id: adminId } });
      const redo = await stalePost(jreq('/api/oracle/sessions/stale-asks', 'POST', { dry: false }));
      expect(await redo.json()).toMatchObject({ cleared: 3 });
      // The owner changes the mark on one of them since.
      await prisma.homeItemState.updateMany({ where: { user_id: adminId, item_key: `session:old2-${tag}` }, data: { session_cleared_hash: 'changed-by-owner' } });
      const dry = await stalePost(jreq('/api/oracle/sessions/stale-asks', 'POST', { restore: runKey, dry: true }));
      expect(await dry.json()).toMatchObject({ dry: true, in_ledger: 3, restored: 2, left_as_is: 1 });
      expect((await loadSessionAsksFor(prisma, adminId)).map((a) => a.external_id)).not.toContain(`old1-${tag}`); // dry restored nothing
      const real = await stalePost(jreq('/api/oracle/sessions/stale-asks', 'POST', { restore: runKey }));
      expect(await real.json()).toMatchObject({ restored: 2, left_as_is: 1 });
      const shown = (await loadSessionAsksFor(prisma, adminId)).map((a) => a.external_id);
      expect(shown).toContain(`old1-${tag}`);
      expect(shown).toContain(`oldblank-${tag}`);
      expect((await prisma.homeItemState.findFirstOrThrow({ where: { user_id: adminId, item_key: `session:old2-${tag}` } })).session_cleared_hash).toBe('changed-by-owner'); // the owner's own mark stays
    });

    it('a NEW question from a cleared session shows again', async () => {
      await prisma.homeItemState.updateMany({ where: { user_id: adminId, item_key: `session:old1-${tag}` }, data: { session_cleared_at: new Date(), session_cleared_hash: (await import('@/lib/home/session-clear')).sessionAskHash('Which hosting plan? (old1)') } });
      expect((await loadSessionAsksFor(prisma, adminId)).map((a) => a.external_id)).not.toContain(`old1-${tag}`);
      await prisma.oracleSession.updateMany({ where: { external_id: `old1-${tag}` }, data: { waiting_on: 'A different question now' } });
      expect((await loadSessionAsksFor(prisma, adminId)).map((a) => a.external_id)).toContain(`old1-${tag}`);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('nothing is sent', () => {
    it('no mail row was made by any of it', async () => {
      expect(await prisma.emailOutbox.count({ where: { OR: [{ subject: { contains: tag } }, { created_at: { gte: ago(1) } }] } })).toBe(0);
    });
  });

  it('keeps the admin session working (the owner browser can call the same routes)', async () => {
    as(admin());
    const res = await indexGet(jreq('/api/oracle/work-index', 'GET'));
    expect(res.status).toBe(200);
  });
});
