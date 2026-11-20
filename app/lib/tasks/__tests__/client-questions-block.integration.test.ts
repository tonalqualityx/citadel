// @vitest-environment node
/**
 * Questions we send a client, and questions as blockers (Mike, 2026-11-19: "I mean that in the way that dependencies block tasks"),
 * against a real scratch Postgres through the real routes: asking with blocks holds the cards; the unblock sweep never releases a card an
 * open question holds; an answer, a withdrawal and a passed go-ahead date each release the cards (with the reason on the card for the
 * go-ahead); a card outside the project is refused; the blocks routes; GET /api/questions; the nudge stamp; the card read shows them.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { PATCH as patchQ } from '@/app/api/tasks/[id]/questions/[qid]/route';
import { POST as answerQ } from '@/app/api/tasks/[id]/questions/[qid]/answer/route';
import { POST as addBlocks, DELETE as removeBlocks } from '@/app/api/tasks/[id]/questions/[qid]/blocks/route';
import { GET as listAll } from '@/app/api/questions/route';
import { GET as getTask } from '@/app/api/tasks/[id]/route';
import { POST as sweep } from '@/app/api/tasks/unblock-sweep/route';
import { makeFixture, type Fx } from '@/lib/dox/__tests__/fixture';

const authMock = requireAuth as Mock;
const BAST = BOT_USER_IDS[0];
const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
const worker = (): AuthPayload => ({ userId: BAST, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'kb', lane: 'bast', laneEnforced: false });
const tech = (id: string): AuthPayload => ({ userId: id, role: 'tech', email: 't@test', via: 'session' });
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const tp = (id: string) => ({ params: Promise.resolve({ id }) });
const qp = (id: string, qid: string) => ({ params: Promise.resolve({ id, qid }) });
const req = (body?: unknown, method = 'POST', url = 'http://localhost/api/x') =>
  new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

const CONTEXT = {
  what_it_is: 'We asked the client which copy to keep where the two drafts differ.',
  sources: [{ who: 'Mike', said: 'Which version of the copy should we keep for each page?', at: '2026-11-13' }],
  checked: 'Logged from the sent email to the client on November 13.',
  unknown: 'Which draft the client wants on each page.',
  if_nobody: 'The cards it blocks wait until the client answers.',
};
const waitQ = (question: string) => ({ ...CONTEXT, question, if_nobody_action: 'wait' as const });
const goQ = (question: string) => ({
  ...CONTEXT,
  question,
  options: [
    { id: 'old', label: 'Keep the live copy', consequence: 'Nothing new to write.' },
    { id: 'new', label: 'Use the new draft', consequence: 'The new draft goes in.' },
  ],
  recommended_option_id: 'new',
  recommend_why: 'The new draft is what the client sent last.',
  if_nobody: 'The new draft goes in on every page.',
  if_nobody_action: 'go_with_recommendation' as const,
});

async function statusOf(id: string) {
  return (await prisma.task.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
}

describe.skipIf(!SCRATCH)('client questions block cards (real database)', () => {
  let fx: Fx;
  let projectId: string;
  let otherProjectId: string;
  let home: string;
  let waiting: string;
  let later: string;
  let outside: string;
  let contactId: string;
  let techId: string;

  beforeAll(async () => {
    fx = await makeFixture('cqb');
    projectId = await fx.mkProject('Site');
    otherProjectId = await fx.mkProject('Other');
    home = await fx.mkTask('Copy card', { project_id: projectId, status: 'not_started', assignee_id: BAST });
    waiting = await fx.mkTask('Banned claims search', { project_id: projectId, status: 'not_started' });
    later = await fx.mkTask('Staging push', { project_id: projectId, status: 'in_progress' });
    outside = await fx.mkTask('Other project card', { project_id: otherProjectId, status: 'not_started' });
    contactId = (await prisma.clientContact.create({ data: { client_id: fx.clientId, name: `Kue ${fx.tag}`, email: `kue-${fx.tag}@example.test` } })).id;
    techId = await fx.mkStaff('Tess', 'tech');
  });

  afterAll(async () => {
    await prisma.comment.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.clientContact.deleteMany({ where: { client_id: fx.clientId } });
    await fx.cleanup();
  });

  let qid = '';

  it('asking with blocks records who it was for and the email, and holds every active card it blocks', async () => {
    as(worker());
    const res = await addQ(
      req({
        ...waitQ('Which version of the copy should we keep for each page?'),
        asked_of_contact_id: contactId,
        sent: { account: 'mike@becomeindelible.com', message_id: 'm1', thread_id: 't1', at: '2026-11-13T15:00:00Z' },
        blocks: [home, waiting],
        cause_key: `sent-q:${fx.tag}:0`,
        cause_scope: 'project',
      }),
      tp(home),
    );
    expect(res.status).toBe(201);
    const q = await res.json();
    qid = q.id;
    expect(q.asked_of_contact).toMatchObject({ id: contactId });
    expect(q.sent).toMatchObject({ account: 'mike@becomeindelible.com', message_id: 'm1', thread_id: 't1' });
    expect(q.blocks.map((b: { id: string }) => b.id).sort()).toEqual([home, waiting].sort());
    expect(await statusOf(home)).toBe('blocked');
    expect(await statusOf(waiting)).toBe('blocked');
    expect(await statusOf(later)).toBe('in_progress');
  });

  it('the same email logged again dedupes on its cause and changes nothing', async () => {
    as(worker());
    const res = await addQ(req({ ...waitQ('Which version of the copy should we keep for each page?'), cause_key: `sent-q:${fx.tag}:0`, cause_scope: 'project', blocks: [later] }), tp(waiting));
    expect(res.status).toBe(200);
    expect((await res.json()).deduped).toBe(true);
    expect(await statusOf(later)).toBe('in_progress');
  });

  it('the unblock sweep never releases a card an open question holds', async () => {
    as(mike());
    const res = await sweep();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ids).not.toContain(home);
    expect(body.ids).not.toContain(waiting);
    expect(await statusOf(home)).toBe('blocked');
  });

  it('the card read lists the question in its blocked-by data', async () => {
    as(mike());
    const res = await getTask(req(undefined, 'GET'), tp(waiting));
    const t = await res.json();
    expect(t.blocked_by_questions).toEqual([
      expect.objectContaining({ id: qid, task_id: home, state: 'open', asked_of_contact: expect.objectContaining({ id: contactId }) }),
    ]);
  });

  it('a card outside the project is refused, and nothing changes', async () => {
    as(worker());
    const res = await addBlocks(req({ task_ids: [outside] }), qp(home, qid));
    expect(res.status).toBe(422);
    expect(await statusOf(outside)).toBe('not_started');
  });

  it('a tech cannot change the blocks of a question they did not ask', async () => {
    as(tech(techId));
    const res = await addBlocks(req({ task_ids: [later] }), qp(home, qid));
    expect(res.status).toBe(404);
  });

  it('blocks POST holds a further card; DELETE releases it when nothing else holds it', async () => {
    await prisma.task.update({ where: { id: later }, data: { status: 'not_started' } });
    as(worker());
    const add = await addBlocks(req({ task_ids: [later] }), qp(home, qid));
    expect(add.status).toBe(200);
    expect(await statusOf(later)).toBe('blocked');
    const del = await removeBlocks(req({ task_ids: [later] }, 'DELETE'), qp(home, qid));
    expect(del.status).toBe(200);
    expect((await del.json()).blocks.map((b: { id: string }) => b.id)).not.toContain(later);
    expect(await statusOf(later)).toBe('not_started');
  });

  it('GET /api/questions lists open client questions with the card, contact, email and blocks; never for a tech', async () => {
    as(worker());
    const res = await listAll(req(undefined, 'GET', `http://localhost/api/questions?for=client&project_id=${projectId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.questions[0]).toMatchObject({ id: qid, task: { id: home, project_id: projectId }, sent: { message_id: 'm1' }, nudge_drafted_at: null });
    // who asked it, by name (the project screen's Questions tab shows it); the asker is the worker here
    const asker = await prisma.user.findUnique({ where: { id: BAST }, select: { id: true, name: true } });
    expect(body.questions[0].asked_by).toEqual(asker ? { id: asker.id, name: asker.name } : null);
    expect(body.questions[0].asked_by_lane).toBe('bast');
    const openOnProject = await (await listAll(req(undefined, 'GET', `http://localhost/api/questions?state=open&for=all&project_id=${projectId}&limit=500`))).json();
    expect(openOnProject.questions.map((q: { id: string }) => q.id)).toEqual([qid]);
    expect(openOnProject.questions[0].blocks.map((b: { id: string }) => b.id).sort()).toEqual([home, waiting].sort());
    const mikeOnly = await (await listAll(req(undefined, 'GET', `http://localhost/api/questions?for=mike&project_id=${projectId}`))).json();
    expect(mikeOnly.total).toBe(0);
    as(tech(techId));
    expect((await listAll(req(undefined, 'GET', 'http://localhost/api/questions'))).status).toBe(403);
  });

  it('the nudge stamp sets nudge_drafted_at and leaves the question open', async () => {
    as(worker());
    const res = await patchQ(req({ nudge_drafted: true }, 'PATCH'), qp(home, qid));
    expect(res.status).toBe(200);
    const q = await res.json();
    expect(q.nudge_drafted_at).not.toBeNull();
    expect(q.state).toBe('open');
    expect(q.question).toBe('Which version of the copy should we keep for each page?');
  });

  it('the worker never answers', async () => {
    as(worker());
    const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: qid } });
    const res = await answerQ(req({ version: row.updated_at.toISOString(), text: 'Keep the new copy' }), qp(home, qid));
    expect(res.status).toBe(403);
    expect(await statusOf(home)).toBe('blocked');
  });

  it("Mike's answer releases the cards it blocked", async () => {
    as(mike());
    const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: qid } });
    const res = await answerQ(req({ version: row.updated_at.toISOString(), text: 'Kue said keep the new copy everywhere' }), qp(home, qid));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.released_task_ids.sort()).toEqual([home, waiting].sort());
    expect(await statusOf(home)).toBe('not_started');
    expect(await statusOf(waiting)).toBe('not_started');
  });

  it('a card held by two questions stays blocked until both are settled; a withdrawal releases', async () => {
    as(worker());
    const a = await (await addQ(req({ ...waitQ('Which photos go on the About page?'), asked_of_contact_id: contactId, blocks: [waiting] }), tp(home))).json();
    const b = await (await addQ(req({ ...waitQ('Who signs off on the parts list?'), blocks: [waiting] }), tp(home))).json();
    expect(await statusOf(waiting)).toBe('blocked');
    await patchQ(req({ withdraw: true, reason: 'Asked on the call instead.' }, 'PATCH'), qp(home, a.id));
    expect(await statusOf(waiting)).toBe('blocked');
    await patchQ(req({ withdraw: true, reason: 'Settled in the meeting.' }, 'PATCH'), qp(home, b.id));
    expect(await statusOf(waiting)).toBe('not_started');
  });

  it('an open question still holds a card whose blocker task is done', async () => {
    const blockerTask = await fx.mkTask('Done blocker', { project_id: projectId, status: 'done', approved: true });
    const dep = await fx.mkTask('Dependent', { project_id: projectId, status: 'blocked', blocked_by: { connect: [{ id: blockerTask }] } });
    as(worker());
    await addQ(req({ ...waitQ('Is the booth page still wanted?'), blocks: [dep] }), tp(home));
    as(mike());
    await sweep();
    expect(await statusOf(dep)).toBe('blocked');
  });

  it('a card already in progress keeps its status (a live session or a staged card is never parked), but lists the question', async () => {
    const live = await fx.mkTask('Live work', { project_id: projectId, status: 'in_progress' });
    as(worker());
    const q = await (await addQ(req({ ...waitQ('Is the parts page copy final?'), blocks: [live] }), tp(home))).json();
    expect(q.blocks.map((b: { id: string }) => b.id)).toContain(live);
    expect(await statusOf(live)).toBe('in_progress');
  });

  it('only staff block cards; the worker lane never asks on a Triage card; it changes only its own questions', async () => {
    as(tech(techId));
    // A tech who cannot see the card gets 404 from the access check; one who can gets 403 block_not_allowed. Either way nothing is held.
    const t = await addQ(req({ ...waitQ('Can a tech block this card?'), blocks: [waiting] }), tp(home));
    expect([403, 404]).toContain(t.status);
    expect(await prisma.taskQuestion.count({ where: { question: 'Can a tech block this card?' } })).toBe(0);
    const tri = await fx.mkTask('Triage card', { status: 'triage' });
    as(worker());
    expect((await addQ(req(waitQ('Is this on a triage card?')), tp(tri))).status).toBe(404);
    as(mike());
    const mq = await (await addQ(req(waitQ('Should Mike keep this one open?')), tp(home))).json();
    as(worker());
    expect((await patchQ(req({ withdraw: true, reason: 'not mine' }, 'PATCH'), qp(home, mq.id))).status).toBe(404);
    expect((await patchQ(req({ nudge_drafted: true }, 'PATCH'), qp(home, mq.id))).status).toBe(200);
    expect((await addBlocks(req({ task_ids: [waiting] }), qp(home, mq.id))).status).toBe(404);
  });

  it('removing the last blocker task does not release a card an open question holds', async () => {
    const { DELETE: removeDep } = await import('@/app/api/tasks/[id]/dependencies/route');
    const bt = await fx.mkTask('Unfinished blocker', { project_id: projectId, status: 'not_started' });
    const dep = await fx.mkTask('Held twice', { project_id: projectId, status: 'blocked', blocked_by: { connect: [{ id: bt }] } });
    as(worker());
    await addQ(req({ ...waitQ('Which header photo goes on the Rental page?'), blocks: [dep] }), tp(home));
    as(mike());
    const res = await removeDep(req(undefined, 'DELETE', `http://localhost/api/tasks/${dep}/dependencies?blocker_id=${bt}`), tp(dep));
    expect(res.status).toBe(200);
    expect(await statusOf(dep)).toBe('blocked');
  });

  it('a go-ahead date belongs only to a go-ahead question', async () => {
    as(worker());
    const res = await addQ(req({ ...waitQ('Should the map show on phones?'), default_at: '2026-11-20T15:00:00Z' }), tp(home));
    expect(res.status).toBe(400);
  });

  it('when the go-ahead date passes unanswered, the sweep defaults it, puts the reason on each card and releases them', async () => {
    const card = await fx.mkTask('Pages to write', { project_id: projectId, status: 'not_started' });
    as(worker());
    const q = await (await addQ(req({ ...goQ('Should we use the new draft on every page?'), default_at: new Date(Date.now() + 3600_000).toISOString(), blocks: [card] }), tp(home))).json();
    expect(await statusOf(card)).toBe('blocked');
    as(mike());
    await sweep();
    expect(await statusOf(card)).toBe('blocked'); // not yet due
    await prisma.taskQuestion.update({ where: { id: q.id }, data: { default_at: new Date(Date.now() - 60_000) } });
    const res = await (await sweep()).json();
    expect(res.questions_defaulted).toBe(1);
    expect(res.ids).toContain(card);
    expect(await statusOf(card)).toBe('not_started');
    const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: q.id } });
    expect(row.state).toBe('defaulted');
    const reason = await prisma.comment.findFirst({ where: { task_id: card }, orderBy: { created_at: 'desc' } });
    expect(reason?.user_id).toBe(BAST);
    expect(reason?.content).toContain('Went ahead: nobody answered "Should we use the new draft on every page?"');
    expect(reason?.content).toContain('Use the new draft');
    // A second sweep finds nothing more to default
    expect((await (await sweep()).json()).questions_defaulted).toBe(0);
  });
  it("a Triage card's questions on the project list only for Mike, and only when asked for (the project screen's Questions tab)", async () => {
    const triCard = await fx.mkTask('Project addition in Triage', { project_id: projectId, status: 'triage' });
    as(mike());
    const tq = await (await addQ(req(waitQ('Should the booth page join this project?')), tp(triCard))).json();
    const url = (extra: string) => `http://localhost/api/questions?state=open&for=all&project_id=${projectId}&limit=500${extra}`;
    const ids = async () => ((await (await listAll(req(undefined, 'GET', url('&include_triage=1')))).json()).questions as Array<{ id: string }>).map((q) => q.id);
    expect(await ids()).toContain(tq.id);
    const plain = (await (await listAll(req(undefined, 'GET', url('')))).json()).questions as Array<{ id: string }>;
    expect(plain.map((q) => q.id)).not.toContain(tq.id);
    // the worker's flag is ignored: a Triage card is Mike's and the chat's
    as(worker());
    expect(await ids()).not.toContain(tq.id);
    // Mike answers it from the project screen, through the card's own answer route
    as(mike());
    const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: tq.id } });
    expect((await answerQ(req({ version: row.updated_at.toISOString(), text: 'Yes, add it' }), qp(triCard, tq.id))).status).toBe(200);
    expect(await ids()).not.toContain(tq.id);
  });
});
