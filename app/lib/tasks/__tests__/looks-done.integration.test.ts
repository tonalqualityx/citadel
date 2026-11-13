// @vitest-environment node
/**
 * Triage looks-done against a real scratch Postgres: an agent marks a card (tag + internal comment) without being able to move it;
 * only the owner path closes it as done; the done-guards; 72 hour Undo; Not done; and that nobody outside the owner sees the note.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { patchTask, TRIAGE_EXIT_TEXT } from '@/lib/services/task-patch';
import { runHomeAct, runHomeUndo } from '@/lib/home/act';
import { loadTriage, closeDone, notDone, releasePlan } from '@/lib/tasks/triage';
import { LOOKS_DONE_TAG } from '@/lib/tasks/looks-done';
import { GET as listTasks } from '@/app/api/tasks/route';
import { GET as getComments, POST as postComment } from '@/app/api/tasks/[id]/comments/route';
import { PATCH as patchRoute } from '@/app/api/tasks/[id]/route';

const authMock = requireAuth as Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const NOW = new Date();
const OPTS = { now: NOW, timezone: 'America/New_York', date: NOW.toISOString().slice(0, 10) };
const req = (url: string, method: string, body?: unknown) => new NextRequest(new URL(url), { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) } as never);

describe.skipIf(!SCRATCH)('triage looks-done (real database)', () => {
  const tag = `ldn${Date.now()}`;
  const ids: string[] = [];
  let botId: string;
  let techId: string;
  let adminId: string;
  let card: string;

  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
  const mikeKey = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'k0' });
  const bot = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k1' });
  const workerLane = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k2', lane: 'bast', laneEnforced: true });
  const chatLane = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k3', lane: 'bast-chat', laneEnforced: true });
  const otherAdmin = (): AuthPayload => ({ userId: adminId, role: 'admin', email: 'a@test', via: 'session' });
  const pm = (): AuthPayload => ({ userId: adminId, role: 'pm', email: 'p@test', via: 'session' });
  const tech = (): AuthPayload => ({ userId: techId, role: 'tech', email: 't@test', via: 'session' });
  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const mk = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', ...data } as never });
    ids.push(t.id);
    return t.id;
  };
  const mark = async (id: string, text = 'Looks done: shipped in commit abc1234, see https://example.test/page.') => {
    const t = await row(id);
    await patchTask({ actor: bot(), id, body: { tags: [...t.tags, LOOKS_DONE_TAG] } });
    return (await prisma.comment.create({ data: { task_id: id, user_id: botId, content: text, is_internal: true, client_visible: false } })).id;
  };

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.userPreference.upsert({ where: { user_id: MIKE_USER_ID }, update: { home_view: 'home' }, create: { user_id: MIKE_USER_ID, home_view: 'home' } });
    botId = (await prisma.user.create({ data: { email: `bot-${tag}@example.test`, password_hash: 'x', name: 'Bot', role: 'pm' } })).id;
    techId = (await prisma.user.create({ data: { email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech', role: 'tech' } })).id;
    adminId = (await prisma.user.create({ data: { email: `adm-${tag}@example.test`, password_hash: 'x', name: 'Adm', role: 'admin' } })).id;
    await prisma.userPreference.create({ data: { user_id: adminId, home_view: 'home' } });
  });
  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { user_id: { in: [MIKE_USER_ID, adminId] }, action: { startsWith: 'triage_' } } });
    await prisma.notification.deleteMany({ where: { user_id: techId } });
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    for (const id of ids) await prisma.task.update({ where: { id }, data: { blocked_by: { set: [] } } }).catch(() => {});
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.userPreference.deleteMany({ where: { user_id: adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [botId, techId, adminId] } } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    card = await mk('idea', { assignee_id: techId });
  });

  describe('marking', () => {
    it('a bot key, the worker lane and the chat lane add the tag with a tags-only PATCH and the card stays in triage', async () => {
      for (const actor of [bot(), workerLane()]) {
        const id = await mk('mark');
        authMock.mockResolvedValue(actor);
        const res = await patchRoute(req(`http://localhost/api/tasks/${id}`, 'PATCH', { tags: [LOOKS_DONE_TAG] }), params(id));
        expect(res.status).toBe(200);
        const t = await row(id);
        expect(t.status).toBe('triage');
        expect(t.tags).toContain(LOOKS_DONE_TAG);
      }
      // The chat lane's own body filter turns tags_add into the full list inside the route; the patch path it ends in is the same.
      const viaChat = await mk('mark chat');
      expect((await patchTask({ actor: chatLane(), id: viaChat, body: { tags: [LOOKS_DONE_TAG] } })).ok).toBe(true);
      expect((await row(viaChat)).status).toBe('triage');
    });

    it('marking cannot change the status: the same PATCH with a status is refused 403 for every non-owner caller', async () => {
      for (const actor of [bot(), workerLane(), otherAdmin(), pm(), mikeKey()]) {
        for (const status of ['done', 'not_started', 'abandoned']) {
          await expect(patchTask({ actor, id: card, body: { status, tags: [LOOKS_DONE_TAG] } })).rejects.toMatchObject({ statusCode: 403, message: TRIAGE_EXIT_TEXT });
          await expect(patchTask({ actor, id: card, body: { status } })).rejects.toMatchObject({ statusCode: 403 });
        }
      }
      const t = await row(card);
      expect(t.status).toBe('triage');
      expect(t.tags).not.toContain(LOOKS_DONE_TAG);
    });

    it('a bot comment on a triage card is forced internal and never client-visible, whatever it sends', async () => {
      authMock.mockResolvedValue(bot());
      const res = await postComment(req(`http://localhost/api/tasks/${card}/comments`, 'POST', { content: 'Looks done: deployed.', is_internal: false, client_visible: true, client_question: true }), params(card));
      expect(res.status).toBe(201);
      const c = await prisma.comment.findFirstOrThrow({ where: { task_id: card } });
      expect(c.is_internal).toBe(true);
      expect(c.client_visible).toBe(false);
      expect(c.client_question).toBe(false);
    });

    it('a contractor assigned to the card gets no notification and cannot read or write its comments', async () => {
      authMock.mockResolvedValue(bot());
      await postComment(req(`http://localhost/api/tasks/${card}/comments`, 'POST', { content: 'Looks done: deployed.', is_internal: true }), params(card));
      expect(await prisma.notification.count({ where: { user_id: techId, entity_id: card } })).toBe(0);
      authMock.mockResolvedValue(tech());
      expect((await getComments(req(`http://localhost/api/tasks/${card}/comments`, 'GET'), params(card))).status).toBe(404);
      expect((await postComment(req(`http://localhost/api/tasks/${card}/comments`, 'POST', { content: 'hi' }), params(card))).status).toBe(404);
    });

    it('GET /api/tasks?status=triage returns tags, so a tool sees which cards are already marked', async () => {
      const marked = await mk('marked');
      await mark(marked);
      authMock.mockResolvedValue(bot());
      const res = await listTasks(req(`http://localhost/api/tasks?status=triage&limit=100&search=${tag}`, 'GET'));
      const body = await res.json();
      const found = body.tasks.find((t: { id: string }) => t.id === marked);
      expect(found.tags).toContain(LOOKS_DONE_TAG);
      expect(body.tasks.find((t: { id: string }) => t.id === card).tags).not.toContain(LOOKS_DONE_TAG);
    });
  });

  describe('the section', () => {
    it('marked cards come first with their evidence, are not in any group, and the count includes them', async () => {
      const g = await mk('grouped');
      const markedId = await mk('marked two');
      await mark(markedId, 'Looks done: shipped, https://example.test/a.');
      const t = (await loadTriage(prisma, MIKE_USER_ID))!;
      const mine = t.looks_done!.filter((x) => x.task_id === markedId);
      expect(mine).toHaveLength(1);
      expect(mine[0].evidence).toBe('shipped, https://example.test/a.');
      expect(t.groups.some((gr) => gr.tasks.some((x) => x.task_id === mine[0].task_id))).toBe(false);
      expect(t.groups.some((gr) => gr.tasks.some((x) => x.task_id === g))).toBe(true);
    });

    it('a Looks done comment that is client-visible or not internal is not evidence', async () => {
      const id = await mk('spoof');
      await patchTask({ actor: bot(), id, body: { tags: [LOOKS_DONE_TAG] } });
      await prisma.comment.create({ data: { task_id: id, user_id: botId, content: 'Looks done: fake', is_internal: false, client_visible: true } });
      const t = (await loadTriage(prisma, MIKE_USER_ID))!;
      expect(t.looks_done!.find((x) => x.task_id === id)!.evidence).toBe('');
    });

    it('rows carry a one line summary read from the description head, and their age', async () => {
      const blocks = [{ id: 'a', type: 'paragraph', props: {}, content: [{ type: 'text', text: "What's wanted: ", styles: { bold: true } }, { type: 'text', text: 'Make the footer link work.', styles: {} }], children: [] }, { id: 'b', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Why it matters: x', styles: {} }], children: [] }];
      const id = await mk('summary', { description: JSON.stringify(blocks) });
      const t = (await loadTriage(prisma, MIKE_USER_ID))!;
      const task = t.groups.flatMap((g) => g.tasks).find((x) => x.task_id === id)!;
      expect(task.summary).toBe('Make the footer link work.');
      expect(Date.parse(task.created_at!)).toBeGreaterThan(0);
    });

    it('a group tap never takes a marked card along (Release plan skips it)', async () => {
      const client = await prisma.client.create({ data: { name: `${tag} Co`, type: 'direct', status: 'active' } });
      const project = await prisma.project.create({ data: { name: `${tag} P`, status: 'ready', client_id: client.id } });
      const a = await mk('plan a', { project_id: project.id });
      const b = await mk('plan b', { project_id: project.id });
      await mark(b);
      await releasePlan(prisma, MIKE_USER_ID, `project:${project.id}`, NOW);
      expect((await row(a)).status).toBe('not_started');
      expect((await row(b)).status).toBe('triage');
      await prisma.task.updateMany({ where: { id: { in: [a, b] } }, data: { project_id: null } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.client.delete({ where: { id: client.id } });
    });
  });

  describe('Close as done', () => {
    it('the owner session and the chat lane can move a card to done; no other caller can', async () => {
      for (const actor of [mike(), chatLane()]) {
        const id = await mk('owner close');
        expect((await patchTask({ actor, id, body: { status: 'done' } })).ok).toBe(true);
        expect((await row(id)).status).toBe('done');
      }
      for (const actor of [bot(), workerLane(), otherAdmin(), pm(), mikeKey()]) {
        await expect(patchTask({ actor, id: card, body: { status: 'done' } })).rejects.toMatchObject({ statusCode: 403 });
      }
      expect((await row(card)).status).toBe('triage');
    });

    it('the act is Mike only: any other user answers 404 and nothing changes', async () => {
      const id = await mk('act guard');
      await mark(id);
      await expect(runHomeAct(prisma, adminId, { action: 'triage_close_done', task_ids: [id] }, OPTS)).rejects.toMatchObject({ statusCode: 404 });
      await expect(runHomeAct(prisma, botId, { action: 'triage_close_done', task_ids: [id] }, OPTS)).rejects.toBeTruthy();
      await expect(closeDone(prisma, techId, [id], NOW)).rejects.toBeTruthy();
      expect((await row(id)).status).toBe('triage');
    });

    it('closes to done, removes the tag, comments with the evidence referenced, and leaves the done-guards alone', async () => {
      const id = await mk('close', { requirements: [{ text: 'Do the thing', checked: false }], needs_review: true });
      const evId = await mark(id);
      const res = await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_close_done', task_ids: [id] }, OPTS);
      expect(res.message).toBe('Closed 1 idea as done from Triage.');
      const t = await row(id);
      expect(t.status).toBe('done');
      expect(t.completed_at).not.toBeNull();
      expect(t.tags).not.toContain(LOOKS_DONE_TAG);
      // The honest bypass: nothing is ticked and nothing is approved on the owner's say-so.
      expect(t.approved).toBe(false);
      expect(t.approved_at).toBeNull();
      expect(t.requirements).toEqual([{ text: 'Do the thing', checked: false }]);
      const c = await prisma.comment.findFirstOrThrow({ where: { task_id: id, content: { startsWith: 'Closed as done from Triage' } } });
      expect(c.is_internal).toBe(true);
      expect(c.client_visible).toBe(false);
      expect(c.content).toContain(evId);
      expect(c.content).toContain('shipped in commit abc1234');
    });

    it('an unmarked card (the chat, on his word) closes too, and the comment says there was no note', async () => {
      const id = await mk('unmarked');
      await closeDone(prisma, MIKE_USER_ID, [id], NOW);
      expect((await row(id)).status).toBe('done');
      const c = await prisma.comment.findFirstOrThrow({ where: { task_id: id } });
      expect(c.content).toBe('Closed as done from Triage. No Looks done note was on the card.');
    });

    it('a dependent on an approval-gated project stays blocked: the close does not approve', async () => {
      const dep = await mk('dependent');
      await prisma.task.update({ where: { id: dep }, data: { status: 'blocked' } });
      await prisma.task.update({ where: { id: dep }, data: { blocked_by: { connect: { id: card } } } });
      await closeDone(prisma, MIKE_USER_ID, [card], NOW);
      expect((await row(dep)).status).toBe('blocked');
    });

    it('Undo returns the card to triage with the tag restored, and refuses after 72 hours', async () => {
      const id = await mk('undo');
      await mark(id);
      const res = await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_close_done', task_ids: [id] }, OPTS);
      expect(new Date(res.undo_until!).getTime() - NOW.getTime()).toBe(72 * 3600 * 1000);
      await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, new Date(NOW.getTime() + 3600_000));
      const t = await row(id);
      expect(t.status).toBe('triage');
      expect(t.tags).toContain(LOOKS_DONE_TAG);
      expect(t.completed_at).toBeNull();
      const second = await closeDone(prisma, MIKE_USER_ID, [id], NOW);
      await expect(runHomeUndo(prisma, MIKE_USER_ID, second.action_id, new Date(NOW.getTime() + 73 * 3600_000))).rejects.toMatchObject({ code: 'undo_expired' });
      expect((await row(id)).status).toBe('done');
    });

    it('Undo leaves a card that changed since the close', async () => {
      const id = await mk('changed');
      await mark(id);
      const res = await closeDone(prisma, MIKE_USER_ID, [id], NOW);
      await prisma.task.update({ where: { id }, data: { status: 'in_progress' } });
      await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
      expect((await row(id)).status).toBe('in_progress');
    });
  });

  describe('Not done', () => {
    it('takes the tag off, leaves the card in triage, comments internally, and Undo puts the tag back', async () => {
      const id = await mk('notdone');
      await mark(id);
      const res = await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_not_done', task_ids: [id] }, OPTS);
      expect(res.message).toBe('Left 1 idea in Triage. It is not done.');
      const t = await row(id);
      expect(t.status).toBe('triage');
      expect(t.tags).not.toContain(LOOKS_DONE_TAG);
      const c = await prisma.comment.findFirstOrThrow({ where: { task_id: id, content: { startsWith: 'Not done:' } } });
      expect(c.is_internal).toBe(true);
      const back = (await loadTriage(prisma, MIKE_USER_ID))!;
      expect(back.looks_done!.some((x) => x.task_id === id)).toBe(false);
      await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
      expect((await row(id)).tags).toContain(LOOKS_DONE_TAG);
    });

    it('only Mike, and only a marked card', async () => {
      const id = await mk('unmarked notdone');
      await expect(notDone(prisma, MIKE_USER_ID, [id], NOW)).rejects.toMatchObject({ code: 'changed_since' });
      await mark(id);
      await expect(notDone(prisma, adminId, [id], NOW)).rejects.toBeTruthy();
      expect((await row(id)).tags).toContain(LOOKS_DONE_TAG);
    });
  });
});
