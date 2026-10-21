import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

let bearer: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {}),
  cookies: async () => ({ get: () => undefined }),
}));

import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '@/lib/auth/api-keys';
import { POST as claim } from '../claim/route';
import { POST as heartbeat } from '../jobs/[id]/heartbeat/route';
import { POST as toolCall } from '../jobs/[id]/tool-calls/route';
import { GET as read } from '../jobs/[id]/read/[kind]/route';
import { GET as names } from '../isolation-names/route';
import { enqueueJob, LEASE_MS } from '@/lib/engine/queue';
import { anyUser, cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init);
const ctx = (id: string, kind?: string) => ({ params: Promise.resolve({ id, kind: kind ?? '' }) });

describe.skipIf(!SCRATCH)('engine routes (real database)', () => {
  const tag = `e${Date.now()}`;
  let a: Seeded;
  let engineKey = '';
  let plainKey = '';
  const keyIds: string[] = [];

  async function mintKey(scopes: string[], role: 'pm' | 'tech' = 'pm') {
    const user = await anyUser();
    if (role === 'tech') {
      const t = await prisma.user.create({ data: { email: `tech-${tag}-${scopes.length}@example.test`, password_hash: 'x', name: 'Tech', role: 'tech' } });
      return mk(t.id, scopes);
    }
    return mk(user.id, scopes);
  }
  async function mk(userId: string, scopes: string[]) {
    const raw = 'citadel_' + crypto.randomBytes(16).toString('hex');
    const row = await prisma.apiKey.create({ data: { user_id: userId, name: `test-${tag}`, key_hash: hashApiKey(raw), key_prefix: raw.slice(0, 16), scopes } });
    keyIds.push(row.id);
    return raw;
  }

  beforeAll(async () => {
    a = await seedClient(`${tag}a`, { ga4: 'properties/123' });
    await prisma.user.updateMany({ where: { id: (await anyUser()).id }, data: { role: 'pm', is_active: true } });
    engineKey = await mintKey(['engine']);
    plainKey = await mintKey([]);
  });
  afterAll(async () => {
    await cleanup([a]);
    await prisma.apiKey.deleteMany({ where: { id: { in: keyIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `tech-${tag}` } } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    const { updateChatSettings } = await import('@/lib/portal/chat/switches');
    await updateChatSettings({ mode: 'on', pilot_contact_ids: [] });
    bearer = engineKey;
    await prisma.engineToolCall.deleteMany({ where: { client_id: a.clientId } });
    await prisma.engineJob.deleteMany({ where: { client_id: a.clientId } });
  });

  const queue = () => enqueueJob({ type: 'chat_reply', conversationId: a.conversationId, taskId: a.taskId, clientId: a.clientId, contactId: a.ownerId });

  it('every engine route refuses no token, an ordinary key and a non-pm key with the engine scope', async () => {
    const j = await queue();
    for (const token of [null, plainKey, await mintKey(['engine'], 'tech')]) {
      bearer = token;
      const rs = await Promise.all([
        claim(req('/api/engine/claim', { method: 'POST' })),
        heartbeat(req('/x', { method: 'POST' }), ctx(j.job.id)),
        toolCall(req('/x', { method: 'POST', body: '{}' }), ctx(j.job.id)),
        read(req('/x'), ctx(j.job.id, 'requests')),
        names(),
      ]);
      for (const r of rs) expect([401, 403]).toContain(r.status);
    }
  });

  it('an admin mints an engine key through POST /api/api-keys and the claim route accepts it; a pm cannot', async () => {
    const { POST: mintRoute } = await import('../../api-keys/route');
    const admin = await prisma.user.create({ data: { email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin', role: 'admin' } });
    try {
      bearer = await mk(admin.id, []);
      const res = await mintRoute(req('/api/api-keys', { method: 'POST', body: JSON.stringify({ name: `minted-${tag}`, scopes: ['engine'] }) }));
      expect(res.status).toBe(201);
      const minted = await res.json();
      keyIds.push(minted.id);
      expect(minted.scopes).toEqual(['engine']);
      bearer = minted.key;
      expect([200, 204]).toContain((await claim(req('/api/engine/claim', { method: 'POST' }))).status);
      bearer = plainKey;
      expect((await mintRoute(req('/api/api-keys', { method: 'POST', body: JSON.stringify({ name: 'x', scopes: ['engine'] }) }))).status).toBe(403);
    } finally {
      await prisma.activityLog.deleteMany({ where: { user_id: admin.id } });
      await prisma.apiKey.deleteMany({ where: { user_id: admin.id } });
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  it('claim: 204 with the active header when empty; a job comes with context and a tool scope', async () => {
    const empty = await claim(req('/api/engine/claim', { method: 'POST' }));
    expect(empty.status).toBe(204);
    expect(empty.headers.get('X-Engine-Active')).not.toBeNull();

    await queue();
    const res = await claim(req('/api/engine/claim', { method: 'POST', body: JSON.stringify({ types: ['chat_reply'] }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job).toMatchObject({ type: 'chat_reply', attempts: 1, conversation_id: a.conversationId });
    expect(JSON.stringify(body.context)).not.toContain('properties/123');
    expect(body.scope.sites[0]).toMatchObject({ id: a.siteId, ga4_property: 'properties/123' });
    expect(body.scope).toMatchObject({ client_id: a.clientId, contact_id: a.ownerId });
  });

  it('claim: a contact who lost access gets the job closed and the tree, not a bundle', async () => {
    await queue();
    await prisma.clientContact.update({ where: { id: a.ownerId }, data: { is_deleted: true } });
    try {
      const res = await claim(req('/api/engine/claim', { method: 'POST' }));
      expect(res.status).toBe(204);
      expect((await prisma.engineJob.findFirstOrThrow({ where: { client_id: a.clientId } })).status).toBe('failed');
    } finally {
      await prisma.clientContact.update({ where: { id: a.ownerId }, data: { is_deleted: false } });
    }
  });

  it('claim re-checks the switches: mode off, pilot and the site switch each close a queued job', async () => {
    const { updateChatSettings, getChatSettings } = await import('@/lib/portal/chat/switches');
    const before = await getChatSettings();
    try {
      await updateChatSettings({ mode: 'on', pilot_contact_ids: [] });
      for (const [setup, reason] of [
        [async () => { await updateChatSettings({ mode: 'off' }); }, 'mode_off'],
        [async () => { await updateChatSettings({ mode: 'pilot', pilot_contact_ids: [a.viewerId] }); }, 'not_pilot'],
        [async () => { await updateChatSettings({ mode: 'on' }); await prisma.site.update({ where: { id: a.siteId }, data: { portal_chat_enabled: false } }); }, 'site_off'],
      ] as const) {
        await prisma.engineJob.deleteMany({ where: { client_id: a.clientId } });
        await prisma.site.update({ where: { id: a.siteId }, data: { portal_chat_enabled: true } });
        await updateChatSettings({ mode: 'on' });
        await queue();
        await setup();
        const res = await claim(req('/api/engine/claim', { method: 'POST' }));
        expect(res.status).toBe(204);
        const job = await prisma.engineJob.findFirstOrThrow({ where: { client_id: a.clientId } });
        expect(job.status).toBe('failed');
        expect(job.error).toBe(reason);
        expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } })).mode).toBe('tree');
      }
    } finally {
      await updateChatSettings({ mode: before.mode, pilot_contact_ids: before.pilot_contact_ids });
      await prisma.site.update({ where: { id: a.siteId }, data: { portal_chat_enabled: true } });
    }
  });

  it('claim expires a stale claimed job first, so it never blocks its conversation', async () => {
    const stuck = await prisma.engineJob.create({
      data: { type: 'chat_reply', status: 'claimed', conversation_id: a.conversationId, task_id: a.taskId, client_id: a.clientId, contact_id: a.ownerId, claimed_at: new Date(Date.now() - 300_000), lease_until: new Date(Date.now() - 180_000), attempts: 1 },
    });
    const next = await queue(); // the client's follow-up message, queued behind the dead claim
    const res = await claim(req('/api/engine/claim', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect((await res.json()).job.id).toBe(next.job.id);
    expect((await prisma.engineJob.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe('expired');
  });

  it('claim rejects a bad body', async () => {
    const res = await claim(req('/api/engine/claim', { method: 'POST', body: JSON.stringify({ types: ['nope'] }) }));
    expect(res.status).toBe(400);
  });

  async function claimed() {
    await queue();
    const res = await claim(req('/api/engine/claim', { method: 'POST' }));
    return (await res.json()).job.id as string;
  }

  it('heartbeat: extends twice then 409; unknown id 404; bad id 404', async () => {
    const id = await claimed();
    expect((await heartbeat(req('/x', { method: 'POST' }), ctx(id))).status).toBe(200);
    expect((await heartbeat(req('/x', { method: 'POST' }), ctx(id))).status).toBe(200);
    expect((await heartbeat(req('/x', { method: 'POST' }), ctx(id))).status).toBe(409);
    expect((await heartbeat(req('/x', { method: 'POST' }), ctx('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    expect((await heartbeat(req('/x', { method: 'POST' }), ctx('nope'))).status).toBe(404);
  });

  it('tool-calls: logs a live job, validates the body, 409 after the lease lapses', async () => {
    const id = await claimed();
    const post = (body: unknown) => toolCall(req('/x', { method: 'POST', body: JSON.stringify(body) }), ctx(id));
    const ok = await post({ tool: 'ga4_report', args: { site_id: a.siteId }, row_count: 3, result: { label: 'Google Analytics, Oct 1 to Oct 20, 2026', totals: { sessions: 55 } } });
    expect(ok.status).toBe(201);
    const row = await prisma.engineToolCall.findFirstOrThrow({ where: { job_id: id } });
    expect(row.result_numbers).toContain('55');
    expect((await post({ tool: 'bash', args: {} })).status).toBe(400);
    await prisma.engineJob.update({ where: { id }, data: { lease_until: new Date(Date.now() - 1000) } });
    expect((await post({ tool: 'site_pages', args: {} })).status).toBe(409);
  });

  it('read: serves the contact\'s own data while live, refuses once expired, and enforces roles', async () => {
    const id = await claimed();
    const get = (kind: string, qs = '') => read(req(`/x${qs}`), ctx(id, kind));
    const reqs = await get('requests');
    expect(reqs.status).toBe(200);
    expect(((await reqs.json()).data.open as Array<{ id: string }>).map((i) => i.id)).toContain(a.taskId);
    expect((await get('invoices')).status).toBe(200); // owner
    expect((await get('bogus')).status).toBe(400);
    expect((await get('work_item', '?task_id=not-a-uuid')).status).toBe(400);
    expect((await get('work_item', `?task_id=00000000-0000-4000-8000-000000000000`)).status).toBe(404);

    // The same job viewed by a viewer contact: invoices are refused.
    await prisma.engineJob.update({ where: { id }, data: { contact_id: a.viewerId } });
    expect((await get('invoices')).status).toBe(403);
    // Expired: nothing is served.
    await prisma.engineJob.update({ where: { id }, data: { lease_until: new Date(Date.now() - LEASE_MS) } });
    expect((await get('requests')).status).toBe(409);
    await prisma.engineJob.update({ where: { id }, data: { status: 'done' } });
    expect((await get('requests')).status).toBe(409);
  });

  it('isolation-names lists client names and site domains only', async () => {
    const res = await names();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.names).toContain(`Chat ${tag}a Co`);
    expect(body.domains).toContain(`${tag}a.example.test`);
    expect(Object.keys(body).sort()).toEqual(['domains', 'names']);
  });
});
