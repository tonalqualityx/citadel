// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock('@/lib/services/email', () => ({
  sendTaskApprovalRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { sendTaskApprovalRequestEmail } from '@/lib/services/email';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';
import { recordTaskClientApproval } from '@/lib/services/portal';
import { buildGoLiveBody, goLiveSubject, liveLine, stagedLine } from '@/lib/portal/go-live';
import { runSweep } from '@/lib/portal/chat/sweep';
import { POST as stagedPOST } from '../staged/route';
import { POST as livePOST } from '../live/route';
import type { Mock } from 'vitest';

const authMock = requireAuth as Mock;
const approvalMail = sendTaskApprovalRequestEmail as Mock;

const req = (path: string, body: unknown) =>
  new NextRequest(new URL(`http://localhost/api/tasks/x/${path}`), { method: 'POST', body: JSON.stringify(body) } as never);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(!SCRATCH)('staged -> approved -> live (real database)', () => {
  const tag = `g${Date.now()}`;
  let a: Seeded;

  const staged = (body: unknown, id = a.taskId) => stagedPOST(req('staged', body), params(id));
  const live = (body: unknown, id = a.taskId) => livePOST(req('live', body), params(id));
  const outbox = () => prisma.emailOutbox.findMany({ where: { task_id: a.taskId, kind: 'portal_golive' }, orderBy: { created_at: 'asc' } });
  const task = () => prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });
  const approve = async () => recordTaskClientApproval({ id: a.taskId, client_approved_at: null, site: { auto_deploy: false } }, a.ownerId);

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: BAST_USER_ID },
      update: {},
      create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' },
    });
    a = await seedClient(tag);
  });
  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: { task_id: a.taskId } });
    await prisma.wait.deleteMany({ where: { task_id: a.taskId } });
    await cleanup([a]);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    authMock.mockResolvedValue({ userId: BAST_USER_ID, role: 'pm', email: 'bast@test' });
    approvalMail.mockClear();
    await prisma.emailOutbox.deleteMany({ where: { task_id: a.taskId } });
    await prisma.comment.deleteMany({ where: { task_id: a.taskId } });
    // The default case is a plain portal request with no chat conversation.
    await prisma.chatConversation.deleteMany({ where: { task_id: a.taskId } });
    await prisma.task.update({
      where: { id: a.taskId },
      data: { status: 'in_progress', source: 'portal', tags: [], client_approved_at: null, approved: false, completed_at: null, staging_preview_url: null, client_title: 'Genre page descriptions', requested_by_contact_id: a.ownerId },
    });
  });

  it('staged: review, preview stored, one client-visible line, one approval email; repeat sends nothing', async () => {
    const res = await staged({ preview_url: 'https://preview.example.test/p1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'review', already_staged: false, approval_email: 'sent' });
    const t = await task();
    expect(t.status).toBe('review');
    expect(t.staging_preview_url).toBe('https://preview.example.test/p1');
    const comments = await prisma.comment.findMany({ where: { task_id: a.taskId } });
    expect(comments).toHaveLength(1);
    expect(comments[0].client_visible).toBe(true);
    expect(comments[0].is_internal).toBe(false);
    expect(comments[0].content).toBe(stagedLine('https://preview.example.test/p1'));
    expect(approvalMail).toHaveBeenCalledTimes(1);

    const again = await staged({ preview_url: 'https://preview.example.test/p1' });
    expect((await again.json()).already_staged).toBe(true);
    expect(approvalMail).toHaveBeenCalledTimes(1);
    expect(await prisma.comment.count({ where: { task_id: a.taskId } })).toBe(1);
  });

  it('staged clears the send-back tag, and refuses a task the client already approved', async () => {
    await prisma.task.update({ where: { id: a.taskId }, data: { tags: ['client-sent-back'] } });
    await staged({ preview_url: 'https://preview.example.test/p2' });
    expect((await task()).tags).not.toContain('client-sent-back');
    await approve();
    // Fleet item 5: with approval binding off, a re-stage after a yes is today's 409.
    await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: { approval_binding_mode: 'off' }, create: { id: 'singleton', approval_binding_mode: 'off' } });
    try {
      const res = await staged({ preview_url: 'https://preview.example.test/p3' });
      expect(res.status).toBe(409);
    } finally {
      await prisma.appSettings.update({ where: { id: 'singleton' }, data: { approval_binding_mode: 'warn' } });
    }
  });

  it('the client approval sets the approved state (timestamp + tag) and keeps the status review, not done', async () => {
    await staged({ preview_url: 'https://preview.example.test/p4' });
    await approve();
    const t = await task();
    expect(t.status).toBe('review');
    expect(t.client_approved_at).not.toBeNull();
    expect(t.tags).toContain('client-approved');
  });

  it('live before approval: 409, nothing changes, nothing sent', async () => {
    await staged({ preview_url: 'https://preview.example.test/p5' });
    const res = await live({ live_url: 'https://site.example.test/' });
    expect(res.status).toBe(409);
    expect((await task()).status).toBe('review');
    expect(await outbox()).toHaveLength(0);
    expect(await prisma.comment.count({ where: { task_id: a.taskId } })).toBe(1);
  });

  it('a cancelled request cannot go live, even forced: 409 abandoned, nothing changes, nothing sent', async () => {
    await prisma.task.update({ where: { id: a.taskId }, data: { status: 'abandoned', tags: ['client-cancelled'] } });
    for (const body of [{ live_url: 'https://live.example.test/x' }, { live_url: 'https://live.example.test/x', force: true }]) {
      const res = await live(body);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('abandoned');
    }
    expect((await task()).status).toBe('abandoned');
    expect(await outbox()).toHaveLength(0);
    expect(await prisma.comment.count({ where: { task_id: a.taskId } })).toBe(0);
  });

  it('live after approval: done + completed_at, one client-visible line, one email to the requester only; repeat sends nothing', async () => {
    await staged({ preview_url: 'https://preview.example.test/p6' });
    await approve();
    const res = await live({ live_url: 'https://site.example.test/', summary: 'Search descriptions and intros on all 14 genre pages' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'done', lane: 'email', already_notified: false, emailed: [`olive-${tag}@example.test`] });
    const t = await task();
    expect(t.status).toBe('done');
    expect(t.completed_at).not.toBeNull();
    expect(t.approved).toBe(true);

    const line = await prisma.comment.findFirstOrThrow({ where: { task_id: a.taskId, content: liveLine('https://site.example.test/') } });
    expect(line.client_visible).toBe(true);
    expect(line.is_internal).toBe(false);
    expect(line.content).toBe('This is live now: https://site.example.test/. Reply here if anything looks off.');

    const rows = await outbox();
    expect(rows).toHaveLength(1); // the viewer (Vera) is on the client roster but not on the request
    const r = rows[0];
    expect(r.to).toBe(`olive-${tag}@example.test`);
    expect(r.from_account).toBe('bast@becomeindelible.com');
    expect(r.allow_external).toBe(true);
    expect(r.subject).toBe(`Chat ${tag} Co: your change is live`);
    expect(r.subject).toBe(goLiveSubject(`Chat ${tag} Co`));
    expect(r.text).toBe(buildGoLiveBody({ firstName: 'Olive', what: 'Search descriptions and intros on all 14 genre pages', liveUrl: 'https://site.example.test/', workUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://citadel.becomeindelible.com'}/portal/work/${a.taskId}` }));
    expect(r.text).toContain('Indelible Support');
    expect(r.text).not.toMatch(/bast/i);
    expect(r.text).not.toMatch(/[–—]/);

    const comments = await prisma.comment.count({ where: { task_id: a.taskId } });
    const again = await live({ live_url: 'https://site.example.test/', summary: 'Search descriptions and intros on all 14 genre pages' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ already_notified: true, emailed: [] });
    expect(await outbox()).toHaveLength(1);
    expect(await prisma.comment.count({ where: { task_id: a.taskId } })).toBe(comments);
  });

  it('live also reaches a contact who wrote in the thread, once each', async () => {
    await staged({ preview_url: 'https://preview.example.test/p7' });
    await prisma.comment.create({ data: { task_id: a.taskId, content: 'Looks right to me', author_contact_id: a.viewerId, client_visible: true, source: 'portal' } });
    await approve();
    await live({ live_url: 'https://site.example.test/' });
    const to = (await outbox()).map((r) => r.to).sort();
    expect(to).toEqual([`olive-${tag}@example.test`, `vera-${tag}@example.test`]);
    // no summary: the line names the client's own title for the request
    expect((await outbox())[0].text).toContain('Your change is live: Genre page descriptions');
  });

  it('force: a done task the client approved outside the portal still gets its one email; without force it is a 409', async () => {
    await prisma.task.update({ where: { id: a.taskId }, data: { status: 'done', completed_at: new Date() } });
    expect((await live({ live_url: 'https://site.example.test/' })).status).toBe(409);
    expect(await outbox()).toHaveLength(0);
    const res = await live({ live_url: 'https://site.example.test/', force: true });
    expect(res.status).toBe(200);
    expect(await outbox()).toHaveLength(1);
    expect((await live({ live_url: 'https://site.example.test/', force: true })).status).toBe(200);
    expect(await outbox()).toHaveLength(1);
  });

  it('a task with a chat conversation: the line is a team message, no outbox row from the live call, and the chat sweep emails it when the client is away', async () => {
    const convo = await prisma.chatConversation.create({
      data: { task_id: a.taskId, client_id: a.clientId, site_id: a.siteId, opened_by_contact_id: a.ownerId, email_token: `tk${Date.now()}`.slice(0, 12), state: 'filed' },
    });
    await staged({ preview_url: 'https://preview.example.test/p8' });
    await approve();
    const res = await live({ live_url: 'https://site.example.test/', summary: 'The new page intro' });
    expect(await res.json()).toMatchObject({ lane: 'chat', emailed: [] });
    expect(await outbox()).toHaveLength(0);
    const line = await prisma.comment.findFirstOrThrow({ where: { task_id: a.taskId, content: liveLine('https://site.example.test/') } });
    expect(line.chat_meta).toBeNull(); // unmarked: the chat sweep picks it up
    const stagedLineRow = await prisma.comment.findFirstOrThrow({ where: { task_id: a.taskId, content: stagedLine('https://preview.example.test/p8') } });
    expect(stagedLineRow.chat_meta).not.toBeNull(); // the approval email carried it, the sweep must not repeat it

    const sweep = await runSweep(new Date(Date.now() + 3 * 60_000), { conversationIds: [convo.id] });
    expect(sweep.staff).toBe(1);
    const chatMail = await prisma.emailOutbox.findMany({ where: { task_id: a.taskId } });
    expect(chatMail).toHaveLength(1);
    expect(chatMail[0].kind).toBe('portal_chat');
    expect(chatMail[0].text).toContain('This is live now: https://site.example.test/.');
  });

  it('a task with no portal requester (a WordPress or internal task): the route works for staff, no client comment, no email', async () => {
    await prisma.task.update({ where: { id: a.taskId }, data: { requested_by_contact_id: null, source: 'internal', status: 'review' } });
    expect((await live({ live_url: 'https://site.example.test/' })).status).toBe(409);
    const res = await live({ live_url: 'https://site.example.test/', force: true });
    expect(await res.json()).toMatchObject({ status: 'done', lane: 'none', emailed: [] });
    expect(await outbox()).toHaveLength(0);
    expect(await prisma.comment.count({ where: { task_id: a.taskId } })).toBe(0);
    expect((await task()).status).toBe('done');
  });

  it('the copy scan: a dash or the name Bast in the summary or note is a 400 and changes nothing', async () => {
    await staged({ preview_url: 'https://preview.example.test/p9' });
    await approve();
    for (const summary of ['Pages — all fourteen', 'Pages - all fourteen', 'Bast updated the pages']) {
      const res = await live({ live_url: 'https://site.example.test/', summary });
      expect(res.status).toBe(400);
    }
    expect((await task()).status).toBe('review');
    expect(await outbox()).toHaveLength(0);
    // Fleet item 5: the copy scan runs before an approval is voided, so a bad note leaves the yes in place.
    expect((await staged({ preview_url: 'https://preview.example.test/pa', note: 'Bast built this' })).status).toBe(400);
    expect((await task()).client_approved_at).not.toBeNull();
    await prisma.task.update({ where: { id: a.taskId }, data: { client_approved_at: null, tags: [] } });
    expect((await staged({ preview_url: 'https://preview.example.test/pa', note: 'Bast built this' })).status).toBe(400);
  });

  it('a bad url is a 400, and a tech user is refused', async () => {
    expect((await live({ live_url: 'javascript:alert(1)' })).status).toBe(400);
    authMock.mockResolvedValue({ userId: '00000000-0000-4000-8000-000000000001', role: 'tech', email: 't@test' });
    expect((await live({ live_url: 'https://site.example.test/' })).status).toBe(403);
    expect((await staged({ preview_url: 'https://preview.example.test/pb' })).status).toBe(403);
  });
});
