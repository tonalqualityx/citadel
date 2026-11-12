// @vitest-environment node
/**
 * Work stage D against a real Postgres: the linking model and "never a second to-do", walked through the Thermalnetics case. The routes are
 * called as handlers with the sign-in mocked; the machine is not run, and Stage C's send door does not exist yet, so Bast's send is an
 * email_outbox row read by syncSendEvidence (TODO(stage-c): the door and /api/sends/record write the same rows). Skips unless DATABASE_URL
 * names the scratch Postgres on localhost:55433. It seeds its own rows and removes only those. Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/work_d_int npx vitest run lib/work/__tests__/stage-d.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(async () => auth.current),
}));

import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '@/lib/home/load';
import { loadItemStates } from '@/lib/home/state';
import { selectHome } from '@/lib/home/select';
import { runHomeAct, runHomeUndo } from '@/lib/home/act';
import { POST as tasksPost } from '@/app/api/tasks/route';
import { POST as sessionTasksPost } from '@/app/api/session-tasks/route';
import { POST as createTaskPost } from '@/app/api/email-asks/[id]/create-task/route';
import { GET as stateGet } from '@/app/api/work/[key]/state/route';
import { POST as attachPost } from '@/app/api/work/attach/route';
import { POST as evidencePost } from '@/app/api/work/evidence/route';
import { attachOrPropose } from '../attach-store';
import { attachSource } from '../links';
import { handledElsewhere } from '../guard';
import { syncSendEvidence } from '../evidence-writers';
import { keptOffNow } from '../home-guard';
import { workState } from '../state';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.skipIf(!SCRATCH)('Work stage D: the linking model (real database), the Thermalnetics case', () => {
  const tag = `wd-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const users = [adminId, techId];
  const acct = 'mike@becomeindelible.com';
  const ashlei = `ashlei-${tag}@thermal.test`;
  const kelly = `kelly-${tag}@thermal.test`;
  const planFolder = `/tmp/${tag}/thermalnetics-website`;
  let clientId = '';
  let settingsBefore: { owner_user_id: string | null } | null = null;
  const ids: Record<string, string> = {};
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  const sessionIds: string[] = [];
  let machineId = '';

  const admin = () => ({ userId: adminId, email: `admin-${tag}@example.test`, role: 'admin', via: 'session' });
  const porter = () => ({ userId: adminId, email: `bast-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'porter' });
  const as = (a: unknown) => {
    auth.current = a;
  };
  const jreq = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  const project = async (k: string, over: Record<string, unknown> = {}) => {
    const p = await prisma.project.create({ data: { name: `${k} ${tag}`, status: 'in_progress', type: 'project', client_id: clientId, ...over } as never });
    ids[k] = p.id;
    projectIds.push(p.id);
    return p;
  };
  const task = async (k: string, over: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${k} ${tag}`, status: 'in_progress', assignee_id: techId, client_id: clientId, tags: [], ...over } as never });
    ids[k] = t.id;
    taskIds.push(t.id);
    return t;
  };
  const ask = (k: string, over: Record<string, unknown> = {}) =>
    prisma.emailAsk.create({
      data: {
        message_id: `${tag}-${k}`, thread_id: `${tag}-th-${k}`, account: acct, from_name: k.startsWith('k') ? 'Kelly Park' : 'Ashlei Moore', from_email: k.startsWith('k') ? kelly : ashlei,
        subject: `Thermalnetics ${k}`, gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', client_id: clientId, received_at: ago(2),
        conversation_key: `${tag}-conv-${k}`, rfc_message_id: `${tag}-rfc-${k}`, disposition: 'reply_mike',
        deep_link: `https://mail.google.com/mail/u/0/#all/${tag}-${k}`, ...over,
      } as never,
    });
  const row = (k: string) => prisma.emailAsk.findUniqueOrThrow({ where: { message_id: `${tag}-${k}` } });
  const screen = async (userId = adminId) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, NOW, { timezone: TZ }), loadItemStates(prisma, userId)]);
    return { raw, sel: selectHome({ raw, states, now: NOW }) };
  };
  const inThreads = async (k: string) => (await screen()).raw.threads.some((t) => t.asks.some((a) => a.message_id === `${tag}-${k}`));
  const onScreen = async (k: string) => (await screen()).sel.sections.mail.some((i) => i.key === `thread:${acct}:${tag}-th-${k}`);
  const act = (req: Parameters<typeof runHomeAct>[2]) => runHomeAct(prisma, adminId, req, { now: NOW, timezone: TZ, date: NOW.toISOString().slice(0, 10) });
  const links = (kind: string, ref: string) => prisma.workLink.findMany({ where: { kind, ref }, orderBy: { created_at: 'asc' } });
  const taskCount = () => prisma.task.count({ where: { OR: [{ client_id: clientId }, { id: { in: taskIds } }] } });
  const snapshot = async () => ({
    asks: await prisma.emailAsk.findMany({ where: { message_id: { startsWith: tag } }, orderBy: { message_id: 'asc' }, select: { message_id: true, state: true, closed_reason: true, closed_at: true } }),
    tasks: (await prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' }, select: { id: true, status: true, is_deleted: true } })),
    projects: await prisma.project.findMany({ where: { id: { in: projectIds } }, orderBy: { id: 'asc' }, select: { id: true, status: true, is_deleted: true } }),
    outbox: await prisma.emailOutbox.count({ where: { subject: { contains: tag } } }),
  });

  beforeAll(async () => {
    settingsBefore = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin WD', role: 'admin' },
        { id: techId, email: `sabeen-${tag}@example.test`, password_hash: 'x', name: 'Sabeen WD', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({ data: [{ user_id: adminId, home_view: 'home', timezone: TZ }, { user_id: techId, home_view: 'overlook', timezone: TZ }] });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, create: { id: 1, owner_user_id: adminId }, update: { owner_user_id: adminId } });
    clientId = (await prisma.client.create({ data: { name: `Thermalnetics ${tag}`, status: 'active' } })).id;
    await prisma.clientContact.createMany({ data: [{ client_id: clientId, name: 'Ashlei Moore', email: ashlei }, { client_id: clientId, name: 'Kelly Park', email: kelly }] as never });
    await project('website', { plan_folder: planFolder });
    await project('hosting');
    await project('oldrebuild', { status: 'done', completed_date: ago(60) });
    await project('dropped', { status: 'cancelled' });
    const m = await prisma.oracleMachine.create({ data: { name: `m-${tag}`, hostname: `h-${tag}` } as never });
    machineId = m.id;
  });

  afterAll(async () => {
    const made = await prisma.task.findMany({ where: { OR: [{ client_id: clientId }, { id: { in: taskIds } }] }, select: { id: true } });
    const all = [...new Set([...made.map((t) => t.id), ...taskIds])];
    const allProjects = [...new Set([...(await prisma.project.findMany({ where: { client_id: clientId }, select: { id: true } })).map((p) => p.id), ...projectIds])];
    const targets = [...all.map((i) => `task:${i}`), ...allProjects.map((i) => `project:${i}`)];
    await prisma.workEvidence.deleteMany({ where: { target_key: { in: targets } } });
    await prisma.workLink.deleteMany({ where: { OR: [{ target_key: { in: targets } }, { ref: { contains: tag } }] } });
    await prisma.emailAsk.deleteMany({ where: { message_id: { startsWith: tag } } });
    await prisma.emailOutbox.deleteMany({ where: { OR: [{ task_id: { in: all } }, { subject: { contains: tag } }] } });
    await prisma.taskReceipt.deleteMany({ where: { task_id: { in: all } } });
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
    await prisma.clientContact.deleteMany({ where: { client_id: clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    if (settingsBefore) await prisma.bastChatSettings.update({ where: { id: 1 }, data: { owner_user_id: settingsBefore.owner_user_id } });
    else await prisma.bastChatSettings.deleteMany({ where: { id: 1 } });
    await prisma.userPreference.deleteMany({ where: { user_id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the walk', () => {
    let before: Awaited<ReturnType<typeof snapshot>>;

    it('1. the first thread, already carried by an open task in the website project, attaches with no question and no new row', async () => {
      await task('T1', { project_id: ids.website, title: `Move hosting ${tag}` });
      await ask('a1', { task_id: ids.T1 }); // Stage A's field: the conversation already belongs to T1
      before = await snapshot();
      as(porter());
      const res = await attachPost(jreq('/api/work/attach', 'POST', { kind: 'email', ref: `${tag}-conv-a1`, label: 'Ashlei Moore: Thermalnetics a1', propose: true }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ result: 'already', target_key: `task:${ids.T1}` });
      const l = await links('email', `${tag}-conv-a1`);
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ state: 'active', task_id: ids.T1, project_id: ids.website, attached_by: 'intake', basis: 'same_conversation' });
      expect(await inThreads('a1')).toBe(false);
    });

    it('2. a second thread from another person: ONE question with a link on each live candidate, never the finished projects', async () => {
      await ask('k1');
      as(porter());
      const res = await attachPost(jreq('/api/work/attach', 'POST', { kind: 'email', ref: `${tag}-conv-k1`, label: 'Kelly Park: Thermalnetics k1', propose: true }));
      const body = await res.json();
      expect(body.result).toBe('proposed');
      const keys = body.candidates.map((c: { target_key: string }) => c.target_key).sort();
      expect(keys).toEqual([`project:${ids.hosting}`, `project:${ids.website}`].sort());
      expect(keys).not.toContain(`project:${ids.oldrebuild}`);
      expect(keys).not.toContain(`project:${ids.dropped}`);
      // asking again changes nothing: still one question row
      await attachPost(jreq('/api/work/attach', 'POST', { kind: 'email', ref: `${tag}-conv-k1`, propose: true }));
      expect(await prisma.workLink.count({ where: { kind: 'email', ref: `${tag}-conv-k1`, target_key: 'proposed', state: 'proposed' } })).toBe(1);

      const s = await screen();
      const q = s.raw.attach_questions ?? [];
      expect(q).toHaveLength(1);
      expect(q[0].title).toBe(`New email from Kelly Park (Thermalnetics ${tag}): add to "hosting ${tag}" or "website ${tag}", or start a new project?`);
      expect(q[0].candidates.map((c) => c.href).sort()).toEqual([`/projects/${ids.hosting}`, `/projects/${ids.website}`].sort());
      expect(q[0].can_new_project).toBe(true);
      expect(q[0].can_task).toBe(false); // one_deliverable was not sent: a multi-step item is a project
      const item = s.sel.sections.next.concat(s.sel.sections.needs_you_now, s.sel.sections.mail).find((i) => i.type === 'attach');
      expect(item?.attach?.candidates).toHaveLength(2);
      expect(item?.attach?.can_new_project).toBe(true);
      expect(await onScreen('k1')).toBe(true); // nothing is attached until he answers: the mail row is still his
    });

    it('3. his choice attaches the second thread to the project, writes Undo, and the mail leaves his list', async () => {
      const q = (await screen()).raw.attach_questions?.[0];
      const r = await act({ action: 'attach_choose', item_key: `attach:${q?.link_id}`, choice: `project:${ids.website}` });
      expect(r.ok).toBe(true);
      expect(r.undo_until).not.toBeNull();
      const l = await links('email', `${tag}-conv-k1`);
      expect(l.find((x) => x.state === 'active')).toMatchObject({ target_key: `project:${ids.website}`, project_id: ids.website, task_id: null, attached_by: 'mike' });
      expect((await row('k1')).project_id).toBe(ids.website);
      expect(await inThreads('k1')).toBe(false);
      const s = await screen();
      expect(s.raw.handled_elsewhere).toContain(`thread:${acct}:${tag}-th-k1`);
      expect(s.raw.kept_off ?? 0).toBeGreaterThanOrEqual(1);
      expect((s.raw.attach_questions ?? []).length).toBe(0);
    });

    it('4. Undo of the answer puts everything back: the question returns, the stamp goes, the mail is his again', async () => {
      const act1 = await prisma.homeAction.findFirstOrThrow({ where: { user_id: adminId, action: 'attach_choose', undone_at: null }, orderBy: { created_at: 'desc' } });
      await runHomeUndo(prisma, adminId, act1.id, NOW);
      expect((await row('k1')).project_id).toBeNull();
      expect(await inThreads('k1')).toBe(true);
      expect(await prisma.workLink.count({ where: { kind: 'email', ref: `${tag}-conv-k1`, state: 'active' } })).toBe(0);
      const q = (await screen()).raw.attach_questions ?? [];
      expect(q).toHaveLength(1);
      // He answers again, and this time keeps it.
      const r = await act({ action: 'attach_choose', item_key: `attach:${q[0].link_id}`, choice: `project:${ids.website}` });
      expect(r.ok).toBe(true);
      expect(await inThreads('k1')).toBe(false);
    });

    it('5. a session in the project plan folder attaches quietly, with a Handled line and Undo', async () => {
      const ext = `${tag}-sess-1`;
      sessionIds.push(ext);
      await prisma.oracleSession.create({ data: { machine_id: machineId, external_id: ext, source: 'claude_code', title: `Fix hosting ${tag}`, cwd: `${planFolder}/app`, status: 'running', last_event_at: NOW, started_at: ago(1) } as never });
      as(porter());
      const res = await attachPost(jreq('/api/work/attach', 'POST', { kind: 'session', ref: ext, label: `Fix hosting ${tag}`, propose: true, cwd: `${planFolder}/app` }));
      const body = await res.json();
      expect(body).toMatchObject({ result: 'attached', target_key: `project:${ids.website}` });
      expect(body.action_id).toBeTruthy();
      const lines = (await screen()).sel.sections.handled;
      const line = lines.find((l) => /Added the session/.test(l.text));
      expect(line?.text).toBe(`Added the session "Fix hosting ${tag}" to "website ${tag}".`);
      expect(line?.undo_action_id).toBe(body.action_id);
      // Undo detaches it.
      await runHomeUndo(prisma, adminId, body.action_id, NOW);
      expect((await links('session', ext))[0].state).toBe('detached');
      // Attached again (same quiet rule), for the rest of the walk.
      const again = await attachOrPropose(prisma, { kind: 'session', ref: ext, propose: true, cwd: `${planFolder}/app`, attached_by: 'intake' });
      expect(again.result).toBe('attached');
    });

    it("6. Bast's send attaches to the task it names and is recorded as evidence (read from email_outbox until Stage C)", async () => {
      const sent = await prisma.emailOutbox.create({ data: { to: 'ashlei@thermal.test', subject: `Preview ${tag}`, text: '[sent; body removed]', from_account: 'bast@becomeindelible.com', kind: 'other', task_id: ids.T1, sent_at: ago(1), message_id: `${tag}-gm` } as never });
      expect(await syncSendEvidence(prisma, ago(3))).toBeGreaterThanOrEqual(1);
      expect(await syncSendEvidence(prisma, ago(3))).toBeGreaterThanOrEqual(1); // again: idempotent
      const l = await links('send', sent.id);
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ target_key: `task:${ids.T1}`, project_id: ids.website, state: 'active' });
      expect(await prisma.workEvidence.count({ where: { kind: 'send', ref: sent.id } })).toBe(1);
    });

    it('7. a new email on a conversation whose task is open becomes no row, and a task request for it answers already_tracked', async () => {
      await ask('a1b', { conversation_key: `${tag}-conv-a1`, rfc_message_id: `${tag}-rfc-a1b`, received_at: ago(0.1) });
      expect(await inThreads('a1b')).toBe(false);
      expect(await onScreen('a1b')).toBe(false);
      const h = await handledElsewhere(prisma, { kind: 'email', ref: `${tag}-conv-a1` });
      expect(h).toMatchObject({ target_key: `task:${ids.T1}`, state: 'open' });

      const n = await taskCount();
      // The chat or a machine asks for a task: 200 already_tracked with the link, nothing created.
      as(porter());
      const res = await tasksPost(jreq('/api/tasks', 'POST', { title: `Another task ${tag}`, assignee_id: adminId, client_id: clientId, source: 'email', source_ref: `${tag}-a1b`, source_key: `email:${tag}-conv-a1`, create_anyway: true }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ already_tracked: true, target_key: `task:${ids.T1}`, href: `/tasks/${ids.T1}` });
      expect(body.task.id).toBe(ids.T1);
      expect(await taskCount()).toBe(n); // a machine lane's create_anyway is not honoured
      // The create-task button on the mail answers the same.
      as(admin());
      const a1b = await row('a1b');
      const res2 = await createTaskPost(jreq(`/api/email-asks/${a1b.id}/create-task`, 'POST', {}), { params: Promise.resolve({ id: a1b.id }) });
      expect(res2.status).toBe(200);
      expect((await res2.json()).already_tracked).toBe(true);
      expect(await taskCount()).toBe(n);
      // The source seen again is evidence, once.
      expect(await prisma.workEvidence.count({ where: { target_key: `task:${ids.T1}`, kind: 'their_message' } })).toBeGreaterThanOrEqual(1);
    });

    it('8. a session attached to the project answers already_tracked on a session task; the owner override creates it', async () => {
      const ext = `${tag}-sess-1`;
      const n = await taskCount();
      as(admin());
      const res = await sessionTasksPost(jreq('/api/session-tasks', 'POST', { session_external_id: ext, title: `Park this ${tag}`, client_id: clientId, assignee_id: adminId }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ already_tracked: true, target_key: `project:${ids.website}` });
      expect(body.project).toMatchObject({ id: ids.website, href: `/projects/${ids.website}` });
      expect(await taskCount()).toBe(n);
      const over = await sessionTasksPost(jreq('/api/session-tasks', 'POST', { session_external_id: ext, title: `Park this ${tag}`, client_id: clientId, assignee_id: adminId, create_anyway: true }));
      expect(over.status).toBe(201);
      expect(await taskCount()).toBe(n + 1);
      // a client_blocking ask is never answered already_tracked
      const urgent = await sessionTasksPost(jreq('/api/session-tasks', 'POST', { session_external_id: ext, title: `Blocking ${tag}`, client_id: clientId, assignee_id: adminId, severity: 'client_blocking' }));
      expect(urgent.status).toBe(201);
    });

    it('9. the owner override on POST /api/tasks creates the task', async () => {
      as(admin());
      const n = await taskCount();
      const res = await tasksPost(jreq('/api/tasks', 'POST', { title: `Anyway ${tag}`, assignee_id: adminId, client_id: clientId, source_key: `email:${tag}-conv-a1`, create_anyway: true }));
      expect(res.status).toBe(201);
      expect(await taskCount()).toBe(n + 1);
    });

    it('10. a done project is never a candidate and never a target; a finished project never carries a source with newer activity', async () => {
      await ask('a3');
      const out = await attachOrPropose(prisma, { kind: 'email', ref: `${tag}-conv-a3`, propose: true, attached_by: 'intake' });
      expect(out.result).toBe('proposed');
      if (out.result === 'proposed') expect(out.candidates.map((c) => c.target_key)).not.toContain(`project:${ids.oldrebuild}`);
      as(porter());
      const refused = await attachPost(jreq('/api/work/attach', 'POST', { kind: 'email', ref: `${tag}-conv-a3`, target_key: `project:${ids.oldrebuild}` }));
      expect(refused.status).toBe(409);
      expect((await refused.json()).code).toBe('target_finished');
      const refusedDropped = await attachPost(jreq('/api/work/attach', 'POST', { kind: 'email', ref: `${tag}-conv-a3`, target_key: `project:${ids.dropped}` }));
      expect(refusedDropped.status).toBe(409);
      // A source on a done project, with mail newer than the finish: not handled. Older than the finish: handled.
      await prisma.workLink.create({ data: { target_key: `project:${ids.oldrebuild}`, project_id: ids.oldrebuild, kind: 'email', ref: `${tag}-conv-old`, attached_by: 'auto', state: 'active' } });
      await ask('old1', { conversation_key: `${tag}-conv-old`, received_at: ago(90) });
      expect(await handledElsewhere(prisma, { kind: 'email', ref: `${tag}-conv-old` })).toMatchObject({ state: 'done', target_key: `project:${ids.oldrebuild}` });
      await ask('old2', { conversation_key: `${tag}-conv-old`, rfc_message_id: `${tag}-rfc-old2`, received_at: ago(1) });
      expect(await handledElsewhere(prisma, { kind: 'email', ref: `${tag}-conv-old` })).toBeNull();
    });

    it('11. urgent mail and a security-tagged task are never hidden by the guard', async () => {
      await task('SEC', { title: `Security fix ${tag}`, tags: ['security'] });
      await ask('s1');
      await attachSource(prisma, { kind: 'email', ref: `${tag}-conv-s1`, target_key: `task:${ids.SEC}`, attached_by: 'mike', move: true });
      expect(await handledElsewhere(prisma, { kind: 'email', ref: `${tag}-conv-s1` })).toBeNull();
      await ask('u1', { is_urgent: true });
      await attachSource(prisma, { kind: 'email', ref: `${tag}-conv-u1`, target_key: `task:${ids.T1}`, attached_by: 'mike', move: true });
      expect(await handledElsewhere(prisma, { kind: 'email', ref: `${tag}-conv-u1` })).toBeNull();
      const s = await screen();
      expect(s.raw.crises.some((c) => c.message_id === `${tag}-u1`)).toBe(true); // loaded without the guard
      // a security-tagged create request is never answered already_tracked
      as(porter());
      const n = await taskCount();
      const res = await tasksPost(jreq('/api/tasks', 'POST', { title: `Sec again ${tag}`, assignee_id: adminId, client_id: clientId, tags: ['security'], source_key: `email:${tag}-conv-a1` }));
      expect(res.status).toBe(201);
      expect(await taskCount()).toBe(n + 1);
    });

    it('11b. a NEW security report email on a conversation attached to ordinary open work is still filed (task and project)', async () => {
      // The real path of the security-report lane: source email + source_ref/source_rfc (no source_key) and the security-report tag.
      // Own asks, so the shared walk (the measures count in 16) is not disturbed.
      as(porter());
      await ask('sx1');
      await attachSource(prisma, { kind: 'email', ref: `${tag}-conv-sx1`, target_key: `task:${ids.T1}`, attached_by: 'mike', move: true });
      const n = await taskCount();
      const plain = { assignee_id: adminId, client_id: clientId, source: 'email', source_ref: `${tag}-sx1`, source_rfc: `${tag}-rfc-sx1` };
      // control: without the tag, and with a machine create_anyway, the conversation attached to the ordinary task T1 is answered already_tracked
      const control = await tasksPost(jreq('/api/tasks', 'POST', { ...plain, title: `Plain ${tag}`, create_anyway: true }));
      expect(control.status).toBe(200);
      expect((await control.json()).already_tracked).toBe(true);
      expect(await taskCount()).toBe(n);
      // the same conversation on a live PROJECT, control first
      await ask('sp1');
      await attachSource(prisma, { kind: 'email', ref: `${tag}-conv-sp1`, target_key: `project:${ids.website}`, attached_by: 'mike', move: true });
      const ctl = await tasksPost(jreq('/api/tasks', 'POST', { assignee_id: adminId, client_id: clientId, source: 'email', source_ref: `${tag}-sp1`, title: `Plain proj ${tag}` }));
      expect(ctl.status).toBe(200);
      expect((await ctl.json()).target_key).toBe(`project:${ids.website}`);
      expect(await taskCount()).toBe(n);
      // with a security tag (any case, either tag) it is created, on the task conversation and on the project conversation
      let made = 0;
      for (const t of ['security-report', 'Security-Report', 'security', 'SECURITY']) {
        const res = await tasksPost(jreq('/api/tasks', 'POST', { ...plain, title: `WPMU security report ${t} ${tag}`, tags: [t] }));
        expect(res.status).toBe(201);
        expect((await res.json()).already_tracked).toBeUndefined();
        made += 1;
      }
      const sec = await tasksPost(jreq('/api/tasks', 'POST', { assignee_id: adminId, client_id: clientId, source: 'email', source_ref: `${tag}-sp1`, title: `Security on project ${tag}`, tags: ['security-report'] }));
      expect(sec.status).toBe(201);
      expect(await taskCount()).toBe(n + made + 1);
    });

    it('12. the state of the project: one line, everything attached with its date, evidence', async () => {
      as(admin());
      const res = await stateGet(jreq(`/api/work/project:${ids.website}/state`, 'GET'), { params: Promise.resolve({ key: `project:${ids.website}` }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ type: 'project', id: ids.website, status: 'in_progress' });
      expect(body.state).toBe('with_sabeen');
      expect(body.line).toMatch(/^With Sabeen since [A-Z][a-z]{2} \d{1,2}$/);
      const kinds = body.attached.map((a: { kind: string }) => a.kind);
      const emailRefs = body.attached.filter((a: { kind: string }) => a.kind === 'email').map((a: { ref: string }) => a.ref);
      expect(emailRefs).toEqual(expect.arrayContaining([`${tag}-conv-a1`, `${tag}-conv-k1`])); // the two threads: one by way of T1, one by his choice
      expect(kinds).toContain('session');
      expect(kinds).toContain('send');
      expect(body.attached.every((a: { line: string }) => /: [A-Z][a-z]{2} \d{1,2}: /.test(a.line))).toBe(true);
      expect(body.evidence.some((e: { kind: string }) => e.kind === 'send')).toBe(true);
      expect(body.live_session).toBe(true);
      // the task answers too, and the lane route for the worker's gate
      const t = await workState(prisma, `task:${ids.T1}`);
      expect(t?.state).toBe('with_sabeen');
      expect(t?.attached.map((a) => a.kind)).toEqual(expect.arrayContaining(['email', 'send']));
      as({ userId: adminId, email: 'x', role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'wright' });
      const denied = await stateGet(jreq(`/api/work/project:${ids.website}/state`, 'GET'), { params: Promise.resolve({ key: `project:${ids.website}` }) });
      expect(denied.status).toBe(403);
    });

    it('13. the task card shows the state line and what is attached to it', async () => {
      const s = await screen();
      // T1 is Sabeen's, so not on his plate; give the owner a task of his own with a session attached.
      expect(s.raw.tasks.find((t) => t.id === ids.T1)).toBeUndefined();
      await task('MINE', { assignee_id: adminId, project_id: ids.website, title: `Owner task ${tag}` });
      await attachSource(prisma, { kind: 'session', ref: `${tag}-sess-1`, target_key: `task:${ids.MINE}`, attached_by: 'mike' });
      const s2 = await screen();
      const t = s2.raw.tasks.find((x) => x.id === ids.MINE);
      expect(t?.work_line).toMatch(/^With Admin since/);
      expect(t?.attached?.length).toBeGreaterThanOrEqual(1);
      const item = s2.sel.byKey.get(`task:${ids.MINE}`)?.item;
      expect(item?.work_line).toMatch(/^With Admin since/);
    });

    it('14. nothing was closed, deleted or sent by any of it', async () => {
      const after = await snapshot();
      for (const a of after.asks) expect(a.closed_reason).toBeNull();
      for (const a of after.asks) expect(a.state).toBe('open');
      for (const t of before.tasks) {
        const now = after.tasks.find((x) => x.id === t.id);
        expect(now).toMatchObject({ status: t.status, is_deleted: false });
      }
      for (const p of before.projects) expect(after.projects.find((x) => x.id === p.id)).toMatchObject({ status: p.status, is_deleted: false });
      expect(after.outbox).toBe(before.outbox + 1); // only the one row the test itself wrote
      expect(await prisma.emailOutbox.count({ where: { sent_at: null, subject: { contains: tag } } })).toBe(0);
    });

    it("15. another user's screen is unchanged", async () => {
      const s = await screen(techId);
      expect(s.raw.attach_questions).toBeUndefined();
      expect(s.raw.handled_elsewhere).toBeUndefined();
      expect(s.raw.kept_off).toBeUndefined();
      expect(s.sel.sections.handled.some((l) => /Added the/.test(l.text))).toBe(false);
    });

    it('16. the measures number counts what the guard keeps off his list', async () => {
      expect(await keptOffNow(prisma)).toBeGreaterThanOrEqual(2);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the answers: a new project, a task, not work; each with Undo', () => {
    it('New project makes a live project with the source attached, and Undo cancels it and un-attaches', async () => {
      await ask('n1');
      await attachOrPropose(prisma, { kind: 'email', ref: `${tag}-conv-n1`, propose: true, candidates: [`project:${ids.hosting}`], attached_by: 'intake' });
      const q = (await screen()).raw.attach_questions?.find((x) => x.ref === `${tag}-conv-n1`);
      expect(q).toBeDefined();
      const projectsBefore = await prisma.project.count({ where: { client_id: clientId } });
      const r = await act({ action: 'attach_choose', item_key: `attach:${q?.link_id}`, choice: 'new_project' });
      const made = await prisma.project.findFirstOrThrow({ where: { client_id: clientId, name: { contains: 'Thermalnetics n1' } } });
      projectIds.push(made.id);
      expect(await prisma.project.count({ where: { client_id: clientId } })).toBe(projectsBefore + 1);
      expect(made.status).toBe('in_progress');
      expect((await links('email', `${tag}-conv-n1`)).find((l) => l.state === 'active')?.target_key).toBe(`project:${made.id}`);
      await runHomeUndo(prisma, adminId, r.action_id, NOW);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: made.id } })).status).toBe('cancelled');
      expect(await prisma.workLink.count({ where: { kind: 'email', ref: `${tag}-conv-n1`, state: 'active' } })).toBe(0);
      expect((await row('n1')).project_id).toBeNull();
    });

    it('Just a task is offered only when the source names one deliverable, makes a task of his with the source attached, and Undo abandons it', async () => {
      await ask('t1');
      await attachOrPropose(prisma, { kind: 'email', ref: `${tag}-conv-t1`, propose: true, one_deliverable: true, attached_by: 'intake' });
      const q = (await screen()).raw.attach_questions?.find((x) => x.ref === `${tag}-conv-t1`);
      expect(q?.can_task).toBe(true);
      const r = await act({ action: 'attach_choose', item_key: `attach:${q?.link_id}`, choice: 'task' });
      const link = (await links('email', `${tag}-conv-t1`)).find((l) => l.state === 'active');
      expect(link?.target_key).toMatch(/^task:/);
      const tid = (link?.target_key ?? '').slice(5);
      taskIds.push(tid);
      expect(await prisma.task.findUniqueOrThrow({ where: { id: tid } })).toMatchObject({ status: 'not_started', assignee_id: adminId });
      expect((await row('t1')).task_id).toBe(tid);
      await runHomeUndo(prisma, adminId, r.action_id, NOW);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: tid } })).status).toBe('abandoned');
      const ask1 = await row('t1');
      expect(ask1.task_id).toBeNull();
      expect(ask1.state).toBe('open'); // un-stamped first, so ending the task closed nothing
    });

    it('a task answer without one deliverable, and an answer that was not offered, are refused', async () => {
      await ask('t2');
      await attachOrPropose(prisma, { kind: 'email', ref: `${tag}-conv-t2`, propose: true, attached_by: 'intake' });
      const q = (await screen()).raw.attach_questions?.find((x) => x.ref === `${tag}-conv-t2`);
      await expect(act({ action: 'attach_choose', item_key: `attach:${q?.link_id}`, choice: 'task' })).rejects.toMatchObject({ statusCode: 409 });
      await expect(act({ action: 'attach_choose', item_key: `attach:${q?.link_id}`, choice: `project:${ids.oldrebuild}` })).rejects.toMatchObject({ statusCode: 409 });
      await expect(act({ action: 'attach_choose', item_key: `attach:${randomUUID()}`, choice: 'not_work' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('Not work leaves the mail as it was, is never asked again, and Undo brings the question back', async () => {
      const q = (await screen()).raw.attach_questions?.find((x) => x.ref === `${tag}-conv-t2`);
      const r = await act({ action: 'attach_choose', item_key: `attach:${q?.link_id}`, choice: 'not_work' });
      expect(await inThreads('t2')).toBe(true);
      const again = await attachOrPropose(prisma, { kind: 'email', ref: `${tag}-conv-t2`, propose: true, attached_by: 'intake' });
      expect(again.result).toBe('dismissed');
      await runHomeUndo(prisma, adminId, r.action_id, NOW);
      expect((await screen()).raw.attach_questions?.some((x) => x.ref === `${tag}-conv-t2`)).toBe(true);
    });

    it("a session's folder choice is remembered: the next session in that folder attaches quietly (prior_choice), and Undo forgets it", async () => {
      const folder = `/tmp/${tag}/elsewhere`;
      const mk = async (ext: string) => {
        sessionIds.push(ext);
        await prisma.oracleSession.create({ data: { machine_id: machineId, external_id: ext, source: 'claude_code', title: `Session ${ext}`, cwd: `${folder}/sub`, status: 'running', last_event_at: NOW, started_at: ago(1) } as never });
      };
      await mk(`${tag}-sess-f1`);
      await mk(`${tag}-sess-f2`);
      const out = await attachOrPropose(prisma, { kind: 'session', ref: `${tag}-sess-f1`, propose: true, client_id: clientId, attached_by: 'bast' });
      expect(out.result).toBe('proposed'); // the client has live projects, none matches the folder: a question, not a guess
      const q = (await screen()).raw.attach_questions?.find((x) => x.ref === `${tag}-sess-f1`);
      const r = await act({ action: 'attach_choose', item_key: `attach:${q?.link_id}`, choice: `project:${ids.hosting}` });
      const fl = await prisma.workLink.findMany({ where: { kind: 'folder', ref: `${folder}/sub`, state: 'active' } });
      expect(fl).toHaveLength(1);
      expect(fl[0]).toMatchObject({ target_key: `project:${ids.hosting}`, attached_by: 'mike' });
      const next = await attachOrPropose(prisma, { kind: 'session', ref: `${tag}-sess-f2`, propose: true, attached_by: 'bast' });
      expect(next).toMatchObject({ result: 'attached', target_key: `project:${ids.hosting}` });
      await runHomeUndo(prisma, adminId, r.action_id, NOW);
      expect(await prisma.workLink.count({ where: { kind: 'folder', ref: `${folder}/sub`, state: 'active' } })).toBe(0);
    });

    it('an attached source cannot be moved without the owner choosing it', async () => {
      await expect(attachSource(prisma, { kind: 'email', ref: `${tag}-conv-a1`, target_key: `project:${ids.hosting}`, attached_by: 'intake' })).rejects.toMatchObject({ statusCode: 409 });
      const moved = await attachSource(prisma, { kind: 'email', ref: `${tag}-conv-a1`, target_key: `project:${ids.hosting}`, attached_by: 'mike', move: true });
      expect(moved.result).toBe('attached');
      expect(await prisma.workLink.count({ where: { kind: 'email', ref: `${tag}-conv-a1`, state: 'active' } })).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the evidence route and the migration backfill', () => {
    it('evidence is idempotent, plain, and never changes work', async () => {
      as(porter());
      const item = { kind: 'bast_run', ref: `run-${tag}`, at: ago(1).toISOString(), line: `Bast ran a pass — it finished\nclean`, source: 'worker', target_key: `task:${ids.T1}` };
      const first = await (await evidencePost(jreq('/api/work/evidence', 'POST', { items: [item] }))).json();
      expect(first).toEqual({ written: 1, duplicates: 0, unattached: 0 });
      const second = await (await evidencePost(jreq('/api/work/evidence', 'POST', { items: [item] }))).json();
      expect(second).toEqual({ written: 0, duplicates: 1, unattached: 0 });
      const rowE = await prisma.workEvidence.findFirstOrThrow({ where: { ref: `run-${tag}` } });
      expect(rowE.line).not.toMatch(/[–—\n]/);
      const fromSource = await (await evidencePost(jreq('/api/work/evidence', 'POST', { items: [{ ...item, ref: `run2-${tag}`, target_key: undefined, from: { kind: 'session', ref: `${tag}-nowhere` } }] }))).json();
      expect(fromSource.unattached).toBe(1);
      expect((await evidencePost(jreq('/api/work/evidence', 'POST', { items: [{ ...item, extra: 1 }] }))).status).toBe(400);
      expect((await evidencePost(jreq('/api/work/evidence', 'POST', { items: Array.from({ length: 101 }, () => item) }))).status).toBe(400);
    });

    it('the backfill writes links only, and a second run writes nothing', async () => {
      const mig = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20261117050000_work_d/migration.sql'), 'utf8');
      const blocks = mig.match(/INSERT INTO "work_link"[\s\S]*?;(?=\s*(?:\n|$))/g) ?? [];
      expect(blocks).toHaveLength(2);
      await task('BF', { project_id: ids.website });
      await ask('bf1', { task_id: ids.BF, conversation_key: `${tag}-conv-bf` });
      await ask('bf2', { task_id: ids.BF, conversation_key: `${tag}-conv-bf`, rfc_message_id: `${tag}-rfc-bf2`, received_at: ago(1) });
      await ask('bf3', { task_id: ids.BF, conversation_key: null });
      await prisma.emailOutbox.create({ data: { to: 'x@thermal.test', subject: `Backfill send ${tag}`, text: '[sent; body removed]', task_id: ids.BF, sent_at: ago(2) } as never });
      await prisma.emailOutbox.create({ data: { to: 'x@thermal.test', subject: `Unsent ${tag}`, text: 'queued', task_id: ids.BF } as never });
      const before2 = await snapshot();
      const run = async () => {
        for (const sql of blocks) await prisma.$executeRawUnsafe(sql);
      };
      await run();
      const l1 = await prisma.workLink.findMany({ where: { OR: [{ ref: `${tag}-conv-bf` }, { task_id: ids.BF, kind: 'send' }] } });
      expect(l1.filter((l) => l.kind === 'email')).toHaveLength(1); // one per conversation, however many asks
      expect(l1.filter((l) => l.kind === 'send')).toHaveLength(1); // the sent row only
      expect(l1[0]).toMatchObject({ attached_by: 'auto', basis: 'backfill', state: 'active' });
      expect((await prisma.workLink.count({ where: { kind: 'email', ref: { in: [`${tag}-rfc-bf3`, `${tag}-bf3`] } } }))).toBe(0); // no conversation key: not linked
      const total = await prisma.workLink.count();
      await run();
      expect(await prisma.workLink.count()).toBe(total);
      const after2 = await snapshot();
      for (const a of before2.asks) expect(after2.asks.find((x) => x.message_id === a.message_id)).toEqual(a);
      expect(after2.tasks.find((t) => t.id === ids.BF)).toMatchObject({ status: 'in_progress', is_deleted: false });
    });
  });
});
