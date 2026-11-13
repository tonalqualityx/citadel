// @vitest-environment node
/**
 * Item 4 through the real chat route against a scratch Postgres: a chat PATCH of a field a client reads, on a task the portal shows, is stored as a
 * proposal for the owner's one tap (202, nothing written), and the tap writes it. A typed field with no words still applies at once, and so does
 * the same text change on a task no portal rule shows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NextRequest } from 'next/server';

const who = vi.hoisted(() => ({ als: null as null | { getStore: () => unknown } }));
vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(async () => who.als!.getStore()),
}));

import { prisma } from '@/lib/db/prisma';
import { PATCH as patchRoute } from '@/app/api/tasks/[id]/route';
import { BAST_USER_ID } from '../gate-mirror';
import { releaseAction } from '../actions';

const URL = process.env.DATABASE_URL ?? '';
const RUN = /scratch/i.test(URL) && /localhost|127\.0\.0\.1/.test(URL);
const CAP = 1_000_000;

describe.skipIf(!RUN)('the owner taps before chat text reaches a client view (real database)', () => {
  const als = new AsyncLocalStorage<unknown>();
  who.als = als;
  const tag = `ctap-${Date.now()}`;
  const ownerId = randomUUID();
  let conversationId = '';
  let clientId = '';
  let contactId = '';
  const taskIds: string[] = [];
  const chatAuth = { userId: BAST_USER_ID, email: 'bast@example.test', role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true };

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner CTap', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast CTap', role: 'pm' } });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, update: { owner_user_id: ownerId, enabled: true, daily_write_cap: CAP }, create: { id: 1, owner_user_id: ownerId, enabled: true, daily_write_cap: CAP } });
    conversationId = (await prisma.bastChatConversation.create({ data: { owner_id: ownerId, status: 'running' } })).id;
    clientId = (await prisma.client.create({ data: { name: `${tag} Co`, type: 'direct', status: 'active' } })).id;
    contactId = (await prisma.clientContact.create({ data: { client_id: clientId, name: `Olive ${tag}`, email: `olive-${tag}@example.test`, portal_role: 'owner', can_initiate_work: true } })).id;
  });
  afterAll(async () => {
    await prisma.bastChatAction.deleteMany({ where: { target_id: { in: taskIds } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  const mk = (title: string, o: Record<string, unknown>) =>
    prisma.task.create({ data: { title: `${tag} ${title}`, status: 'not_started', assignee_id: ownerId, client_id: clientId, description: 'Original brief.', ...o } as never }).then((t) => {
      taskIds.push(t.id);
      return t.id;
    });
  const chatPatch = (id: string, body: Record<string, unknown>) =>
    als.run(chatAuth, async () => {
      const res = await patchRoute(new NextRequest(`http://localhost/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'X-Bast-Chat-Conversation': conversationId } }), { params: Promise.resolve({ id }) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    });

  const SHOWN: [string, () => Promise<string>][] = [
    ['requested by a contact', () => mk('Requested', { requested_by_contact_id: contactId, source: 'portal' })],
    ['shared by staff', () => mk('Shared', { client_visible: true })],
    ['staged for approval', () => mk('Staged', { status: 'review', staging_preview_url: 'https://preview.example/x' })],
    ['approved by the client (history)', () => mk('Approved', { status: 'done', client_approved_at: new Date() })],
  ];

  describe.each(SHOWN)('a task %s', (_n, make) => {
    it.each([
      ['title', { title: `${tag} renamed` }],
      ['description', { description: 'A different brief for the client.' }],
      ['requirements', { requirements: ['Check every price', 'Add a new line'] }],
    ])('a chat change to its %s is a proposal: 202, nothing written, then the tap writes it', async (field, body) => {
      const id = await make();
      const before = await prisma.task.findUniqueOrThrow({ where: { id } });
      const r = await chatPatch(id, body);
      expect(r.status, JSON.stringify(r.json)).toBe(202);
      expect(r.json).toMatchObject({ proposed: true, proposal_kind: 'client_show' });
      const after = await prisma.task.findUniqueOrThrow({ where: { id } });
      expect([after.title, after.description, after.requirements, after.updated_at]).toEqual([before.title, before.description, before.requirements, before.updated_at]);
      const action = await prisma.bastChatAction.findUniqueOrThrow({ where: { id: r.json.action_id as string } });
      expect(action.status).toBe('proposed');
      expect(JSON.stringify(action.reach)).toContain('what the client reads');
      expect((await releaseAction(action.id, ownerId, new Date(), prisma)).status, field).toBe('released');
      const tapped = await prisma.task.findUniqueOrThrow({ where: { id } });
      if (field === 'title') expect(tapped.title).toBe(`${tag} renamed`);
      if (field === 'description') expect(JSON.stringify(tapped.description)).toContain('A different brief');
      if (field === 'requirements') expect(JSON.stringify(tapped.requirements)).toContain('Check every price');
    });

    it('a typed field with no words (priority) applies at once', async () => {
      const id = await make();
      const r = await chatPatch(id, { priority: 2 });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    });
  });

  it('the same rename on a task no portal rule shows applies at once, and on a Triage card marked client_visible too', async () => {
    const plain = await mk('Internal', {});
    expect((await chatPatch(plain, { title: `${tag} renamed internal` })).status).toBe(200);
    const card = await mk('Card', { status: 'triage', client_visible: true });
    expect((await chatPatch(card, { title: `${tag} renamed card` })).status).toBe(200);
  });
});
