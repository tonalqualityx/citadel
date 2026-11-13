// @vitest-environment node
/**
 * Fixes from the adversarial review of the triage-kinds server slice, each against a real scratch Postgres (ported from the reviewer's
 * cases): looks-done cards stay in groups, relinking never keeps the old site, release_version (409 card_changed), the release line
 * versus the database for 288 cases in both worker-hold states, the chat's one-tap rule, phase fields, owner-only comments.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { homeActSchema, runHomeAct, runHomeUndo } from '@/lib/home/act';
import { loadCards } from '@/lib/tasks/triage-card';
import { loadTriage } from '@/lib/tasks/triage';
import { PATCH as triagePatch } from '@/app/api/tasks/[id]/triage/route';
import { PATCH as taskPatch } from '@/app/api/tasks/[id]/route';
import { POST as phasePost, PATCH as phasePatch } from '@/app/api/projects/[id]/phases/route';
import { GET as commentsGet } from '@/app/api/tasks/[id]/comments/route';
import { homeOp } from '@/lib/bast-chat/ops/home';
import { TRIAGE_KINDS } from '@/lib/tasks/triage-kind';

const authMock = requireAuth as Mock;
const NOW = new Date();
const OPTS = { now: NOW, timezone: 'America/New_York', date: NOW.toISOString().slice(0, 10) };
const req = (url: string, method: string, body?: unknown) => new NextRequest(new URL(url), { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) } as never);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const ASSIGNEES = ['none', 'person', 'bast'] as const;
const PROJECTS = ['none', 'quote', 'queue', 'ready'] as const;
const QS = ['none', 'go', 'wait', 'both'] as const;
const HOLD_ENV = 'TRIAGE_PM_RELEASE_HOLD';

describe.skipIf(!SCRATCH)('triage review fixes (real database)', () => {
  const tag = `rvf${Date.now()}`;
  const ids: string[] = [];
  const projectIds: string[] = [];
  let clientId: string;
  let client2: string;
  let techId: string;
  let pmId: string;
  let siteA: string;
  let siteB: string;
  let savedHold: string | undefined;

  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
  const chatLane = (): AuthPayload => ({ userId: BAST_USER_ID, role: 'pm', email: 'b@test', via: 'api_key', apiKeyId: 'k3', lane: 'bast-chat', laneEnforced: true });
  const pm = (): AuthPayload => ({ userId: pmId, role: 'pm', email: 'pm@test', via: 'session' });
  const tech = (): AuthPayload => ({ userId: techId, role: 'tech', email: 'tech@test', via: 'session' });
  const workerLane = (): AuthPayload => ({ userId: BAST_USER_ID, role: 'pm', email: 'b@test', via: 'api_key', apiKeyId: 'k2', lane: 'bast', laneEnforced: true });

  const mkProject = async (status: 'quote' | 'queue' | 'ready' | 'in_progress', data: Record<string, unknown> = {}) => {
    const p = await prisma.project.create({ data: { name: `${tag} P${projectIds.length}`, client_id: clientId, status, ...data } as never });
    projectIds.push(p.id);
    return p.id;
  };
  const mk = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', tags: ['keep-me'], ...data } as never });
    ids.push(t.id);
    return t.id;
  };
  const question = (task_id: string, action: 'go_with_recommendation' | 'wait') =>
    prisma.taskQuestion.create({ data: { task_id, question: 'Q?', what_it_is: 'x', sources: [], checked: 'x', unknown: 'x', if_nobody: 'go', if_nobody_action: action } as never });
  const card = async (id: string) => (await loadCards(prisma, [id]))[0];
  const releaseCard = async (id: string, version?: string) =>
    runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_card', task_ids: [id], release_version: version ?? (await card(id)).release_version }, OPTS);
  const snap = async (id: string) => {
    const t = await prisma.task.findUniqueOrThrow({ where: { id }, include: { project: { select: { status: true } }, questions: { select: { id: true, state: true } } } as never });
    const tt = t as unknown as { status: string; assignee_id: string | null; tags: string[]; triage_kind: string | null; site_id: string | null; client_id: string | null; project_id: string | null; project: { status: string } | null; questions: { id: string; state: string }[] };
    return {
      status: tt.status,
      assignee_id: tt.assignee_id,
      tags: [...tt.tags].sort(),
      triage_kind: tt.triage_kind,
      site_id: tt.site_id,
      client_id: tt.client_id,
      project_id: tt.project_id,
      project_status: tt.project?.status ?? null,
      questions: Object.fromEntries([...tt.questions].sort((a, b) => a.id.localeCompare(b.id)).map((q) => [q.id, q.state])),
    };
  };
  const nameOf = (uid: string | null) => (uid === BAST_USER_ID ? 'Bast' : uid === null ? null : 'Tess');

  beforeAll(async () => {
    savedHold = process.env[HOLD_ENV];
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    await prisma.userPreference.upsert({ where: { user_id: MIKE_USER_ID }, update: { home_view: 'home' }, create: { user_id: MIKE_USER_ID, home_view: 'home' } });
    clientId = (await prisma.client.create({ data: { name: `${tag} Co` } })).id;
    client2 = (await prisma.client.create({ data: { name: `${tag} Other Co` } })).id;
    techId = (await prisma.user.create({ data: { email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tess', role: 'tech' } })).id;
    pmId = (await prisma.user.create({ data: { email: `pm-${tag}@example.test`, password_hash: 'x', name: 'Pam', role: 'pm' } })).id;
    siteA = (await prisma.site.create({ data: { name: `${tag} live site`, client_id: client2, bast_enabled: true } as never })).id;
    siteB = (await prisma.site.create({ data: { name: `${tag} second site`, client_id: clientId } as never })).id;
  });
  afterAll(async () => {
    if (savedHold === undefined) delete process.env[HOLD_ENV];
    else process.env[HOLD_ENV] = savedHold;
    await prisma.homeAction.deleteMany({ where: { user_id: MIKE_USER_ID, action: { startsWith: 'triage_' } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: [techId, pmId] } } }).catch(() => {});
    await prisma.projectTeamAssignment.deleteMany({ where: { project_id: { in: projectIds } } }).catch(() => {});
    await prisma.function.deleteMany({ where: { name: `${tag} fn` } }).catch(() => {});
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.projectPhase.deleteMany({ where: { project_id: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.site.deleteMany({ where: { id: { in: [siteA, siteB] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId, client2] } } });
    await prisma.user.deleteMany({ where: { id: { in: [techId, pmId] } } });
  });
  beforeEach(() => {
    delete process.env[HOLD_ENV];
  });
  afterEach(() => {
    delete process.env[HOLD_ENV];
  });

  // 1 ----------------------------------------------------------------------------------------------------------------
  it('1. a looks-done card stays in its group, is counted once, and Release plan takes it along', async () => {
    const p = await mkProject('queue');
    const marked = await mk('marked', { project_id: p, client_id: clientId, tags: ['triage:looks-done'] });
    const plain = await mk('plain', { project_id: p, client_id: clientId });
    const tri = await loadTriage(prisma, MIKE_USER_ID);
    const g = tri?.groups.find((x) => x.project_id === p);
    expect(g?.tasks.map((t) => t.task_id).sort()).toEqual([marked, plain].sort());
    expect(tri?.looks_done?.some((l) => l.task_id === marked)).toBe(true);
    expect(tri?.cards?.some((c) => c.task_id === marked)).toBe(true);
    await question(marked, 'wait');
    const tri2 = await loadTriage(prisma, MIKE_USER_ID);
    expect(tri2?.open_questions).toBe(tri2?.groups.reduce((a, x) => a + x.open_questions, 0));
    await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_plan', group_key: `project:${p}` }, OPTS);
    expect((await snap(marked)).status).toBe('not_started');
    expect((await snap(plain)).status).toBe('not_started');
  });

  // 2 ----------------------------------------------------------------------------------------------------------------
  it('2. relinking copies the new project site (including none) and client; unlinking clears both', async () => {
    const pA = await mkProject('in_progress', { client_id: client2, site_id: siteA });
    const pB = await mkProject('queue', { client_id: client2 }); // a card may be linked only to a project of its own client (A2)
    const id = await mk('relink');
    authMock.mockResolvedValue(chatLane());
    expect((await triagePatch(req(`http://localhost/api/tasks/${id}/triage`, 'PATCH', { kind: 'task', project_id: pA }), params(id))).status).toBe(200);
    expect(await snap(id)).toMatchObject({ site_id: siteA, client_id: client2, project_id: pA });
    expect((await triagePatch(req(`http://localhost/api/tasks/${id}/triage`, 'PATCH', { project_id: pB }), params(id))).status).toBe(200);
    expect(await snap(id)).toMatchObject({ site_id: null, client_id: client2, project_id: pB });
    expect((await triagePatch(req(`http://localhost/api/tasks/${id}/triage`, 'PATCH', { project_id: null }), params(id))).status).toBe(200);
    expect(await snap(id)).toMatchObject({ site_id: null, client_id: null, project_id: null });
    expect((await card(id)).release_line).not.toMatch(/The work is on|internal/);
  });

  // 3 ----------------------------------------------------------------------------------------------------------------
  describe('3. release_version', () => {
    it('is on every card payload, is stable, and a matching version releases', async () => {
      const id = await mk('v-ok', { triage_kind: 'task' });
      const a = await card(id);
      expect(a.release_version).toMatch(/^[0-9a-f]{32}$/);
      expect((await card(id)).release_version).toBe(a.release_version);
      const res = await releaseCard(id, a.release_version);
      expect(res.ok).toBe(true);
      expect((await snap(id)).status).toBe('not_started');
    });

    it('a PM setting assignee and site after the read: 409 card_changed, nothing moves', async () => {
      const id = await mk('v-pm', { triage_kind: 'task' });
      const read = await card(id);
      authMock.mockResolvedValue(pm());
      expect((await taskPatch(req(`http://localhost/api/tasks/${id}`, 'PATCH', { assignee_id: techId, site_id: siteA }), params(id))).status).toBe(200);
      const before = await snap(id);
      await expect(releaseCard(id, read.release_version)).rejects.toMatchObject({ statusCode: 409, code: 'card_changed' });
      expect(await snap(id)).toEqual(before);
      expect((await card(id)).release_version).not.toBe(read.release_version);
      expect((await releaseCard(id)).ok).toBe(true);
    });

    it('the worker lane setting site and client after the read: 409 card_changed', async () => {
      const id = await mk('v-worker', { triage_kind: 'task' });
      const read = await card(id);
      authMock.mockResolvedValue(workerLane());
      expect((await taskPatch(req(`http://localhost/api/tasks/${id}`, 'PATCH', { site_id: siteA, client_id: client2 }), params(id))).status).toBe(200);
      await expect(releaseCard(id, read.release_version)).rejects.toMatchObject({ statusCode: 409, code: 'card_changed' });
      expect((await snap(id)).status).toBe('triage');
    });

    it('the chat lane changing the kind after the read: 409 card_changed, the card is not closed', async () => {
      const id = await mk('v-kind', { triage_kind: 'task' });
      const read = await card(id);
      authMock.mockResolvedValue(chatLane());
      expect((await triagePatch(req(`http://localhost/api/tasks/${id}/triage`, 'PATCH', { kind: 'question_only' }), params(id))).status).toBe(200);
      await expect(releaseCard(id, read.release_version)).rejects.toMatchObject({ statusCode: 409, code: 'card_changed' });
      expect((await snap(id)).status).toBe('triage');
    });

    it('a project status change, a new question and a changed if_nobody_action each change the version', async () => {
      const p = await mkProject('queue');
      const id = await mk('v-more', { triage_kind: 'project_addition', project_id: p, client_id: clientId });
      const v0 = (await card(id)).release_version;
      const q = await question(id, 'go_with_recommendation');
      const v1 = (await card(id)).release_version;
      await prisma.taskQuestion.update({ where: { id: q.id }, data: { if_nobody_action: 'wait' } });
      const v2 = (await card(id)).release_version;
      await prisma.project.update({ where: { id: p }, data: { status: 'ready' } });
      const v3 = (await card(id)).release_version;
      expect(new Set([v0, v1, v2, v3]).size).toBe(4);
    });

    it('the request must carry the version', async () => {
      const id = await mk('v-required', { triage_kind: 'task' });
      expect(homeActSchema.safeParse({ action: 'triage_release_card', task_ids: [id] }).success).toBe(false);
      expect(homeActSchema.safeParse({ action: 'triage_release_card', task_ids: [id], release_version: (await card(id)).release_version }).success).toBe(true);
    });
  });

  // 4 + 7 ------------------------------------------------------------------------------------------------------------
  describe.each([
    ['hold on (default)', true],
    ['hold off', false],
  ])('4 and 7. the release line against the database, 288 cases, %s', (_name, hold) => {
    it('every claim in the sentence matches the database after release, and Undo restores everything', async () => {
      if (!hold) process.env[HOLD_ENV] = 'off';
      const problems: string[] = [];
      let i = 0;
      let n = 0;
      for (const kind of TRIAGE_KINDS)
        for (const who of ASSIGNEES)
          for (const proj of PROJECTS)
            for (const qs of QS) {
              i += 1;
              n += 1;
              const projectId = proj === 'none' ? null : await mkProject(proj);
              const siteId = i % 3 === 1 ? siteB : null;
              const assignee = who === 'none' ? null : who === 'bast' ? BAST_USER_ID : techId;
              const tags = ['keep-me', ...(i % 2 === 0 ? ['triage:looks-done'] : []), ...(i % 5 === 0 ? ['needs-mike'] : [])];
              const id = await mk(`${kind}/${who}/${proj}/${qs}`, { triage_kind: kind, project_id: projectId, client_id: projectId ? clientId : null, site_id: siteId, assignee_id: assignee, tags });
              if (qs === 'go' || qs === 'both') await question(id, 'go_with_recommendation');
              if (qs === 'wait' || qs === 'both') await question(id, 'wait');
              const before = await snap(id);
              const c = await card(id);
              const line = c.release_line;
              const label = `${kind}/${who}/${proj}/${qs}/site=${siteId ? 'y' : 'n'}`;
              let res: { action_id: string } | null = null;
              let refused: string | null = null;
              try {
                res = (await releaseCard(id, c.release_version)) as { action_id: string };
              } catch (e) {
                refused = (e as { code?: string }).code ?? String(e);
              }
              const after = await snap(id);
              const bad = (m: string) => problems.push(`${label}: ${m} | ${line}`);
              if (!c.release_ready) {
                if (!refused) bad('line said refused but release ran');
                if (JSON.stringify(after) !== JSON.stringify(before)) bad('refused but changed');
                continue;
              }
              if (refused) {
                bad(`line said ready but refused ${refused}`);
                continue;
              }
              // ---- claims ----
              const done = /^Closes this card\./.test(line);
              if (/not_started|kickoff|needs-pm-release|from-triage|tagged|lane/i.test(line)) bad('system word in the sentence');
              // who it lands on, from the phrase: "Hands this to X", "hands it to X", or the project setup (Bast, with Dox setting it up)
              const claimedTags: string[] = [];
              let claimedAssignee: string | undefined;
              const startsProject = /^Starts the project: Dox sets up /.test(line) || /^Hands the setup of .+ to Dox, who creates and assigns every task\./.test(line);
              if (!done) {
                if (kind === 'project_setup') {
                  if (!startsProject) bad('setup sentence not recognised');
                  claimedAssignee = 'Bast';
                  claimedTags.push('kickoff', 'from-triage');
                } else {
                  const m = /[Hh]ands (?:this|it) to (\w+?)(?: to do)?\./.exec(line);
                  if (!m) {
                    bad('line not parsed');
                    continue;
                  }
                  claimedAssignee = m[1];
                  claimedTags.push('from-triage');
                }
              }
              if (after.status !== (done ? 'done' : 'not_started')) bad(`status ${after.status}`);
              if (claimedAssignee !== undefined && nameOf(after.assignee_id) !== claimedAssignee) bad(`assignee ${nameOf(after.assignee_id)} != ${claimedAssignee}`);
              if (done && after.assignee_id !== before.assignee_id) bad('done but assignee changed');
              for (const t of claimedTags) if (!after.tags.includes(t)) bad(`missing tag ${t}`);
              // the worker hold: the tag is there exactly when the card ends with Bast and the hold is on, and the line says it waits
              const endsBast = !done && after.assignee_id === BAST_USER_ID;
              if (after.tags.includes('needs-pm-release') !== (hold && endsBast) && !before.tags.includes('needs-pm-release')) bad(`needs-pm-release ${after.tags.includes('needs-pm-release')} but hold=${hold} endsBast=${endsBast}`);
              const heldClaim = /Nothing begins until Dox picks it up\./.test(line);
              if (heldClaim !== (hold && endsBast)) bad('the held-for-Dox sentence does not match the hold');
              if (heldClaim) claimedTags.push('needs-pm-release');
              if (/ to do\./.test(line) && (hold || !endsBast)) bad('promises work to do while held or on a person');
              if (/Releasing approves the wording on this card\./.test(line) !== (kind === 'rule_proposal' && !done)) bad('approves-wording sentence does not match the kind');
              // the site
              const onSite = /The work is on (.+?)\.(?: |$)/.exec(line);
              if (!done) {
                if (siteId && !(onSite && onSite[1] === `${tag} second site`)) bad('site not named');
                if (!siteId && (onSite || /site|internal/i.test(line))) bad('a card with no site says something about a site');
                if (after.site_id !== before.site_id) bad('site changed');
              } else if (onSite || /site/i.test(line)) bad('closed card claims a site');
              // the questions
              const openBefore = Object.entries(before.questions).filter(([, s]) => s === 'open').map(([q]) => q);
              const goClaim = /(\d+) open questions? goes? ahead with the recommendation/.exec(line);
              const waitClaim = /(\d+) open questions? waits? for you; the card stays flagged for you/.exec(line);
              const defaulted = Object.values(after.questions).filter((s) => s === 'defaulted').length;
              const stillOpen = Object.values(after.questions).filter((s) => s === 'open').length;
              if (done) {
                if (stillOpen !== openBefore.length) bad('closed card changed its questions');
                const stay = /(\d+) open questions? stays? unanswered\./.exec(line);
                if (openBefore.length > 0 && !(stay && Number(stay[1]) === openBefore.length)) bad('closed card line does not say its open questions stay');
              } else {
                if ((goClaim ? Number(goClaim[1]) : 0) !== defaulted) bad(`questions that go ahead: line ${goClaim?.[1] ?? 0}, database ${defaulted}`);
                if ((waitClaim ? Number(waitClaim[1]) : 0) !== stillOpen) bad(`questions that wait: line ${waitClaim?.[1] ?? 0}, database ${stillOpen}`);
                if (waitClaim && !(after.tags.includes('needs-mike') && after.tags.includes('held-for-questions'))) bad('waiting questions but the card is not flagged for Mike');
                if (!waitClaim && after.tags.includes('held-for-questions') && !before.tags.includes('held-for-questions')) bad('held-for-questions added with no waiting question');
              }
              // nothing unclaimed changed
              const allowed = new Set([...claimedTags, ...(waitClaim && !done ? ['held-for-questions', 'held-for-questions:needs-mike', 'needs-mike'] : [])]);
              const added = after.tags.filter((t) => !before.tags.includes(t) && !allowed.has(t));
              if (added.length) bad(`unclaimed tags added: ${added.join(',')}`);
              const removed = before.tags.filter((t) => !after.tags.includes(t));
              if (removed.length) bad(`tags removed: ${removed.join(',')}`);
              const readyClaim = /^Starts the project:/.test(line);
              if (readyClaim && after.project_status !== 'ready') bad('project not ready');
              if (!readyClaim && after.project_status !== before.project_status) bad('project status changed unclaimed');
              if (after.client_id !== before.client_id) bad('client changed');
              if (res) {
                await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, new Date(NOW.getTime() + 3600_000));
                const back = await snap(id);
                if (JSON.stringify(back) !== JSON.stringify(before)) bad(`undo mismatch: before ${JSON.stringify(before)} back ${JSON.stringify(back)} after ${JSON.stringify(after)}`);
              }
            }
      expect(n).toBe(288);
      expect(problems).toEqual([]);
    }, 900_000);
  });

  // 5 ----------------------------------------------------------------------------------------------------------------
  describe('5. a chat release that ends with a card assigned to Bast', () => {
    const ctx = () => ({ db: prisma as never, ownerId: MIKE_USER_ID, now: NOW });
    const prepare = async (id: string) => homeOp.prepare(ctx(), { action: 'triage_release_card', task_ids: [id], release_version: (await card(id)).release_version }, 'chat');

    it('Mike or agent text: acts at once (no tap)', async () => {
      const id = await mk('chat-internal', { triage_kind: 'task', source: 'internal' });
      expect((await prepare(id)).reach.needs_tap).toBe(false);
      const s = await mk('chat-session', { triage_kind: 'task', source: 'session', created_by_id: BAST_USER_ID });
      expect((await prepare(s)).reach.needs_tap).toBe(false);
    });

    it('client mail text (email source, portal, requesting contact, linked email ask, client comment): needs the one tap', async () => {
      const email = await mk('chat-email', { triage_kind: 'task', source: 'email' });
      const r = await prepare(email);
      expect(r.reach.needs_tap).toBe(true);
      expect(r.reach.starts[0]).toMatchObject({ rule: 'hand_to_bast', task_id: email });
      expect((await prepare(await mk('chat-portal', { triage_kind: 'task', source: 'portal' }))).reach.needs_tap).toBe(true);
      const contact = await prisma.clientContact.create({ data: { client_id: clientId, name: 'Cee', email: `cee-${tag}@example.test` } as never });
      expect((await prepare(await mk('chat-contact', { triage_kind: 'task', requested_by_contact_id: contact.id }))).reach.needs_tap).toBe(true);
      const withComment = await mk('chat-comment', { triage_kind: 'project_setup', project_id: await mkProject('ready'), client_id: clientId });
      await prisma.comment.create({ data: { task_id: withComment, user_id: BAST_USER_ID, author_contact_id: contact.id, content: 'from the client' } as never });
      expect((await prepare(withComment)).reach.needs_tap).toBe(true);
      await prisma.comment.deleteMany({ where: { task_id: withComment } });
      await prisma.clientContact.delete({ where: { id: contact.id } });
    });

    it('client text but the card ends with a person, or is closed as done: no tap (nothing starts the worker)', async () => {
      const person = await mk('chat-person', { triage_kind: 'task', source: 'email', assignee_id: techId });
      expect((await prepare(person)).reach.needs_tap).toBe(false);
      const closed = await mk('chat-closed', { triage_kind: 'question_only', source: 'email' });
      expect((await prepare(closed)).reach.needs_tap).toBe(false);
    });

    it('the same rule holds for the older group release and Release plan, and with the worker hold off', async () => {
      process.env[HOLD_ENV] = 'off';
      const p = await mkProject('queue');
      const a = await mk('chat-plan-a', { triage_kind: 'task', source: 'email', project_id: p, client_id: clientId });
      const legacy = await homeOp.prepare(ctx(), { action: 'triage_release', task_ids: [a] }, 'chat');
      expect(legacy.reach.needs_tap).toBe(true);
      const plan = await homeOp.prepare(ctx(), { action: 'triage_release_plan', group_key: `project:${p}` }, 'chat');
      expect(plan.reach.needs_tap).toBe(true);
      const other = await homeOp.prepare(ctx(), { action: 'triage_drop', task_ids: [a] }, 'chat');
      expect(other.reach.needs_tap).toBe(false);
    });
  });

  // 6 ----------------------------------------------------------------------------------------------------------------
  describe('6. phase summary and mike_part are Mike-only', () => {
    it('a PM or admin API key cannot write them (403), other fields still work; Mike and the chat lane can', async () => {
      const p = await mkProject('queue');
      authMock.mockResolvedValue(pm());
      expect((await phasePost(req(`http://localhost/api/projects/${p}/phases`, 'POST', { name: 'Build', mike_part: 'Nothing, Bast does it all' }), params(p))).status).toBe(403);
      expect((await phasePost(req(`http://localhost/api/projects/${p}/phases`, 'POST', { name: 'Build', summary: 'x' }), params(p))).status).toBe(403);
      const ok = await phasePost(req(`http://localhost/api/projects/${p}/phases`, 'POST', { name: 'Plain' }), params(p));
      expect(ok.status).toBe(201);
      const phaseId = ((await ok.json()) as { phase: { id: string } }).phase.id;
      expect((await phasePatch(req(`http://localhost/api/projects/${p}/phases`, 'PATCH', { phase_id: phaseId, mike_part: 'sneaky' }), params(p))).status).toBe(403);
      expect((await phasePatch(req(`http://localhost/api/projects/${p}/phases`, 'PATCH', { phase_id: phaseId, summary: null }), params(p))).status).toBe(403);
      expect((await phasePatch(req(`http://localhost/api/projects/${p}/phases`, 'PATCH', { phase_id: phaseId, name: 'Renamed' }), params(p))).status).toBe(200);
      expect((await prisma.projectPhase.findUniqueOrThrow({ where: { id: phaseId } })).mike_part).toBeNull();
      authMock.mockResolvedValue(mike());
      const m = await phasePatch(req(`http://localhost/api/projects/${p}/phases`, 'PATCH', { phase_id: phaseId, mike_part: 'Review the plan' }), params(p));
      expect(m.status).toBe(200);
      authMock.mockResolvedValue(chatLane());
      expect((await phasePost(req(`http://localhost/api/projects/${p}/phases`, 'POST', { name: 'Chat', summary: 'ok', mike_part: 'ok' }), params(p))).status).toBe(201);
    });
  });

  // 8 ----------------------------------------------------------------------------------------------------------------
  describe('8. Looks done comments stay owner-side after release', () => {
    it('a tech team member on the project does not get the Looks done or the close note; Mike and a PM do', async () => {
      const p = await mkProject('in_progress');
      const fn = await prisma.function.create({ data: { name: `${tag} fn` } as never });
      await prisma.projectTeamAssignment.create({ data: { project_id: p, user_id: techId, function_id: fn.id } });
      const id = await mk('looks', { triage_kind: 'task', project_id: p, client_id: clientId, tags: ['triage:looks-done'] });
      await prisma.comment.createMany({
        data: [
          { task_id: id, user_id: BAST_USER_ID, content: 'Looks done: shipped in abc123, see https://x.test', is_internal: true },
          { task_id: id, user_id: MIKE_USER_ID, content: 'Closed as done from Triage. Evidence: comment x: shipped', is_internal: true },
          { task_id: id, user_id: MIKE_USER_ID, content: 'Plain team note', is_internal: true },
        ],
      });
      await releaseCard(id);
      expect((await snap(id)).status).toBe('not_started');
      const list = async (auth: AuthPayload) => {
        authMock.mockResolvedValue(auth);
        const r = await commentsGet(req(`http://localhost/api/tasks/${id}/comments`, 'GET'), params(id));
        return ((await r.json()) as { comments: { content: string }[] }).comments.map((c) => c.content);
      };
      const forTech = await list(tech());
      expect(forTech).toEqual(['Plain team note']);
      expect((await list(mike())).length).toBe(3);
      expect((await list(pm())).length).toBe(3);
    });
  });
});
