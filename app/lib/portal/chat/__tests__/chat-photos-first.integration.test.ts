import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

process.env.PORTAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-uploads-test-'));

vi.mock('next/headers', async () => {
  const { auth } = await import('./harness/auth-state');
  return { headers: async () => new Headers(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}), cookies: async () => ({ get: () => undefined }) };
});
vi.mock('@/lib/services/client-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/services/client-auth')>();
  const { auth } = await import('./harness/auth-state');
  return { ...real, requireClientAuth: async () => auth.session };
});

import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { auth } from './harness/auth-state';
import { cleanupStrays, seedWorld, cleanupWorld, type World } from './harness/world';
import { resetGateListsCache } from '@/lib/portal/chat/gate-context';
import { POST as startRoute } from '@/app/api/portal/chat/route';
import { POST as workMessages } from '@/app/api/portal/work/[id]/messages/route';
import { stageUpload } from '@/lib/portal/chat/upload-service';
import { renderThread } from '@/lib/portal/chat/context';

const req = (url = '/x', init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const json = (o: unknown) => JSON.stringify(o);
const SEND = { method: 'POST' } as const;

describe('files-only messages in the bundle', () => {
  it('says the client sent files and no words, instead of the saved placeholder', () => {
    const out = renderThread(
      [{ id: 'm1', content: '(attachment)', created_at: new Date('2026-10-21T14:00:00Z'), source: 'portal', chat_meta: null, author_contact_id: 'c1', user_id: null, author_contact: { name: 'Dana Fixture' } }],
      [{ id: 'a1', comment_id: 'm1', filename: 'team.png', content_type: 'image/png', size_bytes: 2048 }]
    );
    expect(out).toContain('The client sent the files below and no words.');
    expect(out).not.toContain('(attachment)');
    expect(out).toContain('<attachment id="a1"');
  });
});

describe.skipIf(!SCRATCH)('photos first (real database)', () => {
  let w: World;
  const asOwner = () => {
    auth.session = { clientId: w.clientId, contactId: w.ownerId, contactIds: [w.ownerId], role: 'owner', email: w.email, sessionId: 's', moved: false };
    auth.bearer = null;
  };
  const access = () => ({ contactId: w.ownerId, contactIds: [w.ownerId], clientId: w.clientId, role: 'owner' as const });

  beforeAll(() => {});
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await cleanupStrays();
    resetGateListsCache();
    w = await seedWorld({ sites: 1, role: 'owner', pages: [{ title: 'Home', path: '/' }] });
    await prisma.engineJob.create({ data: { type: 'chat_reply', status: 'done', client_id: w.clientId, claimed_at: new Date(Date.now() - 60_000), finished_at: new Date() } });
  });
  afterEach(async () => {
    await cleanupWorld(w);
  });

  it('a first message of only a photo files the task and binds the file', async () => {
    asOwner();
    const intake = crypto.randomUUID();
    const att = await stageUpload(access(), { buffer: PNG, name: 'photo.png', intake_id: intake });
    const res = await startRoute(req('/x', { ...SEND, body: json({ intake_id: intake, client_ref: crypto.randomUUID(), text: '', attachment_ids: [att.id] }) }));
    expect(res.status).toBe(201);
    const { task_id } = await res.json();
    const task = await prisma.task.findUniqueOrThrow({ where: { id: task_id } });
    expect(task.title).toBe('Request: a photo or file');
    const comment = await prisma.comment.findFirstOrThrow({ where: { task_id, author_contact_id: w.ownerId } });
    expect(comment.content).toBe('(attachment)');
    const row = await prisma.portalAttachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(row.comment_id).toBe(comment.id);
  });

  it('refuses a first message with neither words nor files', async () => {
    asOwner();
    const res = await startRoute(req('/x', { ...SEND, body: json({ intake_id: crypto.randomUUID(), client_ref: crypto.randomUUID(), text: '  ', attachment_ids: [] }) }));
    expect(res.status).toBe(400);
  });

  it('on a work page with no conversation yet, files staged on the task bind to the first message', async () => {
    asOwner();
    const task = await prisma.task.create({
      data: { title: 'E2E work', client_title: 'Photo work', client_id: w.clientId, site_id: w.sites[0].id, requested_by_contact_id: w.ownerId, source: 'portal', tags: ['portal-chat'], status: 'not_started' },
    });
    const att = await stageUpload(access(), { buffer: PNG, name: 'photo.png', task_id: task.id });
    expect(att.id).toBeTruthy();
    const staged = await prisma.portalAttachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(staged.task_id).toBe(task.id);
    expect(staged.conversation_id).toBeNull();

    const res = await workMessages(req('/x', { ...SEND, body: json({ client_ref: crypto.randomUUID(), text: '', attachment_ids: [att.id] }) }), ctx(task.id));
    expect(res.status).toBe(201);
    const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: task.id } });
    const row = await prisma.portalAttachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(row.conversation_id).toBe(convo.id);
    expect(row.comment_id).not.toBeNull();
  });

  it('a task that is not the contact\'s cannot take staged files', async () => {
    asOwner();
    const other = await prisma.client.findUniqueOrThrow({ where: { id: w.otherClientId } });
    const t = await prisma.task.create({ data: { title: 'Theirs', client_title: 'Theirs', client_id: other.id, source: 'portal', status: 'not_started' } });
    await expect(stageUpload(access(), { buffer: PNG, name: 'photo.png', task_id: t.id })).rejects.toMatchObject({ statusCode: 404 });
  });
});
