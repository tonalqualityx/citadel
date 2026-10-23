import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

// A client cancels a request, on the real scratch database: every state, the repeat, the waits, the
// conversation, the staff notification and the email. The route is called directly, so the view-as
// guard and the auth sit in front of it exactly as in production (the cookie is mocked away).
const mocks = vi.hoisted(() => ({ cookie: undefined as string | undefined, session: null as Record<string, unknown> | null }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === 'client_session' && mocks.cookie ? { value: mocks.cookie } : undefined) }),
}));
vi.mock('@/lib/services/client-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/services/client-auth')>();
  return { ...real, requireClientAuth: async () => mocks.session };
});

import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { cleanupStrays, seedWorld, cleanupWorld, type World } from '@/lib/portal/chat/__tests__/harness/world';
import { POST as cancelRoute } from '@/app/api/portal/work/[id]/cancel/route';
import { POST as workMessageRoute } from '@/app/api/portal/work/[id]/messages/route';
import { GET as workRoute } from '@/app/api/portal/work/[id]/route';
import { GET as historyRoute } from '@/app/api/portal/history/route';
import { GET as requestsRoute } from '@/app/api/portal/requests/route';
import { loadChatView } from '@/lib/portal/chat/view';
import { loadPortalAccess } from '@/lib/portal/access';
import { CANCEL_LINE } from '@/lib/portal/cancel-copy';
import { onRequestFiled } from '@/lib/portal/waits';
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string) => cancelRoute(new NextRequest(`http://localhost/api/portal/work/${id}/cancel`, { method: 'POST' }), ctx(id));

