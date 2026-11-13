// @vitest-environment node
/**
 * The triage-desk lane through the real routes against a scratch Postgres: what a session may read and change on a Triage card, what it may not,
 * the card's conversation, and the "changed by a session" record. Each refusal leaves the data as it was.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({ actor_lane: 'triage-desk' })), currentActorLane: vi.fn(async () => 'triage-desk') }));
const routeDb = vi.hoisted(() => ({ current: undefined as unknown }));
// The route reads the owner from the singleton settings row, which other test files in this database also write; give it a fixed owner instead.
vi.mock('@/lib/triage-desk/conversation', async (orig) => {
  const m = await orig<typeof import('@/lib/triage-desk/conversation')>();
  return { ...m, readCardConversation: (id: string, opts: { after?: number; limit?: number }, db?: never) => m.readCardConversation(id, opts, db ?? (routeDb.current as never)) };
});

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { GET as getTask, PATCH as patchTask, DELETE as deleteTask } from '@/app/api/tasks/[id]/route';
import { GET as getTriage, PATCH as patchTriage } from '@/app/api/tasks/[id]/triage/route';
import { PUT as putShape } from '@/app/api/tasks/[id]/triage/shape/route';
import { GET as getConversation } from '@/app/api/tasks/[id]/conversation/route';
import { GET as getComments, POST as addComment } from '@/app/api/tasks/[id]/comments/route';
import { GET as getQs, POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { PATCH as patchQ } from '@/app/api/tasks/[id]/questions/[qid]/route';
import { POST as answerQ } from '@/app/api/tasks/[id]/questions/[qid]/answer/route';
import { idParams, makeFixture, BOT_ID, mikeSession, dox, type Fx } from '@/lib/dox/__tests__/fixture';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { readCardConversation, scrubSecrets, HOME_CHAT_NOTE } from '../conversation';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const desk = (): AuthPayload => ({ userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'kt', lane: 'triage-desk', laneEnforced: true });
const call = (body?: unknown, method = 'POST', url = 'http://localhost/api/x') => new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });
const qParams = (id: string, qid: string) => ({ params: Promise.resolve({ id, qid }) });
const CTX = {
  what_it_is: 'The scope in the signed deal and the email thread disagree about the number of pages.',
  sources: [{ who: 'A session', said: 'The deal lists 12 pages, the thread says 10', at: '2026-11-13' }],
  checked: 'The deal and the thread were both read.',
  unknown: 'Which one the client means now.',
  if_nobody: 'Go with the newer message.',
  if_nobody_action: 'go_with_recommendation' as const,
  options: [{ id: 'a', label: 'Ten pages', consequence: 'The site ships a week earlier.' }, { id: 'b', label: 'Twelve pages', consequence: 'It matches the signed deal exactly.' }],
  recommended_option_id: 'a',
  recommend_why: 'The thread is newer.',
};

describe.skipIf(!SCRATCH)('the triage-desk lane (real database)', () => {
  let fx: Fx;
  let card: string, card2: string, liveTask: string, sharedTask: string;
  let queueProject: string, liveProject: string;
  let convId = '';
  const convIds: string[] = [];

  beforeAll(async () => {
    fx = await makeFixture('desk');
    card = await fx.mkTask('A card', { status: 'triage', tags: ['from-chat'], client_id: fx.clientId });
    card2 = await fx.mkTask('Another card', { status: 'triage', client_id: fx.clientId });
    liveTask = await fx.mkTask('A live task', { status: 'not_started', client_id: fx.clientId });
    queueProject = await fx.mkProject('Queued', { status: 'queue' });
    liveProject = await fx.mkProject('Live', { status: 'in_progress' });
    sharedTask = await fx.mkTask('Shared with the client', { status: 'not_started', client_id: fx.clientId, project_id: liveProject, client_visible: true });
  });
  beforeEach(() => {
  });
  afterAll(async () => {
    await prisma.bastChatEvent.deleteMany({ where: { conversation_id: { in: convIds } } });
    await prisma.bastChatConversation.deleteMany({ where: { id: { in: convIds } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.projectPhase.deleteMany({ where: { project_id: { in: fx.projectIds } } });
    await prisma.projectPage.deleteMany({ where: { project_id: { in: fx.projectIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  const taskRow = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  // The change lines the SERVER wrote for the desk (TriageChange rows); a desk change is never a comment.
  const sessionNotes = (id: string) => prisma.triageChange.findMany({ where: { task_id: id, by_lane: 'triage-desk' }, orderBy: { created_at: 'asc' } }).then((rows) => rows.map((r) => ({ ...r, content: r.line })));

  describe('reads', () => {
    it('reads a task, its comments, its questions and the /triage card payload', async () => {
      as(desk());
      expect((await getTask(call(undefined, 'GET'), idParams(card))).status).toBe(200);
      expect((await getTask(call(undefined, 'GET'), idParams(liveTask))).status).toBe(200);
      expect((await getComments(call(undefined, 'GET'), idParams(card))).status).toBe(200);
      expect((await getQs(call(undefined, 'GET'), idParams(card))).status).toBe(200);
      const c = await json(await getTriage(call(undefined, 'GET'), idParams(card)));
      expect(c.status).toBe(200);
      expect(c.body.task_id).toBe(card);
      expect(c.body.recent_changes).toEqual([]);
    });
  });

  describe('the card conversation', () => {
    const OWNER = MIKE_USER_ID;
    const fakeDb = () => ({
      bastChatSettings: { findUnique: async () => ({ owner_user_id: OWNER }) },
      bastChatConversation: prisma.bastChatConversation,
      bastChatEvent: prisma.bastChatEvent,
    });

    beforeAll(async () => {
      const conv = await prisma.bastChatConversation.create({ data: { owner_id: OWNER, task_id: card, status: 'idle', title: 'About the card' } });
      convId = conv.id;
      convIds.push(conv.id);
      const ev = (seq: number, role: 'mike' | 'assistant' | 'tool' | 'system', kind: 'text' | 'action' | 'result' | 'status' | 'cost', payload: object, extra: object = {}) =>
        prisma.bastChatEvent.create({ data: { conversation_id: conv.id, seq, role, kind, payload, ...extra } });
      await ev(1, 'mike', 'text', { text: 'What is left on this one?' }, { context: { kind: 'task', id: card } });
      await ev(2, 'tool', 'action', { tool: 'get_task', label: 'Reading the card', args_summary: 'id=secret-args' });
      await ev(3, 'tool', 'result', { tool: 'get_task', ok: true, summary: 'TOOL RESULT DETAIL' });
      await ev(4, 'assistant', 'text', { text: 'Ten pages are drafted and the footer is not.' });
      await ev(5, 'assistant', 'text', { text: 'The key is Bearer abcdefghijklmnop1234567890 and token: AbCdEfGhIjKlMnOp1234567890xyz' });
      await ev(6, 'assistant', 'text', { text: 'something private', redacted: true });
      await ev(7, 'assistant', 'text', { text: '[redacted: contained a password]' });
      await ev(8, 'system', 'status', { code: 'offline', text: 'The machine was off.' });
      await ev(9, 'assistant', 'cost', { turn_usd: 0.1 });
      await ev(10, 'mike', 'text', { text: 'Did you see my last note?' }, { expired_at: new Date() });
      await prisma.bastChatConversation.update({ where: { id: conv.id }, data: { last_seq: 10, last_message_at: new Date() } });
      // the general home chat: Mike has the card open while he talks about something else, and the assistant answers
      const home = await prisma.bastChatConversation.create({ data: { owner_id: OWNER, task_id: null, status: 'closed' } });
      convIds.push(home.id);
      await prisma.bastChatEvent.create({ data: { conversation_id: home.id, seq: 1, role: 'mike', kind: 'text', payload: { text: 'HOME CHAT MESSAGE with the card open' }, context: { kind: 'task', id: card } } });
      await prisma.bastChatEvent.create({ data: { conversation_id: home.id, seq: 2, role: 'assistant', kind: 'text', payload: { text: 'HOME CHAT REPLY' } } });
    });

    it('returns the turns in order: who spoke, when, the text; tool detail, costs and status notes are left out', async () => {
      const r = await readCardConversation(card, {}, fakeDb() as never);
      expect(r.conversation).toMatchObject({ id: convId, status: 'idle' });
      expect(r.turns.map((t) => [t.seq, t.who])).toEqual([[1, 'mike'], [4, 'bast'], [5, 'bast'], [6, 'bast'], [7, 'bast'], [10, 'mike']]);
      expect(r.turns[0]).toMatchObject({ text: 'What is left on this one?' });
      expect(typeof r.turns[0].at).toBe('string');
      expect(r.turns[1].text).toBe('Ten pages are drafted and the footer is not.');
      const text = JSON.stringify(r);
      for (const hidden of ['TOOL RESULT DETAIL', 'secret-args', 'The machine was off', 'turn_usd']) expect(text, hidden).not.toContain(hidden);
    });

    it('a turn the daemon redacted stays redacted (flag or bracket marker); credentials are removed from the rest', async () => {
      const r = await readCardConversation(card, {}, fakeDb() as never);
      const bySeq = (n: number) => r.turns.find((t) => t.seq === n)!;
      expect(bySeq(6)).toMatchObject({ redacted: true, text: null });
      expect(bySeq(7)).toMatchObject({ redacted: true, text: null });
      expect(JSON.stringify(r)).not.toContain('something private');
      expect(bySeq(5).text).not.toContain('abcdefghijklmnop1234567890');
      expect(bySeq(5).text).not.toContain('AbCdEfGhIjKlMnOp1234567890xyz');
      expect(bySeq(5).text).toContain('[redacted]');
      expect(bySeq(10)).toMatchObject({ not_answered: true });
    });

    it('does not return the general home chat, and says so', async () => {
      const r = await readCardConversation(card, {}, fakeDb() as never);
      expect(JSON.stringify(r)).not.toContain('HOME CHAT');
      expect(r.home_chat).toEqual({ included: false, note: HOME_CHAT_NOTE });
    });

    it('pages with after and limit; a card with no conversation is an empty list', async () => {
      const p1 = await readCardConversation(card, { limit: 2 }, fakeDb() as never);
      expect(p1.turns.map((t) => t.seq)).toEqual([1, 4]);
      expect(p1.has_more).toBe(true);
      const p2 = await readCardConversation(card, { after: p1.last_seq, limit: 50 }, fakeDb() as never);
      expect(p2.turns.map((t) => t.seq)).toEqual([5, 6, 7, 10]);
      expect(p2.has_more).toBe(false);
      const none = await readCardConversation(card2, {}, fakeDb() as never);
      expect([none.conversation, none.turns]).toEqual([null, []]);
    });

    it('scrubSecrets is linear on a large input', () => {
      const big = 'a='.repeat(500_000);
      const t0 = Date.now();
      scrubSecrets(big);
      scrubSecrets('A'.repeat(1_000_000));
      expect(Date.now() - t0).toBeLessThan(2000);
    });

    describe('the route', () => {
      beforeEach(() => {
        routeDb.current = fakeDb();
      });
      const get = (id: string) => getConversation(call(undefined, 'GET', `http://localhost/api/tasks/${id}/conversation`), idParams(id));

      it('the desk and Mike read it; tech, designer, dox and a bot key with no lane do not', async () => {
        as(desk());
        const ok = await json(await get(card));
        expect(ok.status).toBe(200);
        expect(ok.body.turns.length).toBe(6);
        as(mikeSession());
        expect((await get(card)).status).toBe(200);
        for (const a of [
          { userId: '7f1c0000-0000-4000-8000-0000000000a1', role: 'tech', email: 't@x.test', via: 'session' },
          { userId: '7f1c0000-0000-4000-8000-0000000000a2', role: 'designer', email: 'd@x.test', via: 'session' },
          { userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'k0' },
          dox(),
        ] as AuthPayload[]) {
          as(a);
          expect((await get(card)).status, JSON.stringify(a)).toBe(403);
        }
      });

      it('a missing task is a 404', async () => {
        as(desk());
        expect((await get('7f1c0000-0000-4000-8000-0000000000ee')).status).toBe(404);
      });
    });
  });

  describe('card edits, and the "changed by a session" record', () => {
    it('sets the kind and links a queued project; each change is stamped, shows on the card and calls the revision hook', async () => {
      as(desk());
      const r = await json(await patchTriage(call({ kind: 'project_setup', project_id: queueProject }, 'PATCH'), idParams(card)));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.kind).toBe('project_setup');
      const row = await taskRow(card);
      expect([row.triage_kind, row.project_id, row.status]).toEqual(['project_setup', queueProject, 'triage']);
      const notes = await sessionNotes(card);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ by: 'a session', by_lane: 'triage-desk' });
      expect(notes[0].line).toBe('Kind and Project link changed by a session');
      expect(row.triage_rev).toBe(1);
      expect(r.body.recent_changes[0]).toMatchObject({ by: 'a session', line: 'Kind and Project link changed by a session' });
      expect(await prisma.comment.count({ where: { task_id: card, content: { startsWith: 'Changed by a session' } } })).toBe(0);
    });

    it('sets the dates of a project the portal hides (queue)', async () => {
      as(desk());
      const r = await json(await patchTriage(call({ target_start_date: '2026-12-01', target_launch_date: '2027-02-01' }, 'PATCH'), idParams(card)));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect([r.body.target_start_date, r.body.target_launch_date]).toEqual(['2026-12-01', '2027-02-01']);
    });

    it('refuses the dates of a project the portal shows, and any field a card does not have', async () => {
      const shownCard = await fx.mkTask('Card on a live project', { status: 'triage', triage_kind: 'project_setup', project_id: liveProject, client_id: fx.clientId });
      as(desk());
      const r = await json(await patchTriage(call({ target_launch_date: '2027-03-01' }, 'PATCH'), idParams(shownCard)));
      expect([r.status, r.body.code]).toEqual([403, 'desk_client_closed']);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: liveProject } })).target_date).toBeNull();
      expect((await json(await patchTriage(call({ status: 'not_started' }, 'PATCH'), idParams(card)))).status).toBe(400);
    });

    it('redraws the shape of a queued project; refuses a live one', async () => {
      as(desk());
      const ok = await json(await putShape(call({ phases: [{ name: 'Design', mike_part: 'Pick one option' }], pages: [{ name: 'Home' }] }, 'PUT'), idParams(card)));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await prisma.projectPhase.count({ where: { project_id: queueProject } })).toBe(1);
      expect((await sessionNotes(card)).some((n) => /Shape redrawn by a session/.test(n.content))).toBe(true);
      const live = await fx.mkTask('Card, live project', { status: 'triage', triage_kind: 'project_setup', project_id: liveProject });
      const no = await json(await putShape(call({ pages: [{ name: 'Home' }] }, 'PUT'), idParams(live)));
      expect(no.status).toBe(409);
      expect(await prisma.projectPage.count({ where: { project_id: liveProject } })).toBe(0);
    });

    it('marks a Triage card looks-done (and nothing else through the task route)', async () => {
      as(desk());
      const ok = await json(await patchTask(call({ tags_add: ['triage:looks-done'] }, 'PATCH'), idParams(card2)));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await taskRow(card2)).tags).toContain('triage:looks-done');
      expect((await sessionNotes(card2)).map((n) => n.content)).toEqual(['marked the card looks-done by a session']);
      expect((await taskRow(card2)).status).toBe('triage');
    });

    it.each([
      ['release (status)', { status: 'not_started' }],
      ['drop (status abandoned)', { status: 'abandoned' }],
      ['close (status done)', { status: 'done' }],
      ['rename', { title: 'Renamed' }],
      ['describe', { description: 'New text' }],
      ['assign', { assignee_id: BOT_ID }],
      ['the checklist', { requirements: [] }],
      ['a tag other than looks-done', { tags_add: ['needs-mike'] }],
      ['looks-done together with a status', { tags_add: ['triage:looks-done'], status: 'done' }],
      ['share with the client', { client_visible: true }],
    ])('cannot %s on a Triage card', async (_n, body) => {
      const c = await fx.mkTask('Untouchable card', { status: 'triage' });
      as(desk());
      const r = await json(await patchTask(call(body, 'PATCH'), idParams(c)));
      expect([r.status, r.body.code]).toEqual([403, 'desk_field_closed']);
      const row = await taskRow(c);
      expect([row.status, row.title, row.client_visible, row.tags]).toEqual(['triage', `${fx.tag} Untouchable card`, false, []]);
      expect(await sessionNotes(c)).toEqual([]);
    });

    it('cannot touch a task that is not in Triage: not a status, not a tag, not looks-done', async () => {
      as(desk());
      for (const body of [{ status: 'done' }, { tags_add: ['triage:looks-done'] }, { title: 'x' }]) {
        const r = await json(await patchTask(call(body, 'PATCH'), idParams(liveTask)));
        expect([r.status, r.body.code], JSON.stringify(body)).toEqual([403, 'desk_not_triage']);
      }
      expect((await taskRow(liveTask)).status).toBe('not_started');
    });

    it('cannot change the title, description, checklist or status of a task the client can see', async () => {
      as(desk());
      for (const body of [{ title: 'Renamed' }, { description: 'x' }, { requirements: [] }, { status: 'done' }, { client_id: null }, { project_id: null }]) {
        const r = await json(await patchTask(call(body, 'PATCH'), idParams(sharedTask)));
        expect(r.status, JSON.stringify(body)).toBe(403);
      }
      const row = await taskRow(sharedTask);
      expect([row.title, row.status]).toEqual([`${fx.tag} Shared with the client`, 'not_started']);
    });

    it("the delete route refuses a Triage card for this lane (dropping is Mike's and the chat's)", async () => {
      const c = await fx.mkTask('Do not drop', { status: 'triage' });
      as(desk());
      const r = await json(await deleteTask(call(undefined, 'DELETE'), idParams(c)));
      expect([r.status, r.body.code]).toEqual([403, 'triage_exit_forbidden']);
      expect((await taskRow(c)).is_deleted).toBe(false);
    });
  });

  describe('questions', () => {
    it('asks on a Triage card (stamped with the lane), edits its own, withdraws with a reason; each is recorded', async () => {
      as(desk());
      const asked = await json(await addQ(call({ question: 'Ten pages or twelve?', ...CTX }), idParams(card)));
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      expect(asked.body.asked_by_lane).toBe('triage-desk');
      const qid = asked.body.id as string;
      const edited = await json(await patchQ(call({ what_it_is: 'The deal says twelve pages and the thread says ten, and nobody has said which one stands.' }, 'PATCH'), qParams(card, qid)));
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const noReason = await json(await patchQ(call({ withdraw: true }, 'PATCH'), qParams(card, qid)));
      expect([noReason.status, noReason.body.code]).toEqual([400, 'desk_reason_required']);
      const gone = await json(await patchQ(call({ withdraw: true, reason: 'The thread answered it.' }, 'PATCH'), qParams(card, qid)));
      expect(gone.status, JSON.stringify(gone.body)).toBe(200);
      expect(gone.body.state).toBe('withdrawn');
      expect(gone.body.withdrawn_reason).toBe('The thread answered it.');
      const lines = (await sessionNotes(card)).map((n) => n.content);
      expect(lines.some((l) => /Question added by a session/.test(l))).toBe(true);
      expect(lines.some((l) => /Question changed by a session/.test(l))).toBe(true);
      expect(lines.some((l) => /Question withdrawn by a session/.test(l))).toBe(true);
    });

    it('cannot edit or withdraw a question somebody else asked, cannot answer one, cannot ask on a task outside Triage', async () => {
      const base = { task_id: card2, what_it_is: 'x'.repeat(30), sources: [], checked: 'y', unknown: 'z', if_nobody: 'go', if_nobody_action: 'wait' as const };
      const theirs = await prisma.taskQuestion.create({ data: { ...base, position: 0, question: 'Mike asked this?', asked_by_user_id: MIKE_USER_ID, asked_by_lane: null } });
      as(desk());
      const edit = await json(await patchQ(call({ withdraw: true, reason: 'because' }, 'PATCH'), qParams(card2, theirs.id)));
      expect([edit.status, edit.body.code]).toEqual([403, 'desk_not_yours']);
      const doxQ = await prisma.taskQuestion.create({ data: { ...base, position: 1, question: 'Dox asked this?', asked_by_user_id: BOT_ID, asked_by_lane: 'dox' } });
      expect((await json(await patchQ(call({ withdraw: true, reason: 'because' }, 'PATCH'), qParams(card2, doxQ.id)))).body.code).toBe('desk_not_yours');
      expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: theirs.id } })).state).toBe('open');
      // answering: not on the lane list and refused again inside the route
      const ans = await json(await answerQ(call({ option_id: 'a', version: theirs.updated_at.toISOString() }), qParams(card2, theirs.id)));
      expect([ans.status, ans.body.code]).toEqual([403, 'not_mike']);
      expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: theirs.id } })).state).toBe('open');
      const off = await json(await addQ(call({ question: 'On a live task?', ...CTX }), idParams(liveTask)));
      expect([off.status, off.body.code]).toEqual([403, 'desk_not_triage']);
    });
  });

  describe('comments', () => {
    it('adds an internal comment stamped with the lane, on a Triage card or any task, and never a client-visible one', async () => {
      as(desk());
      for (const id of [card, liveTask, sharedTask]) {
        const r = await json(await addComment(call({ content: 'A note from the session', is_internal: false }), idParams(id)));
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        expect([r.body.is_internal, r.body.client_visible, r.body.actor_lane]).toEqual([true, false, 'triage-desk']);
      }
      for (const body of [{ content: 'x', client_visible: true }, { content: 'x', client_visible: true, client_question: true }]) {
        const r = await json(await addComment(call(body), idParams(sharedTask)));
        expect([r.status, r.body.code]).toEqual([403, 'desk_client_closed']);
      }
      expect(await prisma.comment.count({ where: { task_id: sharedTask, client_visible: true } })).toBe(0);
    });
  });
});
