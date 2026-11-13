// @vitest-environment node
/**
 * Card questions against a real scratch Postgres: the answer transaction (answer fields, the wake comment, the marker tag and
 * needs-mike), who may answer, release defaulted vs wait, Undo, who may read while a card is in triage, contractor and designer 404s,
 * and that the client portal never reads the table.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { runHomeAct, runHomeUndo } from '@/lib/home/act';
import { loadTriage, release } from '@/lib/tasks/triage';
import { GET as listQ, POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { PATCH as patchQ } from '@/app/api/tasks/[id]/questions/[qid]/route';
import { POST as answerQ } from '@/app/api/tasks/[id]/questions/[qid]/answer/route';
import { HELD_TAG, NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK, HELD_ANSWER_PREFIX } from '../questions';
import { QUESTION_CHANGED_MESSAGE } from '../question-context';

const authMock = requireAuth as Mock;
const NOW = new Date();
const OPTS = { now: NOW, timezone: 'America/New_York', date: NOW.toISOString().slice(0, 10) };
const taskParams = (id: string) => ({ params: Promise.resolve({ id }) });
const qParams = (id: string, qid: string) => ({ params: Promise.resolve({ id, qid }) });
const req = (body?: unknown) => new NextRequest('http://localhost/api/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const CONTEXT = {
  what_it_is: 'The kava finder page needs a decision before the build starts.',
  sources: [{ who: 'Mike', said: 'Decide after the client call', at: '2026-11-10' }],
  checked: 'The page and the client brief were both read.',
  unknown: 'Whether the client wants the map on mobile.',
  if_nobody: 'The card is released and the first option goes ahead.',
};
const withOptions = (question: string, action: 'go_with_recommendation' | 'wait' = 'go_with_recommendation') => ({
  ...CONTEXT,
  question,
  options: [
    { id: 'map', label: 'Show the map', consequence: 'Heavier page, easier to browse.' },
    { id: 'list', label: 'List only', consequence: 'Lighter page, no map.' },
  ],
  recommended_option_id: 'map',
  recommend_why: 'Visitors look for a bar near them first.',
  if_nobody_action: action,
});
const freeText = (question: string, action: 'go_with_recommendation' | 'wait' = 'wait') => ({ ...CONTEXT, question, if_nobody_action: action });

describe.skipIf(!SCRATCH)('card questions (real database)', () => {
  const tag = `cq${Date.now()}`;
  const taskIds: string[] = [];
  let techId: string;
  let designerId: string;
  let askerId: string;
  let strangerId: string; // another admin who did not ask
  let botId: string;
  let clientId: string;
  let contactId: string;
  const projectIds: string[] = [];

  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
  const mikeKey = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'k0' });
  const chat = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k3', lane: 'bast-chat', laneEnforced: true });
  const botKey = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k4' });
  const asker = (): AuthPayload => ({ userId: askerId, role: 'pm', email: 'a@test', via: 'session' });
  const stranger = (): AuthPayload => ({ userId: strangerId, role: 'admin', email: 's@test', via: 'session' });
  const tech = (): AuthPayload => ({ userId: techId, role: 'tech', email: 't@test', via: 'session' });
  const designer = (): AuthPayload => ({ userId: designerId, role: 'designer', email: 'd@test', via: 'session' });
  const as = (a: AuthPayload) => authMock.mockResolvedValue(a);

  const mkTask = async (title: string, extra: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', ...extra } as never });
    taskIds.push(t.id);
    return t.id;
  };
  const ask = async (taskId: string, body: Record<string, unknown>, who: AuthPayload = chat()) => {
    as(who);
    const res = await addQ(req(body), taskParams(taskId));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return (await res.json()) as { id: string };
  };
  /** Answer the way the screen does: with the question version it last read. */
  const answer = async (taskId: string, qid: string, body: Record<string, unknown>) => {
    const row = /^[0-9a-f-]{36}$/i.test(qid) ? await prisma.taskQuestion.findUnique({ where: { id: qid } }) : null;
    return answerQ(req({ version: row ? row.updated_at.toISOString() : 'none', ...body }), qParams(taskId, qid));
  };
  const task = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const q = (id: string) => prisma.taskQuestion.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BOT_USER_IDS[0] }, update: {}, create: { id: BOT_USER_IDS[0], email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    botId = BOT_USER_IDS[0];
    const mkUser = async (name: string, role: 'tech' | 'designer' | 'admin' | 'pm') => (await prisma.user.create({ data: { email: `${name}-${tag}@example.test`, password_hash: 'x', name, role } })).id;
    techId = await mkUser('tech', 'tech');
    designerId = await mkUser('designer', 'designer');
    askerId = await mkUser('asker', 'pm');
    strangerId = await mkUser('stranger', 'admin');
    clientId = (await prisma.client.create({ data: { name: `${tag} Co`, type: 'direct', status: 'active' } })).id;
    contactId = (await prisma.clientContact.create({ data: { client_id: clientId, name: 'Olive', email: `olive-${tag}@example.test`, portal_role: 'owner', can_initiate_work: true } })).id;
  });
  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { user_id: MIKE_USER_ID, action: { startsWith: 'triage_' } } });
    await prisma.notification.deleteMany({ where: { entity_id: { in: taskIds } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [techId, designerId, askerId, strangerId] } } });
    await prisma.$disconnect();
  });

  describe('filing', () => {
    it('stores a complete question and refuses a thin one with the missing parts named', async () => {
      const t = await mkTask('filing');
      const row = await ask(t, withOptions('Show the map on the finder page?'));
      expect((await q(row.id)).state).toBe('open');
      as(chat());
      const thin = await addQ(req({ question: 'Show the map?', if_nobody_action: 'wait' }), taskParams(t));
      expect(thin.status).toBe(400);
      const body = JSON.stringify(await thin.json());
      for (const part of ['what_it_is', 'sources', 'checked', 'unknown', 'if_nobody']) expect(body).toContain(part);
      expect(await prisma.taskQuestion.count({ where: { task_id: t } })).toBe(1);
    });

    it('refuses a duplicate and an eleventh open question', async () => {
      const t = await mkTask('limits');
      await ask(t, freeText('Is the first one fine?'));
      as(chat());
      expect((await addQ(req(freeText('Is the first one fine?')), taskParams(t))).status).toBe(409);
      for (let i = 2; i <= 10; i++) await ask(t, freeText(`Is number ${i} fine?`));
      as(chat());
      const eleventh = await addQ(req(freeText('Is number 11 fine?')), taskParams(t));
      expect(eleventh.status).toBe(409);
      expect((await eleventh.json()).code).toBe('too_many_open');
    });
  });

  describe('answering', () => {
    it('one transaction: answer fields, a wake comment as Mike with the question id, tags removed when it was the last open question', async () => {
      const t = await mkTask('answer', { status: 'not_started', tags: ['keep', HELD_TAG, NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK] });
      const a = await ask(t, withOptions('Show the map on the finder page?', 'wait'));
      const b = await ask(t, freeText('Which week does the client want it live?'));
      as(mike());
      const first = await answer(t, a.id, { option_id: 'map' });
      expect(first.status).toBe(200);
      const j = await first.json();
      expect(j.hold_released).toBe(false); // one still open
      expect((await task(t)).tags).toEqual(['keep', HELD_TAG, NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK]);
      expect(j.question.citation).toMatch(/^Mike, \d{4}-\d{2}-\d{2}, on "Show the map on the finder page\?": "Show the map"$/);

      const last = await answer(t, b.id, { text: 'The week of the 23rd, and not before.' });
      expect((await last.json()).hold_released).toBe(true);
      expect((await task(t)).tags).toEqual(['keep']); // marker and needs-mike both gone, the other tag untouched

      const wake = await prisma.comment.findMany({ where: { task_id: t }, orderBy: { created_at: 'asc' } });
      expect(wake).toHaveLength(2);
      expect(wake[1]).toMatchObject({ user_id: MIKE_USER_ID, is_internal: true, client_visible: false, client_question: false });
      expect(wake[1].content).toBe('Answer on "Which week does the client want it live?": The week of the 23rd, and not before.');
      expect(wake[1].chat_meta).toEqual({ question: { id: b.id } });
      const row = await q(b.id);
      expect(row).toMatchObject({ state: 'answered', answer_text: 'The week of the 23rd, and not before.', answered_by_id: MIKE_USER_ID, answer_comment_id: wake[1].id });
    });

    it('does not remove a needs-mike that something else set (no marker tag)', async () => {
      const t = await mkTask('foreign tag', { status: 'not_started', tags: [NEEDS_MIKE_TAG] });
      const a = await ask(t, freeText('Anything to add here?'));
      as(mike());
      expect((await answer(t, a.id, { text: 'No.' })).status).toBe(200);
      expect((await task(t)).tags).toEqual([NEEDS_MIKE_TAG]);
    });

    it('answering again replaces the answer and every answer stays in the comments; GET returns the newest citation', async () => {
      const t = await mkTask('again');
      const a = await ask(t, withOptions('Show the map on the finder page?'));
      as(mike());
      await answer(t, a.id, { option_id: 'map' });
      await answer(t, a.id, { option_id: 'list', text: 'only until launch' });
      const comments = await prisma.comment.findMany({ where: { task_id: t }, orderBy: { created_at: 'asc' } });
      expect(comments.map((c) => c.content)).toEqual([
        'Answer on "Show the map on the finder page?": Show the map',
        'Answer on "Show the map on the finder page?": List only: only until launch',
      ]);
      const got = await (await listQ(req(), taskParams(t))).json();
      expect(got.questions[0]).toMatchObject({ state: 'answered', answer_option_id: 'list', answer_text: 'List only: only until launch' });
      expect(got.questions[0].citation).toContain('"List only: only until launch"');
      expect(got.open_count).toBe(0);
    });

    it('the chat lane relays his words with the "From Mike, through the chat" prefix', async () => {
      const t = await mkTask('chat answer');
      const a = await ask(t, freeText('Which week does the client want it live?'));
      as(chat());
      const res = await answer(t, a.id, { text: 'Week of the 23rd' });
      expect(res.status).toBe(200);
      const c = await prisma.comment.findFirstOrThrow({ where: { task_id: t } });
      expect(c.content).toBe('From Mike, through the chat: Answer on "Which week does the client want it live?": Week of the 23rd');
      expect(c).toMatchObject({ user_id: botId, actor_lane: 'bast-chat', is_internal: true });
      expect((await q(a.id)).answered_by_id).toBe(MIKE_USER_ID);
    });

    it("nobody else can answer: another admin, a bot key, Mike's own API key, the asker, a tech", async () => {
      const t = await mkTask('refuse', { status: 'not_started', assignee_id: techId });
      const a = await ask(t, freeText('Which week does the client want it live?'), asker());
      for (const who of [stranger(), asker(), botKey(), mikeKey(), tech()]) {
        as(who);
        const res = await answer(t, a.id, { text: 'Friday' });
        expect(res.status, who.userId).toBe(403);
      }
      expect((await q(a.id)).state).toBe('open');
      expect(await prisma.comment.count({ where: { task_id: t } })).toBe(0);
    });

    it('a bad option, a withdrawn question and a foreign question id are refused', async () => {
      const t = await mkTask('bad');
      const other = await mkTask('other');
      const a = await ask(t, withOptions('Show the map on the finder page?'));
      as(mike());
      expect((await answer(t, a.id, { option_id: 'nope' })).status).toBe(400);
      expect((await answer(other, a.id, { text: 'x' })).status).toBe(404);
      expect((await answer(t, 'not-a-uuid', { text: 'x' })).status).toBe(404);
      as(chat());
      expect((await patchQ(req({ withdraw: true, reason: 'Settled elsewhere.' }), qParams(t, a.id))).status).toBe(200);
      as(mike());
      expect((await answer(t, a.id, { text: 'x' })).status).toBe(409);
    });

    it('withdrawing the last open question frees the hold', async () => {
      const t = await mkTask('withdraw', { status: 'not_started', tags: [HELD_TAG, NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK] });
      const a = await ask(t, freeText('Anything to add here?'));
      as(chat());
      await patchQ(req({ withdraw: true }), qParams(t, a.id));
      expect((await task(t)).tags).toEqual([]);
    });

    it('notifies a human asker other than Mike', async () => {
      const t = await mkTask('notify', { status: 'not_started', assignee_id: askerId });
      const a = await ask(t, freeText('Anything to add here?'), asker());
      as(mike());
      await answer(t, a.id, { text: 'Go ahead.' });
      const n = await prisma.notification.findMany({ where: { user_id: askerId, entity_id: t } });
      expect(n.length).toBeGreaterThan(0);
    });

    it('an edit that drops a Context part is refused', async () => {
      const t = await mkTask('edit');
      const a = await ask(t, withOptions('Show the map on the finder page?'));
      as(chat());
      expect((await patchQ(req({ checked: 'n/a' }), qParams(t, a.id))).status).toBe(400);
      const ok = await patchQ(req({ checked: 'Re-read the client brief and the page again today.' }), qParams(t, a.id));
      expect(ok.status).toBe(200);
    });
  });

  describe('release from triage', () => {
    it('go_with_recommendation becomes defaulted, never his words; wait holds the card with the marker tags; the toast says so; Undo restores both exactly', async () => {
      const t = await mkTask('release', { tags: ['keep'] });
      const g = await ask(t, withOptions('Show the map on the finder page?', 'go_with_recommendation'));
      const w = await ask(t, freeText('Which week does the client want it live?', 'wait'));
      const res = await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release', task_ids: [t] }, OPTS);
      expect(res.message).toContain('1 question goes with the recommendation, 1 waits for you.');
      expect((await task(t)).status).toBe('not_started');
      expect((await task(t)).tags.sort()).toEqual([HELD_TAG, NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK, 'keep'].sort());
      expect(await q(g.id)).toMatchObject({ state: 'defaulted', answer_text: null, answered_at: null, answered_by_id: null });
      expect((await q(g.id)).defaulted_at).not.toBeNull();
      expect((await q(w.id)).state).toBe('open');
      expect(await prisma.comment.count({ where: { task_id: t } })).toBe(0); // nothing written as his words

      as(mike());
      const got = await (await listQ(req(), taskParams(t))).json();
      const gq = got.questions.find((x: { id: string }) => x.id === g.id);
      expect(gq).toMatchObject({ state: 'defaulted', released_without_answer: true, citation: null, answer_text: null });

      await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, OPTS.now);
      expect((await task(t)).status).toBe('triage');
      expect((await task(t)).tags).toEqual(['keep']);
      expect((await q(g.id)).state).toBe('open');
      expect((await q(g.id)).defaulted_at).toBeNull();
      expect((await q(w.id)).state).toBe('open');
    });

    it('does not add needs-mike when it is already on the card, and undo leaves it there', async () => {
      const t = await mkTask('pre tagged', { tags: [NEEDS_MIKE_TAG] });
      await ask(t, freeText('Which week does the client want it live?', 'wait'));
      const res = await release(prisma, MIKE_USER_ID, [t], NOW);
      expect((await task(t)).tags.sort()).toEqual([HELD_TAG, NEEDS_MIKE_TAG].sort());
      await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
      expect((await task(t)).tags).toEqual([NEEDS_MIKE_TAG]);
    });

    it('answering the last waiting question after release frees the card, and Undo then leaves it alone', async () => {
      const t = await mkTask('answer after release');
      const w = await ask(t, freeText('Which week does the client want it live?', 'wait'));
      const res = await release(prisma, MIKE_USER_ID, [t], NOW);
      as(mike());
      await answer(t, w.id, { text: 'Week of the 23rd' });
      expect((await task(t)).tags).toEqual([]);
      await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
      expect((await task(t)).status).toBe('not_started'); // changed since the tap: stays released
      expect((await q(w.id)).state).toBe('answered');
    });

    it('a card without questions releases as before, with no extra sentence', async () => {
      const t = await mkTask('plain');
      const res = await release(prisma, MIKE_USER_ID, [t], NOW);
      expect(res.message).toBe('Released 1 idea from Triage.');
    });

    it('the home section counts open questions per card, group and in total', async () => {
      const proj = await prisma.project.create({ data: { name: `${tag} Count job`, status: 'ready', client_id: clientId } });
      projectIds.push(proj.id);
      const a = await mkTask('count a', { project_id: proj.id });
      const b = await mkTask('count b', { project_id: proj.id });
      await ask(a, freeText('Is the first one fine?'));
      await ask(a, freeText('Is the second one fine?'));
      const t = await loadTriage(prisma, MIKE_USER_ID);
      const g = t!.groups.find((x) => x.project_id === proj.id)!;
      expect(g.tasks.find((x) => x.task_id === a)!.open_questions).toBe(2);
      expect(g.tasks.find((x) => x.task_id === b)!.open_questions).toBe(0);
      expect(g.open_questions).toBe(2);
      expect(t!.open_questions).toBeGreaterThanOrEqual(2);
    });
  });

  describe('who can read', () => {
    it('while the card is in triage: Mike, the chat lane, a bot key and the asker read; another admin, a tech and a designer get 404', async () => {
      const t = await mkTask('visibility', { assignee_id: techId });
      await ask(t, freeText('Which week does the client want it live?'), asker());
      for (const who of [mike(), chat(), botKey(), asker()]) {
        as(who);
        const res = await listQ(req(), taskParams(t));
        expect(res.status, who.userId).toBe(200);
      }
      for (const who of [stranger(), tech(), designer()]) {
        as(who);
        expect((await listQ(req(), taskParams(t))).status, who.role).toBe(404);
      }
      for (const who of [tech(), designer()]) {
        as(who);
        expect((await addQ(req(freeText('Is this allowed?')), taskParams(t))).status, who.role).toBe(404);
      }
    });

    it('after release anyone who can see the task reads; a designer and a tech who cannot see it still get 404; only Mike answers', async () => {
      const proj = await prisma.project.create({ data: { name: `${tag} Team job`, status: 'ready', client_id: clientId } });
      projectIds.push(proj.id);
      const t = await mkTask('after release', { project_id: proj.id, assignee_id: techId });
      const a = await ask(t, freeText('Which week does the client want it live?'));
      await release(prisma, MIKE_USER_ID, [t], NOW);
      as(stranger());
      expect((await listQ(req(), taskParams(t))).status).toBe(200);
      as(designer());
      expect((await listQ(req(), taskParams(t))).status).toBe(404);
      as(tech());
      expect((await listQ(req(), taskParams(t))).status).toBe(200); // assigned to it
      expect((await answer(t, a.id, { text: 'x' })).status).toBe(403);
      const lone = await mkTask('hidden from tech', { status: 'not_started' });
      await ask(lone, freeText('Which week does the client want it live?'));
      as(tech());
      expect((await listQ(req(), taskParams(lone))).status).toBe(404);
    });
  });

  describe('the client portal never reads questions', () => {
    it('no portal source file touches task questions, and an answer never leaves a client-visible comment', async () => {
      const root = path.resolve(__dirname, '../../..');
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (name === 'node_modules' || name === '__tests__' || name === '.next') continue;
          if (statSync(full).isDirectory()) walk(full);
          else if (/\.(ts|tsx)$/.test(name) && /taskQuestion|task_questions|tasks\/questions/.test(readFileSync(full, 'utf8'))) hits.push(path.relative(root, full));
        }
      };
      for (const d of ['lib/portal', 'app/(portal)', 'app/api/portal']) {
        try {
          walk(path.join(root, d));
        } catch {
          // a folder this checkout does not have
        }
      }
      expect(hits).toEqual([]);
      const t = await mkTask('portal', { status: 'not_started', client_id: clientId, client_visible: true, requested_by_contact_id: contactId });
      const a = await ask(t, freeText('Which week does the client want it live?'));
      as(mike());
      await answer(t, a.id, { text: 'Week of the 23rd' });
      expect(await prisma.comment.count({ where: { task_id: t, OR: [{ client_visible: true }, { is_internal: false }] } })).toBe(0);
    });
  });
  describe('review fixes', () => {
    it('a needs-mike set for another reason survives the last answer; one release added is taken off with its marker; Undo restores exactly what release added', async () => {
      const t = await mkTask('pre needs-mike', { tags: [NEEDS_MIKE_TAG, 'other'] });
      const w = await ask(t, freeText('Which week does the client want it live?', 'wait'));
      await release(prisma, MIKE_USER_ID, [t], NOW);
      expect((await task(t)).tags.sort()).toEqual([HELD_TAG, NEEDS_MIKE_TAG, 'other'].sort());
      as(mike());
      expect((await answer(t, w.id, { text: 'Week of the 23rd' })).status).toBe(200);
      expect((await task(t)).tags.sort()).toEqual([NEEDS_MIKE_TAG, 'other'].sort());

      const t2 = await mkTask('release adds needs-mike', { tags: ['other'] });
      const w2 = await ask(t2, freeText('Which week does the client want it live?', 'wait'));
      const res = await release(prisma, MIKE_USER_ID, [t2], NOW);
      expect((await task(t2)).tags.sort()).toEqual([HELD_TAG, NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK, 'other'].sort());
      await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
      expect((await task(t2)).tags).toEqual(['other']);
      await release(prisma, MIKE_USER_ID, [t2], NOW);
      as(mike());
      await answer(t2, w2.id, { text: 'Week of the 23rd' });
      expect((await task(t2)).tags).toEqual(['other']);
    });

    it('an answer to wording he never saw is refused with 409 and stores nothing; after reading again it goes through', async () => {
      const t = await mkTask('stale version');
      const x = await ask(t, withOptions('Show the map on the finder page?', 'wait'));
      as(mike());
      const seen = (await (await listQ(req(), taskParams(t))).json()).questions[0];
      expect(typeof seen.version).toBe('string');
      as(chat());
      const p = await patchQ(req({
        question: 'Delete the finder page entirely?',
        options: [
          { id: 'map', label: 'Delete the whole finder page', consequence: 'The finder page is removed from the site.' },
          { id: 'list', label: 'List only', consequence: 'Lighter page, no map.' },
        ],
      }), qParams(t, x.id));
      expect(p.status).toBe(200);
      as(mike());
      const stale = await answerQ(req({ option_id: 'map', version: seen.version }), qParams(t, x.id));
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toBe(QUESTION_CHANGED_MESSAGE);
      expect(await q(x.id)).toMatchObject({ state: 'open', answer_text: null });
      expect(await prisma.comment.count({ where: { task_id: t } })).toBe(0);
      const typed = await answerQ(req({ text: 'Yes', version: seen.version }), qParams(t, x.id));
      expect(typed.status).toBe(409);
      expect((await answerQ(req({ option_id: 'map' }), qParams(t, x.id))).status).toBe(400); // no version at all
      const fresh = (await (await listQ(req(), taskParams(t))).json()).questions[0];
      const ok = await answerQ(req({ option_id: 'map', version: fresh.version }), qParams(t, x.id));
      expect(ok.status).toBe(200);
      expect((await q(x.id)).answer_text).toBe('Delete the whole finder page');
    });

    it('while another wait question is open the answer is kept as a Bast-authored note, not a human reply; the last answer writes the waking comment as Mike; all answers stay in the comments', async () => {
      const t = await mkTask('wake', { status: 'not_started', tags: [HELD_TAG, NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK] });
      const a = await ask(t, freeText('Which week does the client want it live?', 'wait'));
      const b = await ask(t, freeText('Who tells the client about the delay?', 'wait'));
      as(mike());
      expect((await answer(t, a.id, { text: 'Week of the 23rd' })).status).toBe(200);
      let rows = await prisma.comment.findMany({ where: { task_id: t }, orderBy: { created_at: 'asc' } });
      expect(rows).toHaveLength(1);
      expect(BOT_USER_IDS).toContain(rows[0].user_id);
      expect(rows[0].content).toBe(`${HELD_ANSWER_PREFIX}Answer on "Which week does the client want it live?": Week of the 23rd`);
      expect((await task(t)).tags).toContain(NEEDS_MIKE_TAG);
      as(mike());
      expect((await answer(t, b.id, { text: 'Mike does.' })).status).toBe(200);
      rows = await prisma.comment.findMany({ where: { task_id: t }, orderBy: { created_at: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows[1].user_id).toBe(MIKE_USER_ID); // the last comment is the human one: this is the wake
      expect(rows[1].content).toContain('Mike does.');
      expect((await task(t)).tags).toEqual([]);
    });

    it('the worker lane (bast) reads questions on a card it can see, never on a triage card, and cannot ask or answer', async () => {
      const bast = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k9', lane: 'bast' });
      const t = await mkTask('worker read', { status: 'not_started' });
      await ask(t, freeText('Which week does the client want it live?', 'wait'));
      as(bast());
      const got = await listQ(req(), taskParams(t));
      expect(got.status).toBe(200);
      expect((await got.json()).questions).toHaveLength(1);
      const tri = await mkTask('worker triage');
      await ask(tri, freeText('Which week does the client want it live?', 'wait'));
      as(bast());
      expect((await listQ(req(), taskParams(tri))).status).toBe(404);
      const { laneAllows } = await import('@/lib/auth/lane-scopes');
      expect(laneAllows('bast', 'GET', '/api/tasks/:id/questions')).toBe(true);
      expect(laneAllows('bast', 'POST', '/api/tasks/:id/questions')).toBe(false);
      expect(laneAllows('bast', 'PATCH', '/api/tasks/:id/questions/:qid')).toBe(false);
      expect(laneAllows('bast', 'POST', '/api/tasks/:id/questions/:qid/answer')).toBe(false);
    });

    it('refuses invisible-only parts and a question with no letters or digits; a withdrawn question can be asked again, a live duplicate cannot', async () => {
      const t = await mkTask('validation');
      as(chat());
      const zw = '​'.repeat(20);
      for (const bad of [
        { ...freeText('Is this fine?'), checked: zw },
        { ...freeText('Is this fine?'), what_it_is: `⁠${zw}‍` },
        { ...freeText('Is this fine?'), unknown: 'ㅤ'.repeat(20) },
        freeText('?????'),
        freeText(`${zw}?`),
        freeText('...?!?'),
      ]) {
        expect((await addQ(req(bad), taskParams(t))).status, JSON.stringify(bad).slice(0, 60)).toBe(400);
      }
      expect(await prisma.taskQuestion.count({ where: { task_id: t } })).toBe(0);
      const first = await ask(t, freeText('Is the first one fine?'));
      as(chat());
      expect((await addQ(req(freeText('Is the first one fine?')), taskParams(t))).status).toBe(409);
      expect((await patchQ(req({ withdraw: true }), qParams(t, first.id))).status).toBe(200);
      as(chat());
      expect((await addQ(req(freeText('Is the first one fine?')), taskParams(t))).status).toBe(201);
      as(chat());
      expect((await addQ(req(freeText('Is the first one fine?')), taskParams(t))).status).toBe(409);
    });
  });
});
