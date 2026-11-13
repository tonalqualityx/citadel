// @vitest-environment node
/**
 * Dox slice 2a against a real scratch Postgres: asking Dox by mention, Dox assigning to Dox, taking asked-dox off, and a portal-visible project
 * started and closed by Dox while its dates still need a source.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/api/formatters', async (orig) => ({ ...(await orig<typeof import('@/lib/api/formatters')>()), formatProjectResponse: (p: { id: string }) => ({ id: p.id }) }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({})), currentActorLane: vi.fn(async () => null) }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { PATCH as patchTask } from '@/app/api/tasks/[id]/route';
import { POST as addComment } from '@/app/api/tasks/[id]/comments/route';
import { PATCH as patchProject } from '@/app/api/projects/[id]/route';
import { dox, idParams, makeFixture, type Fx } from './fixture';
import { DOX_USER_ID } from '../identity';
import { ASKED_DOX_TAG, mentionsDox } from '../ask';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const call = (project?: string, body?: unknown, method = 'POST') =>
  new NextRequest('http://localhost/api/x', { method, headers: project ? { 'x-dox-project': project } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });

describe('mentionsDox (pure)', () => {
  it('sees his id or an @Dox in the text, and nothing else', () => {
    expect(mentionsDox([DOX_USER_ID], 'hello')).toBe(true);
    expect(mentionsDox([], '@Dox the SOW says eight pages: build the ninth?')).toBe(true);
    expect(mentionsDox([], 'ask @dox.')).toBe(true);
    expect(mentionsDox([], 'mail me at a@doxology.test')).toBe(false);
    expect(mentionsDox([], 'no mention here')).toBe(false);
  });
});

describe.skipIf(!SCRATCH)('Dox slice 2a (real database)', () => {
  let fx: Fx;
  let P: string;
  let staff: string;
  const worker = (): AuthPayload => ({ userId: staff, role: 'pm', email: 'w@test', via: 'session' });

  beforeAll(async () => {
    fx = await makeFixture('dox2a');
    P = await fx.mkProject('Asked', { status: 'in_progress', portal_visibility: 'hidden' });
    staff = await fx.mkStaff('Worker');
    await fx.openPass(P);
  });
  afterAll(async () => {
    await prisma.comment.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  describe('asking Dox by mention', () => {
    it('a mention of Dox by someone else tags the task asked-dox and stamps the project; a repeat adds no second tag', async () => {
      const t = await fx.mkTask('Question task', { project_id: P, status: 'in_progress', tags: ['keep'] });
      expect((await prisma.project.findUniqueOrThrow({ where: { id: P } })).next_step_refresh_requested_at).toBeNull();
      as(worker());
      const res = await addComment(call(undefined, { content: '@Dox the SOW says eight pages and this builds a ninth: build it or drop it?', mentioned_user_ids: [DOX_USER_ID] }), idParams(t));
      expect(res.status).toBe(201);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).tags).toEqual(['keep', ASKED_DOX_TAG]);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: P } })).next_step_refresh_requested_at).not.toBeNull();
      await addComment(call(undefined, { content: 'Still waiting.', mentioned_user_ids: [DOX_USER_ID] }), idParams(t));
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).tags).toEqual(['keep', ASKED_DOX_TAG]);
    });

    it('a comment with no mention, a mention of someone else, and Dox\'s own comment change nothing', async () => {
      const t = await fx.mkTask('Quiet task', { project_id: P, status: 'in_progress' });
      await prisma.project.update({ where: { id: P }, data: { next_step_refresh_requested_at: null } });
      as(worker());
      await addComment(call(undefined, { content: 'Plain note.' }), idParams(t));
      await addComment(call(undefined, { content: 'Hey Sabeen', mentioned_user_ids: [staff] }), idParams(t));
      as(dox());
      await addComment(call(P, { content: 'Dox answering: build it, the plan says nine.', mentioned_user_ids: [DOX_USER_ID] }), idParams(t));
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).tags).toEqual([]);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: P } })).next_step_refresh_requested_at).toBeNull();
    });

    it('Dox can take asked-dox off once answered', async () => {
      const t = await fx.mkTask('Answered', { project_id: P, status: 'in_progress', tags: [ASKED_DOX_TAG, 'keep'] });
      as(dox());
      const res = await json(await patchTask(call(P, { tags_remove: [ASKED_DOX_TAG] }, 'PATCH'), idParams(t)));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).tags).toEqual(['keep']);
    });
  });

  describe('assigning to himself', () => {
    it('Dox may assign a task to Dox (the report task) but still never to another bot user', async () => {
      const t = await fx.mkTask('Report', { project_id: P, status: 'not_started' });
      as(dox());
      expect((await patchTask(call(P, { assignee_id: DOX_USER_ID }, 'PATCH'), idParams(t))).status).toBe(200);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).assignee_id).toBe(DOX_USER_ID);
      const other = await json(await patchTask(call(P, { assignee_id: '7e5d9924-6b58-47d6-9865-c6e98027d2cf' }, 'PATCH'), idParams(t)));
      expect(other.status).toBe(403);
    });
  });

  describe('a portal-visible project', () => {
    it('can be started and closed by Dox; its dates still need a source', async () => {
      const proj = await fx.mkProject('Client sees this', { status: 'ready', portal_visibility: 'inherit' });
      await fx.openPass(proj);
      as(dox());
      const noSource = await json(await patchProject(call(proj, { target_date: '2026-12-01T12:00:00.000Z' }, 'PATCH'), idParams(proj)));
      expect(noSource.status).toBe(422);
      expect(noSource.body.code).toBe('date_source_required');
      expect((await patchProject(call(proj, { status: 'in_progress' }, 'PATCH'), idParams(proj))).status).toBe(200);
      await fx.mkTask('Finished work', { project_id: proj, status: 'done' });
      expect((await patchProject(call(proj, { status: 'done' }, 'PATCH'), idParams(proj))).status).toBe(200);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: proj } })).status).toBe('done');
    });
  });
});
