// @vitest-environment node
/** Fixes for the triage review: notices, delete, go-live, sweep, portal link, and client_visible round trip. Real scratch Postgres. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/services/email', () => ({ sendTaskApprovalRequestEmail: vi.fn().mockResolvedValue(undefined), sendEmail: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH, seedClient, cleanup, type Seeded } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID, BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { patchTask, TRIAGE_WAS_VISIBLE_TAG } from '@/lib/services/task-patch';
import { markLive } from '@/lib/portal/go-live';
import { validateTaskToken } from '@/lib/services/portal';
import { closeUnconfirmed } from '@/lib/portal/chat/confirm';
import { POST as postComment } from '@/app/api/tasks/[id]/comments/route';
import { DELETE as deleteTask } from '@/app/api/tasks/[id]/route';
import { DELETE as bulkDelete } from '@/app/api/tasks/bulk/route';

const authMock = requireAuth as Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(!SCRATCH)('triage fixes (real database)', () => {
  const tag = `fix${Date.now()}`;
  const ids: string[] = [];
  const seeds: Seeded[] = [];
  let botId: string;
  let techId: string;
  const bot = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k1' });
  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const mk = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', ...data } as never });
    ids.push(t.id);
    return t;
  };
  const comment = (id: string, body: Record<string, unknown>) =>
    postComment(new NextRequest(new URL(`http://localhost/api/tasks/${id}/comments`), { method: 'POST', body: JSON.stringify(body) } as never), params(id));
  const techNotices = (needle: string) => prisma.notification.findMany({ where: { user_id: techId, title: { contains: needle } } });

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'admin' } });
    botId = (await prisma.user.create({ data: { email: `bot-${tag}@example.test`, password_hash: 'x', name: 'Bot', role: 'pm' } })).id;
    techId = (await prisma.user.create({ data: { email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech', role: 'tech' } })).id;
  });
  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { user_id: techId } });
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await cleanup(seeds);
    await prisma.user.deleteMany({ where: { id: { in: [botId, techId] } } });
    await prisma.$disconnect();
  });

  it('an @-mention of a contractor on a triage task notifies nobody', async () => {
    const t = await mk('mention idea');
    authMock.mockResolvedValue(bot());
    const res = await comment(t.id, { content: 'look at this', mentioned_user_ids: [techId] });
    expect(res.status).toBe(201);
    expect(await techNotices('mention idea')).toHaveLength(0);
  });

  it('a comment on a triage task assigned to a contractor sends the assignee no notice', async () => {
    const t = await mk('comment idea', { assignee_id: techId });
    authMock.mockResolvedValue(bot());
    expect((await comment(t.id, { content: 'a plain note' })).status).toBe(201);
    expect(await techNotices('comment idea')).toHaveLength(0);
  });

  it('the guard is only for triage: the same assignee is told once the task is released', async () => {
    const t = await mk('released idea');
    await patchTask({ actor: mike(), id: t.id, body: { status: 'not_started' } });
    await patchTask({ actor: bot(), id: t.id, body: { assignee_id: techId } });
    expect((await techNotices('released idea')).length).toBeGreaterThan(0);
  });

  it('a worker key cannot take a triage task live (409), and nothing is written', async () => {
    const t = await mk('live idea');
    await expect(markLive({ taskId: t.id, authorId: botId, liveUrl: 'https://example.test/x', force: true, callerRole: 'admin' })).rejects.toMatchObject({ statusCode: 409, code: 'triage' });
    expect((await row(t.id)).status).toBe('triage');
  });

  it('a pm/bot key cannot delete a triage task, single or bulk; Mike can; other tasks are unaffected', async () => {
    const a = await mk('del a');
    const b = await mk('del b');
    const plain = await mk('del plain', { status: 'not_started' });
    authMock.mockResolvedValue(bot());
    expect((await deleteTask(new NextRequest(new URL('http://localhost/api/tasks/x'), { method: 'DELETE' } as never), params(a.id))).status).toBe(403);
    const bulk = (taskIds: string[]) => bulkDelete(new NextRequest(new URL('http://localhost/api/tasks/bulk'), { method: 'DELETE', body: JSON.stringify({ task_ids: taskIds }) } as never));
    expect((await bulk([b.id, plain.id])).status).toBe(403);
    expect((await row(a.id)).is_deleted).toBe(false);
    expect((await row(b.id)).is_deleted).toBe(false);
    expect((await row(plain.id)).is_deleted).toBe(false);
    expect((await bulk([plain.id])).status).toBe(200);
    authMock.mockResolvedValue(mike());
    expect((await deleteTask(new NextRequest(new URL('http://localhost/api/tasks/x'), { method: 'DELETE' } as never), params(a.id))).status).toBe(200);
    expect((await row(a.id)).is_deleted).toBe(true);
  });

  it('a client approval link issued before the task was filed into triage no longer opens it', async () => {
    const t = await mk('token idea', { portal_token: `tok-${tag}` });
    expect(await validateTaskToken(`tok-${tag}`)).toBeNull();
    await prisma.task.update({ where: { id: t.id }, data: { status: 'not_started' } });
    expect(await validateTaskToken(`tok-${tag}`)).not.toBeNull();
  });

  it('the portal chat sweep does not close a quiet question chat whose task is in triage', async () => {
    const s = await seedClient(`${tag}s`);
    seeds.push(s);
    await prisma.task.update({ where: { id: s.taskId }, data: { status: 'triage', client_visible: false } });
    const old = new Date(Date.now() - 72 * 3600_000).toISOString();
    await prisma.chatConversation.update({ where: { id: s.conversationId }, data: { state: 'clarifying', slots: { question_closed_at: old } } });
    expect(await closeUnconfirmed(s.conversationId)).toBe('skipped');
    expect((await row(s.taskId)).status).toBe('triage');
    // control: the same chat on an ordinary task is closed
    await prisma.task.update({ where: { id: s.taskId }, data: { status: 'not_started' } });
    expect(await closeUnconfirmed(s.conversationId)).toBe('closed_question');
    expect((await row(s.taskId)).status).toBe('done');
  });

  it('release restores client_visible that filing into triage took away (status-only and combined bodies)', async () => {
    const t = await mk('visible', { status: 'not_started', client_visible: true, tags: ['keep'] });
    await patchTask({ actor: bot(), id: t.id, body: { status: 'triage' } });
    let r = await row(t.id);
    expect(r.client_visible).toBe(false);
    expect(r.tags).toEqual(['keep', TRIAGE_WAS_VISIBLE_TAG]);
    await patchTask({ actor: mike(), id: t.id, body: { status: 'not_started' } });
    r = await row(t.id);
    expect(r.client_visible).toBe(true);
    expect(r.tags).toEqual(['keep']);
    await patchTask({ actor: bot(), id: t.id, body: { status: 'triage', priority: 2 } });
    expect((await row(t.id)).client_visible).toBe(false);
    await patchTask({ actor: mike(), id: t.id, body: { status: 'not_started', priority: 3 } });
    r = await row(t.id);
    expect(r.client_visible).toBe(true);
    expect(r.tags).toEqual(['keep']);
    // a task that was never client-visible stays that way
    const n = await mk('hidden', { status: 'not_started', client_visible: false });
    await patchTask({ actor: bot(), id: n.id, body: { status: 'triage' } });
    await patchTask({ actor: mike(), id: n.id, body: { status: 'not_started' } });
    expect((await row(n.id)).client_visible).toBe(false);
  });
});