describe.skipIf(!SCRATCH)('POST /api/portal/work/:id/cancel (real database)', () => {
  let w: World;
  let staffId = '';
  const staffEmail = `cancel-staff-${crypto.randomBytes(3).toString('hex')}@example.test`;

  const asOwner = () => {
    mocks.cookie = undefined;
    mocks.session = { clientId: w.clientId, contactId: w.ownerId, contactIds: [w.ownerId], role: 'owner', email: w.email, sessionId: 's', moved: false };
  };

  async function makeTask(status: 'not_started' | 'in_progress' | 'review' | 'done' | 'blocked', extra: Record<string, unknown> = {}, opts: { convo?: string; assignee?: string | null } = {}) {
    const task = await prisma.task.create({
      data: {
        title: `Change hours ${crypto.randomBytes(2).toString('hex')}`,
        client_title: 'Change the hours',
        status,
        priority: 3,
        tags: ['portal-chat'],
        assignee_id: opts.assignee === undefined ? staffId : opts.assignee,
        client_id: w.clientId,
        site_id: w.sites[0].id,
        source: 'portal',
        requested_by_contact_id: w.ownerId,
        ...extra,
      },
    });
    if (opts.convo) {
      await prisma.chatConversation.create({
        data: {
          task_id: task.id,
          client_id: w.clientId,
          site_id: w.sites[0].id,
          opened_by_contact_id: w.ownerId,
          state: opts.convo as 'clarifying',
          slots: {},
          open_ask: { slot: 'change', question: 'What should change?', choice_ids: [], allow_free_text: true, allow_upload: false },
          email_token: crypto.randomBytes(6).toString('hex').slice(0, 16),
        },
      });
    }
    return task;
  }
  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const outbox = (id: string) => prisma.emailOutbox.findMany({ where: { dedupe_key: `portal-cancel:${id}` } });
  const bell = (id: string) => prisma.notification.findMany({ where: { entity_id: id, user_id: staffId } });
  const lines = (id: string) => prisma.comment.findMany({ where: { task_id: id, content: CANCEL_LINE } });

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { email: staffEmail, password_hash: 'x', name: 'Cancel Staff', role: 'pm' } });
    staffId = u.id;
  });
  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { user_id: staffId } });
    await prisma.user.deleteMany({ where: { id: staffId } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await cleanupStrays();
    w = await seedWorld({ sites: 1, role: 'owner' });
    asOwner();
  });
  afterEach(async () => {
    await prisma.emailOutbox.deleteMany({ where: { dedupe_key: { startsWith: 'portal-cancel:' } } });
    await cleanupWorld(w);
  });

  it('(a) clarifying: abandons, tags, posts the line, closes the chat and every wait, and tells nobody', async () => {
    const task = await makeTask('not_started', { tags: ['portal-chat', 'chat-clarifying', 'awaiting-clarification'] }, { convo: 'clarifying' });
    await onRequestFiled(prisma, { id: task.id, client_title: 'Change the hours', assignee_id: staffId, client_id: w.clientId, project_id: null, charter_id: null, site_id: w.sites[0].id }, { intake_id: 'i1', quote: false, emergency: false });
    expect(await prisma.wait.count({ where: { task_id: task.id, state: { in: ['waiting', 'needs_human', 'paused'] } } })).toBe(1);

    const res = await post(task.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, already_cancelled: false, staff_notified: false });

    const after = await row(task.id);
    expect(after.status).toBe('abandoned');
    expect(after.tags).toContain('client-cancelled');
    expect(after.tags).not.toContain('awaiting-clarification');
    expect(after.tags).not.toContain('chat-clarifying');

    const said = await lines(task.id);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ is_internal: false, client_visible: true, user_id: BAST_USER_ID, author_contact_id: null });
    expect(said[0].chat_meta).toEqual({ email_notice: 'cancelled' });

    const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: task.id } });
    expect(convo.state).toBe('closed');
    expect(convo.open_ask).toBeNull();
    const waits = await prisma.wait.findMany({ where: { task_id: task.id } });
    expect(waits.length).toBeGreaterThan(0);
    for (const x of waits) expect(x).toMatchObject({ state: 'done', resolution: 'cancelled' });

    expect(await outbox(task.id)).toHaveLength(0);
    expect(await bell(task.id)).toHaveLength(0);
    expect(await prisma.emailOutbox.count({ where: { task_id: task.id } })).toBe(0);
  });

  it('(a) a task that has not started and has no conversation cancels the same way', async () => {
    const task = await makeTask('not_started');
    expect((await post(task.id)).status).toBe(200);
    expect((await row(task.id)).status).toBe('abandoned');
    expect(await bell(task.id)).toHaveLength(0);
  });

  it('(b) in progress: also a Citadel notification and one email to the assignee, with the task link', async () => {
    const task = await makeTask('in_progress', {}, { convo: 'filed' });
    const res = await post(task.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cancelled: true, staff_notified: true });
    expect((await row(task.id)).status).toBe('abandoned');
    const notes = await bell(task.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/^Client cancelled a request from /);
    expect(notes[0].message).toContain(`/tasks/${task.id}`);
    const mail = await outbox(task.id);
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe(staffEmail);
    expect(mail[0].text).toContain(`/tasks/${task.id}`);
    expect(mail[0].text).toMatch(/cancelled a request/);
    expect(mail[0].text).not.toMatch(/[—–]/);
  });

  it('(b) staged and waiting for the client: same, and a repeat sends nothing new', async () => {
    const task = await makeTask('review', { staging_preview_url: 'https://staging.example.test/x' });
    expect((await post(task.id)).status).toBe(200);
    expect(await bell(task.id)).toHaveLength(1);
    expect(await outbox(task.id)).toHaveLength(1);

    const again = await post(task.id);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ cancelled: false, already_cancelled: true, staff_notified: false });
    expect(await bell(task.id)).toHaveLength(1);
    expect(await outbox(task.id)).toHaveLength(1);
    expect(await lines(task.id)).toHaveLength(1);
  });

  it('(b) a task held by Bast has no person to tell: it is cancelled and nobody is mailed', async () => {
    const task = await makeTask('in_progress', {}, { assignee: BAST_USER_ID });
    const res = await post(task.id);
    expect(await res.json()).toMatchObject({ cancelled: true, staff_notified: false });
    expect((await row(task.id)).status).toBe('abandoned');
    expect(await outbox(task.id)).toHaveLength(0);
  });

  it('(c) live: 409 live, nothing changes, and the work page offers a change instead', async () => {
    const task = await makeTask('done', { completed_at: new Date() });
    const res = await post(task.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('live');
    const after = await row(task.id);
    expect(after.status).toBe('done');
    expect(after.tags).not.toContain('client-cancelled');
    expect(await lines(task.id)).toHaveLength(0);
    const work = await (await workRoute(new NextRequest(`http://localhost/api/portal/work/${task.id}`), ctx(task.id))).json();
    expect(work.work.cancel).toBe('live');
  });

  it('approved and not live: cancels, drops client-approved, closes the chat, tells the assignee once (Mike, 2026-10-23)', async () => {
    const task = await makeTask('review', { staging_preview_url: 'https://staging.example.test/x', client_approved_at: new Date(), tags: ['portal-chat', 'client-approved'] }, { convo: 'filed' });
    const res = await post(task.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cancelled: true, staff_notified: true });
    const after = await row(task.id);
    expect(after.status).toBe('abandoned');
    expect(after.tags).toContain('client-cancelled');
    expect(after.tags).not.toContain('client-approved');
    expect(await lines(task.id)).toHaveLength(1);
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: task.id } })).state).toBe('closed');
    const notes = await bell(task.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('do not publish');
    const mail = await outbox(task.id);
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe(staffEmail);
    expect(mail[0].text).toContain('Do not publish it');
    const again = await post(task.id);
    expect(await again.json()).toMatchObject({ already_cancelled: true });
    expect(await outbox(task.id)).toHaveLength(1);
  });

  it('approved and not live, held by Bast: Mike is told instead, since a publish pass may be mid-run', async () => {
    const task = await makeTask('review', { client_approved_at: new Date(), tags: ['portal-chat', 'client-approved'] }, { assignee: BAST_USER_ID });
    const res = await post(task.id);
    expect(res.status).toBe(200);
    expect((await row(task.id)).status).toBe('abandoned');
    const mikeNotes = await prisma.notification.findMany({ where: { entity_id: task.id, user_id: MIKE_USER_ID } });
    expect(mikeNotes).toHaveLength(1);
    expect(await prisma.notification.count({ where: { entity_id: task.id, user_id: staffId } })).toBe(0);
    const mikeRow = await prisma.user.findUnique({ where: { id: MIKE_USER_ID }, select: { email: true } });
    const mail = await outbox(task.id);
    if (mikeRow?.email) {
      expect(mail).toHaveLength(1);
      expect(mail[0].to).toBe(mikeRow.email);
      expect(mail[0].text).toContain('Bast');
    }
    await prisma.notification.deleteMany({ where: { entity_id: task.id, user_id: MIKE_USER_ID } });
  });

  it('cannot be un-cancelled by the client: the chip, the closed chat, no more messages, history and the lists', async () => {
    const task = await makeTask('not_started', {}, { convo: 'clarifying' });
    expect((await post(task.id)).status).toBe(200);

    const work = (await (await workRoute(new NextRequest(`http://localhost/api/portal/work/${task.id}`), ctx(task.id))).json()).work;
    expect(work.state).toEqual({ label: 'Cancelled by you', tone: 'quiet' });
    expect(work.cancel).toBe('cancelled');

    const access = await loadPortalAccess(mocks.session as never);
    const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: task.id } });
    const view = await loadChatView(access, convo.id);
    expect(view).toMatchObject({ state: 'closed', cancel: 'cancelled', cancelled_by_client: true, pending: null });
    expect(view.messages.map((m) => m.text)).toContain(CANCEL_LINE);

    const msg = await workMessageRoute(
      new NextRequest(`http://localhost/api/portal/work/${task.id}/messages`, { method: 'POST', body: JSON.stringify({ client_ref: crypto.randomUUID(), text: 'Actually, wait' }) }),
      ctx(task.id)
    );
    expect(msg.status).toBe(409);
    expect((await msg.json()).code).toBe('cancelled');

    const lists = await (await requestsRoute(new NextRequest('http://localhost/api/portal/requests'))).json();
    expect(lists.open.map((i: { id: string }) => i.id)).not.toContain(task.id);
    const closed = lists.recently_closed.find((i: { id: string }) => i.id === task.id);
    expect(closed.state.label).toBe('Cancelled by you');

    const hist = await (await historyRoute(new NextRequest('http://localhost/api/portal/history'))).json();
    const entry = hist.items.find((i: { id: string }) => i.id === task.id);
    expect(entry).toMatchObject({ type: 'task_cancelled', title: 'Change the hours' });
  });

  it('404s a request of another client and a malformed id; two cancels at once change it once', async () => {
    const task = await makeTask('in_progress');
    mocks.session = { ...(mocks.session as object), clientId: w.otherClientId };
    expect((await post(task.id)).status).toBe(404);
    expect((await row(task.id)).status).toBe('in_progress');
    expect((await post('not-a-uuid')).status).toBe(404);

    asOwner();
    const both = await Promise.all([post(task.id), post(task.id)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    const bodies = await Promise.all(both.map((r) => r.json()));
    expect(bodies.filter((b) => b.cancelled)).toHaveLength(1);
    expect(await lines(task.id)).toHaveLength(1);
    expect(await outbox(task.id)).toHaveLength(1);
  });
});
