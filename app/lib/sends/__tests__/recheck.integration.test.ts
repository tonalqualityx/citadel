// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));

import type { Mock } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';
import { recordTaskClientApproval } from '@/lib/services/portal';
import { markStaged, markLive } from '@/lib/portal/go-live';
import { queueInOutbox } from '../outbox';
import { recheckSend, claimNotice, releaseNotice, previewTag } from '../recheck';
import { decideSend } from '../policy';
import type { Govern } from '../govern';
import { POST as claimPOST } from '@/app/api/email-outbox/[id]/claim/route';
import { GET as listGET } from '@/app/api/email-outbox/route';
import { PUT as sendingPUT } from '@/app/api/approval-requests/[id]/sending/route';
import { POST as recheckPOST } from '@/app/api/sends/recheck/route';
import { POST as failedPOST } from '@/app/api/email-outbox/[id]/failed/route';
import { PATCH as taskPATCH } from '@/app/api/tasks/[id]/route';

const authMock = requireAuth as Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (body: unknown) => new NextRequest(new URL('http://localhost/api/x'), { method: 'POST', body: JSON.stringify(body) } as never);

describe.skipIf(!SCRATCH)('send-time recheck (real database)', () => {
  const tag = `r${Date.now()}`;
  let a: Seeded;
  let userId: string;
  let projectId: string;

  const reset = async (data: Record<string, unknown> = {}) => {
    await prisma.comment.deleteMany({ where: { task_id: a.taskId } });
    await prisma.task.update({
      where: { id: a.taskId },
      data: { status: 'review', source: 'portal', tags: [], client_approved_at: null, approved: false, completed_at: null, is_deleted: false, staging_preview_url: 'https://preview.example.test/a', client_title: 'Genre pages', requested_by_contact_id: a.ownerId, ...data },
    });
  };
  const reason = async (g: Govern) => {
    const r = await recheckSend(g);
    return r.ok ? 'ok' : `${r.reason}/${r.severity}`;
  };
  const setting = (data: { send_recheck_mode?: string; send_recheck_heuristics?: string }) =>
    prisma.appSettings.upsert({ where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data } });

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    const u = await prisma.user.create({ data: { email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner', role: 'pm' } });
    userId = u.id;
    a = await seedClient(tag);
    const p = await prisma.project.create({ data: { name: `P ${tag}`, client_id: a.clientId } });
    projectId = p.id;
  });
  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: { OR: [{ task_id: a.taskId }, { to: { contains: tag } }] } });
    await prisma.approvalRequest.deleteMany({ where: { task_id: a.taskId } });
    await prisma.proposal.deleteMany({ where: { accord: { name: { contains: tag } } } });
    await prisma.contract.deleteMany({ where: { accord: { name: { contains: tag } } } });
    await prisma.accord.deleteMany({ where: { name: { contains: tag } } });
    await prisma.msaVersion.deleteMany({ where: { version: `t${tag}`.slice(0, 20) } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await cleanup([a]);
    await setting({ send_recheck_mode: 'enforce', send_recheck_heuristics: 'shadow' });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    authMock.mockResolvedValue({ userId: BAST_USER_ID, role: 'pm', email: 'bast@test' });
    await setting({ send_recheck_mode: 'enforce', send_recheck_heuristics: 'shadow' });
    await prisma.emailOutbox.deleteMany({ where: { OR: [{ task_id: a.taskId }, { to: { contains: tag } }] } });
    await prisma.chatConversation.updateMany({ where: { task_id: a.taskId }, data: { state: 'clarifying' } });
    await reset();
  });

  describe('approval_request', () => {
    const g = (): Govern => ({ intent: 'approval_request', task_id: a.taskId, snapshot: { preview_url: 'https://preview.example.test/a' } });
    it('passes while the task waits for the client', async () => expect(await reason(g())).toBe('ok'));
    it('task_closed: abandoned', async () => { await reset({ status: 'abandoned' }); expect(await reason(g())).toBe('task_closed/definitive'); });
    it('task_closed: deleted', async () => { await reset({ is_deleted: true }); expect(await reason(g())).toBe('task_closed/definitive'); });
    it('already_approved: timestamp', async () => { await reset({ client_approved_at: new Date() }); expect(await reason(g())).toBe('already_approved/definitive'); });
    it('already_approved: tag', async () => { await reset({ tags: ['client-approved'] }); expect(await reason(g())).toBe('already_approved/definitive'); });
    it('already_live', async () => { await reset({ status: 'done' }); expect(await reason(g())).toBe('already_live/definitive'); });
    it('preview_changed is heuristic', async () => { await reset({ staging_preview_url: 'https://preview.example.test/b' }); expect(await reason(g())).toBe('preview_changed/heuristic'); });
    it('a heuristic drop is only reported under shadow heuristics, and enforced when switched', async () => {
      await reset({ staging_preview_url: 'https://preview.example.test/b' });
      const shadow = await decideSend(g());
      expect(shadow.ok).toBe(true);
      expect(shadow.would_drop).toMatchObject({ reason: 'preview_changed', severity: 'heuristic' });
      await setting({ send_recheck_heuristics: 'enforce' });
      expect((await decideSend(g())).ok).toBe(false);
    });
  });

  describe('golive', () => {
    const g = (snapshot?: { claimed?: boolean; before_live?: boolean }): Govern => ({ intent: 'golive', task_id: a.taskId, snapshot });
    it('passes for a done task', async () => { await reset({ status: 'done' }); expect(await reason(g())).toBe('ok'); });
    it('task_reopened: not done', async () => expect(await reason(g())).toBe('task_reopened/definitive'));
    it('task_reopened: abandoned', async () => { await reset({ status: 'abandoned' }); expect(await reason(g())).toBe('task_reopened/definitive'); });
    it('already_notified when another channel holds the claim', async () => { await reset({ status: 'done', tags: ['go-live-notified'] }); expect(await reason(g())).toBe('already_notified/definitive'); });
    it('a row queued by the claim holder is not blocked by its own claim', async () => { await reset({ status: 'done', tags: ['go-live-notified'] }); expect(await reason(g({ claimed: true }))).toBe('ok'); });
    it('before_live needs the approved state', async () => {
      expect(await reason(g({ before_live: true }))).toBe('not_approved/definitive');
      await reset({ tags: ['client-approved'] });
      expect(await reason(g({ before_live: true }))).toBe('ok');
    });
  });

  describe('links', () => {
    for (const intent of ['magic_link', 'invite'] as const) {
      it(`${intent}: link_expired`, async () => {
        expect(await reason({ intent, snapshot: { expires_at: new Date(Date.now() - 1000).toISOString() } })).toBe('link_expired/definitive');
        expect(await reason({ intent, snapshot: { expires_at: new Date(Date.now() + 60000).toISOString() } })).toBe('ok');
      });
    }
  });

  describe('proposal and contract', () => {
    let accordId: string;
    let msaId: string;
    beforeAll(async () => {
      const acc = await prisma.accord.create({ data: { name: `Accord ${tag}`, owner_id: userId } });
      accordId = acc.id;
      const msa = await prisma.msaVersion.create({ data: { version: `t${tag}`.slice(0, 20), content: 'x', effective_date: new Date(), created_by_id: userId } });
      msaId = msa.id;
    });
    const proposal = (version: number, status: 'draft' | 'sent' | 'accepted' = 'sent') =>
      prisma.proposal.create({ data: { accord_id: accordId, version, content: 'c', status, pricing_snapshot: {}, created_by_id: userId } });
    const contract = (version: number, status: 'draft' | 'sent' | 'signed' = 'sent') =>
      prisma.contract.create({ data: { accord_id: accordId, version, content: 'c', status, pricing_snapshot: {}, msa_version_id: msaId, created_by_id: userId } });
    beforeEach(async () => {
      await prisma.proposal.deleteMany({ where: { accord_id: accordId } });
      await prisma.contract.deleteMany({ where: { accord_id: accordId } });
    });
    it('proposal: passes when it is the sent, newest version', async () => {
      const p = await proposal(1);
      expect(await reason({ intent: 'proposal', proposal_id: p.id })).toBe('ok');
    });
    it('proposal: withdrawn back to draft', async () => {
      const p = await proposal(1, 'draft');
      expect(await reason({ intent: 'proposal', proposal_id: p.id })).toBe('superseded_version/definitive');
    });
    it('proposal: a newer version exists', async () => {
      const p = await proposal(1);
      await proposal(2, 'draft');
      expect(await reason({ intent: 'proposal', proposal_id: p.id })).toBe('superseded_version/definitive');
    });
    it('proposal: already answered', async () => {
      const p = await proposal(1, 'accepted');
      expect(await reason({ intent: 'proposal', proposal_id: p.id })).toBe('superseded_version/definitive');
    });
    it('contract: passes when sent and newest', async () => {
      const c = await contract(1);
      expect(await reason({ intent: 'contract', contract_id: c.id })).toBe('ok');
    });
    it('contract: withdrawn, signed, or a newer version', async () => {
      const d = await contract(1, 'draft');
      expect(await reason({ intent: 'contract', contract_id: d.id })).toBe('superseded_version/definitive');
      const s = await contract(2, 'signed');
      expect(await reason({ intent: 'contract', contract_id: s.id })).toBe('superseded_version/definitive');
      const old = await contract(3, 'sent');
      await contract(4, 'draft');
      expect(await reason({ intent: 'contract', contract_id: old.id })).toBe('superseded_version/definitive');
    });
  });

  describe('chat', () => {
    it('passes while the conversation is open', async () => expect(await reason({ intent: 'chat', task_id: a.taskId })).toBe('ok'));
    it('conversation_closed', async () => {
      await prisma.chatConversation.update({ where: { task_id: a.taskId }, data: { state: 'closed' } });
      expect(await reason({ intent: 'chat', task_id: a.taskId })).toBe('conversation_closed/definitive');
    });
    it('the claim route still runs chatRecipientAllowed', async () => {
      const row = await queueInOutbox(prisma, { to: `stranger-${tag}@example.test`, subject: 's', text: 't', kind: 'portal_chat', allow_external: true, task_id: a.taskId }, { intent: 'chat', task_id: a.taskId });
      const res = await claimPOST(jsonReq({}), params(row.id));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('Recipient not allowed');
    });
  });

  describe('approval_mail', () => {
    let arId: string;
    const mkRequest = async (status: 'queued' | 'draft' = 'queued') => {
      const r = await prisma.approvalRequest.create({ data: { task_id: a.taskId, project_id: projectId, status, subject: 'Please approve', body: 'Body text', to_email: `olive-${tag}@example.test`, queued_at: new Date() } });
      arId = r.id;
      return r;
    };
    beforeEach(async () => { await prisma.approvalRequest.deleteMany({ where: { task_id: a.taskId } }); });
    const g = (): Govern => ({ intent: 'approval_mail', task_id: a.taskId, approval_request_id: arId });
    it('passes for a queued request on a waiting task', async () => { await mkRequest(); expect(await reason(g())).toBe('ok'); });
    it('task_closed', async () => { await mkRequest(); await reset({ status: 'abandoned' }); expect(await reason(g())).toBe('task_closed/definitive'); });
    it('already_live', async () => { await mkRequest(); await reset({ status: 'done' }); expect(await reason(g())).toBe('already_live/definitive'); });
    it('already_approved', async () => { await mkRequest(); await reset({ client_approved_at: new Date() }); expect(await reason(g())).toBe('already_approved/definitive'); });
    it('request_not_queued', async () => { await mkRequest('draft'); expect(await reason(g())).toBe('request_not_queued/definitive'); });

    it('PUT sending returns the fresh row when it passes', async () => {
      const r = await mkRequest();
      const res = await sendingPUT(jsonReq({}), params(r.id));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: r.id, status: 'sending', subject: 'Please approve', body: 'Body text', to_email: `olive-${tag}@example.test` });
    });
    it('PUT sending drops it, stamps superseded and cancels, when the client already approved', async () => {
      const r = await mkRequest();
      await reset({ client_approved_at: new Date() });
      const res = await sendingPUT(jsonReq({}), params(r.id));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'superseded', reason: 'already_approved' });
      const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } });
      expect(row).toMatchObject({ status: 'cancelled', superseded_reason: 'already_approved' });
      expect(row.superseded_at).not.toBeNull();
    });
  });

  describe('notice_internal and none', () => {
    it('task_closed', async () => {
      expect(await reason({ intent: 'notice_internal', task_id: a.taskId })).toBe('ok');
      await reset({ status: 'abandoned' });
      expect(await reason({ intent: 'notice_internal', task_id: a.taskId })).toBe('task_closed/definitive');
    });
    it('none is never dropped', async () => {
      await reset({ status: 'abandoned', is_deleted: true });
      expect(await reason({ intent: 'none', reason: 'password reset' })).toBe('ok');
    });
  });

  describe('modes, claim route, comments', () => {
    const queueApproval = (suffix = '') =>
      queueInOutbox(prisma, { to: `olive-${tag}${suffix}@example.test`, subject: 'Ready', text: 't', kind: 'other', allow_external: true }, { intent: 'approval_request', task_id: a.taskId, snapshot: { preview_url: 'https://preview.example.test/a' } });

    it('a row that is still right is claimed and returned', async () => {
      const row = await queueApproval();
      const res = await claimPOST(jsonReq({}), params(row.id));
      expect(res.status).toBe(200);
      expect((await res.json()).id).toBe(row.id);
    });
    it('a wrong row is 409 superseded, stamped, hidden from the list, and never claimable again', async () => {
      const row = await queueApproval();
      await reset({ client_approved_at: new Date() });
      const res = await claimPOST(jsonReq({}), params(row.id));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'superseded', reason: 'already_approved' });
      const stamped = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
      expect(stamped.superseded_reason).toBe('already_approved');
      expect(stamped.sent_at).toBeNull();
      const list = await (await listGET()).json();
      expect(list.items.map((i: { id: string }) => i.id)).not.toContain(row.id);
      const again = await claimPOST(jsonReq({}), params(row.id));
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ code: 'superseded' });
    });
    it('a drop leaves one internal comment per task per intent per day', async () => {
      const r1 = await queueApproval('x1');
      const r2 = await queueApproval('x2');
      await reset({ client_approved_at: new Date() });
      await claimPOST(jsonReq({}), params(r1.id));
      await claimPOST(jsonReq({}), params(r2.id));
      const notes = await prisma.comment.findMany({ where: { task_id: a.taskId, is_internal: true, content: { startsWith: 'Send dropped (approval_request)' } } });
      expect(notes).toHaveLength(1);
      expect(notes[0].client_visible).toBe(false);
      expect(notes[0].content).toContain('already_approved');
    });
    // Fleet item 5 point 5: a real drop leaves a send_dropped step on the task's receipts.
    describe('send_dropped receipts', () => {
      const dropped = () => prisma.taskReceipt.findMany({ where: { task_id: a.taskId, step: 'send_dropped' }, orderBy: { created_at: 'asc' } });
      beforeEach(async () => { await prisma.taskReceipt.deleteMany({ where: { task_id: a.taskId } }); });

      it('an outbox drop writes one receipt with the outbox id, intent and reason', async () => {
        const row = await queueApproval('d1');
        await reset({ client_approved_at: new Date() });
        expect((await claimPOST(jsonReq({}), params(row.id))).status).toBe(409);
        const rs = await dropped();
        expect(rs).toHaveLength(1);
        expect(rs[0].outbox_ids).toEqual([row.id]);
        expect(rs[0].live_check).toMatchObject({ reason: 'already_approved', intent: 'approval_request', severity: 'definitive' });
      });
      it('an approval request drop writes a receipt naming the request, not an outbox row', async () => {
        const r = await prisma.approvalRequest.create({ data: { task_id: a.taskId, project_id: projectId, status: 'queued', subject: 'Please approve', body: 'Body', to_email: `olive-${tag}@example.test`, queued_at: new Date() } });
        await reset({ client_approved_at: new Date() });
        expect((await sendingPUT(jsonReq({}), params(r.id))).status).toBe(409);
        const rs = await dropped();
        expect(rs).toHaveLength(1);
        expect(rs[0].outbox_ids).toEqual([]);
        expect(rs[0].live_check).toMatchObject({ reason: 'already_approved', intent: 'approval_mail', approval_request_id: r.id });
      });
      it('a shadow would-drop, a probe and a pass write none', async () => {
        const row = await queueApproval('d3');
        await reset({ client_approved_at: new Date() });
        await setting({ send_recheck_mode: 'shadow' });
        expect((await claimPOST(jsonReq({}), params(row.id))).status).toBe(200);
        await setting({ send_recheck_mode: 'enforce' });
        const g: Govern = { intent: 'approval_request', task_id: a.taskId, snapshot: { preview_url: 'https://preview.example.test/a' } };
        expect((await decideSend(g, null, { probe: true })).ok).toBe(false);
        await reset();
        expect((await decideSend(g, null)).ok).toBe(true);
        expect(await dropped()).toHaveLength(0);
      });
      it('a task-less govern block (a link) writes no receipt and does not fail', async () => {
        const d = await decideSend({ intent: 'magic_link', snapshot: { expires_at: new Date(Date.now() - 1000).toISOString() } });
        expect(d.ok).toBe(false);
        expect(await dropped()).toHaveLength(0);
      });
    });
    it('a row without govern passes (ungoverned)', async () => {
      const row = await prisma.emailOutbox.create({ data: { to: `old-${tag}@example.test`, subject: 's', text: 't' } });
      const res = await claimPOST(jsonReq({}), params(row.id));
      expect(res.status).toBe(200);
    });
    it('shadow mode logs but does not drop; off mode skips the check', async () => {
      const row = await queueApproval('s1');
      await reset({ client_approved_at: new Date() });
      await setting({ send_recheck_mode: 'shadow' });
      expect((await claimPOST(jsonReq({}), params(row.id))).status).toBe(200);
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { claimed_at: null } });
      await setting({ send_recheck_mode: 'off' });
      expect((await claimPOST(jsonReq({}), params(row.id))).status).toBe(200);
      expect(await prisma.comment.count({ where: { task_id: a.taskId, content: { startsWith: 'Send dropped' } } })).toBe(0);
    });
  });

  describe('claimNotice and POST /api/sends/recheck', () => {
    it('claimNotice live is true only for the first caller', async () => {
      expect(await claimNotice(a.taskId, 'live')).toMatch(/^[0-9a-f]{12}$/);
      expect(await claimNotice(a.taskId, 'live')).toBeNull();
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags.filter((t) => t === 'go-live-notified')).toHaveLength(1);
    });
    it('claimNotice preview is per url', async () => {
      expect(await claimNotice(a.taskId, 'preview', 'https://p.example.test/1')).toBeTruthy();
      expect(await claimNotice(a.taskId, 'preview', 'https://p.example.test/1')).toBeNull();
      expect(await claimNotice(a.taskId, 'preview', 'https://p.example.test/2')).toBeTruthy();
      const t = await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });
      expect(t.tags).toContain(previewTag('https://p.example.test/1'));
      expect(previewTag('https://p.example.test/1')).toMatch(/^preview-notified:[0-9a-f]{10}$/);
    });
    it('the route returns ok and claimed, then refuses a second channel', async () => {
      await reset({ tags: ['client-approved'] });
      const body = { govern: { intent: 'golive', task_id: a.taskId, snapshot: { before_live: true } }, claim: 'live' };
      const first = await (await recheckPOST(jsonReq(body))).json();
      expect(first).toMatchObject({ ok: true, claimed: true });
      const second = await (await recheckPOST(jsonReq(body))).json();
      expect(second).toMatchObject({ ok: false, reason: 'already_notified', claimed: false });
    });
    it('the route reports a drop without claiming', async () => {
      await reset({ status: 'abandoned' });
      const res = await (await recheckPOST(jsonReq({ govern: { intent: 'golive', task_id: a.taskId, snapshot: { before_live: true } }, claim: 'live' }))).json();
      expect(res).toMatchObject({ ok: false, reason: 'task_reopened', severity: 'definitive' });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags).not.toContain('go-live-notified');
    });
    it('the route refuses a bad govern block and a preview claim without a url', async () => {
      expect((await recheckPOST(jsonReq({ govern: { intent: 'nope' } }))).status).toBe(400);
      expect((await recheckPOST(jsonReq({ govern: { intent: 'chat', task_id: a.taskId }, claim: 'preview' }))).status).toBe(400);
    });
  });

  describe('review fixes', () => {
    it('before_live accepts the staff approval flag', async () => {
      await reset({ approved: true });
      expect(await reason({ intent: 'golive', task_id: a.taskId, snapshot: { before_live: true } })).toBe('ok');
    });
    it('a closed conversation drops automated mail but not a staff reply', async () => {
      await prisma.chatConversation.update({ where: { task_id: a.taskId }, data: { state: 'closed' } });
      expect(await reason({ intent: 'chat', task_id: a.taskId })).toBe('conversation_closed/definitive');
      expect(await reason({ intent: 'chat', task_id: a.taskId, snapshot: { staff: true } })).toBe('ok');
    });
    it('approval_request reads the preview claim; a claim holder and a staff resend are exempt', async () => {
      const url = 'https://preview.example.test/a';
      await claimNotice(a.taskId, 'preview', url);
      expect(await reason({ intent: 'approval_request', task_id: a.taskId, snapshot: { preview_url: url } })).toBe('already_notified/definitive');
      expect(await reason({ intent: 'approval_request', task_id: a.taskId, snapshot: { preview_url: url, claimed: true } })).toBe('ok');
    });
    it('releaseNotice gives the claim back once', async () => {
      const holder = await claimNotice(a.taskId, 'live');
      expect(holder).toBeTruthy();
      expect(await releaseNotice(a.taskId, 'live', null, 'wrongholder')).toBe(false);
      expect(await releaseNotice(a.taskId, 'live', null, null)).toBe(false);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags).toContain('go-live-notified');
      expect(await releaseNotice(a.taskId, 'live', null, holder)).toBe(true);
      expect(await releaseNotice(a.taskId, 'live', null, holder)).toBe(false);
      const tags = (await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags;
      expect(tags.filter((t) => t.startsWith('go-live') || t.startsWith('cl:'))).toEqual([]);
      expect(await claimNotice(a.taskId, 'live')).toBeTruthy();
    });
    it('the route releases a claim, and a released claim can be taken again', async () => {
      await reset({ tags: ['client-approved'] });
      const body = { govern: { intent: 'golive', task_id: a.taskId, snapshot: { before_live: true } }, claim: 'live' };
      const first = await (await recheckPOST(jsonReq(body))).json();
      expect(first.claimed).toBe(true);
      expect(await (await recheckPOST(jsonReq({ ...body, release: true, claim_holder: 'someoneelse' }))).json()).toMatchObject({ ok: true, released: false });
      expect(await (await recheckPOST(jsonReq({ ...body, release: true, claim_holder: first.claim_holder }))).json()).toMatchObject({ ok: true, released: true });
      expect((await (await recheckPOST(jsonReq(body))).json()).claimed).toBe(true);
      expect((await recheckPOST(jsonReq({ govern: body.govern, release: true }))).status).toBe(400);
    });
    it('a probe drop leaves no Send dropped comment', async () => {
      await reset({ status: 'abandoned' });
      const res = await (await recheckPOST(jsonReq({ govern: { intent: 'approval_mail', task_id: a.taskId }, probe: true }))).json();
      expect(res).toMatchObject({ ok: false, reason: 'task_closed' });
      expect(await prisma.comment.count({ where: { task_id: a.taskId, content: { startsWith: 'Send dropped' } } })).toBe(0);
      await recheckPOST(jsonReq({ govern: { intent: 'approval_mail', task_id: a.taskId } }));
      expect(await prisma.comment.count({ where: { task_id: a.taskId, content: { startsWith: 'Send dropped' } } })).toBe(1);
    });
    it('markLive with nobody to tell gives the claim back, so the worker note still sends (control)', async () => {
      await reset({ tags: ['client-approved'], client_approved_at: new Date(), source: 'email', requested_by_contact_id: null });
      await prisma.chatConversation.deleteMany({ where: { task_id: a.taskId } });
      const res = await markLive({ taskId: a.taskId, authorId: BAST_USER_ID, liveUrl: 'https://site.example.test/' });
      expect(res.lane).toBe('none');
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags).not.toContain('go-live-notified');
      const guard = await (await recheckPOST(jsonReq({ govern: { intent: 'golive', task_id: a.taskId, snapshot: { before_live: true } }, claim: 'live' }))).json();
      expect(guard).toMatchObject({ ok: true, claimed: true });
    });
    it('N1: an email-sourced revision round at the same URL is told afresh once the task leaves review', async () => {
      const url = 'https://preview.example.test/same';
      await reset({ status: 'review', staging_preview_url: url, source: 'email' });
      expect(await claimNotice(a.taskId, 'preview', url)).toBeTruthy();
      const g: Govern = { intent: 'approval_request', task_id: a.taskId, snapshot: { preview_url: url } };
      expect(await reason(g)).toBe('already_notified/definitive');
      const res = await taskPATCH(new NextRequest(new URL('http://localhost/api/tasks/x'), { method: 'PATCH', body: JSON.stringify({ status: 'in_progress' }) } as never), params(a.taskId));
      expect(res.status).toBe(200);
      const tags = (await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags;
      expect(tags.filter((t) => t.includes('preview-notified'))).toEqual([]);
      await reset({ status: 'review', staging_preview_url: url, source: 'email' });
      expect(await reason(g)).toBe('ok');
      expect(await claimNotice(a.taskId, 'preview', url)).toBeTruthy();
    });
    it('N1: portal re-stage after a send-back mails exactly once, even with two concurrent markStaged calls', async () => {
      const url = 'https://preview.example.test/restage';
      await reset({ status: 'in_progress', staging_preview_url: null });
      await markStaged({ taskId: a.taskId, authorId: BAST_USER_ID, previewUrl: url });
      const mails = () => prisma.emailOutbox.count({ where: { to: `olive-${tag}@example.test`, kind: 'other', govern: { path: ['intent'], equals: 'approval_request' } } });
      expect(await mails()).toBe(1);
      const { clearPreviewClaims } = await import('../claims');
      await clearPreviewClaims(a.taskId); // what a send-back does
      await reset({ status: 'in_progress', tags: ['client-sent-back'], staging_preview_url: null });
      await Promise.all([
        markStaged({ taskId: a.taskId, authorId: BAST_USER_ID, previewUrl: url }),
        markStaged({ taskId: a.taskId, authorId: BAST_USER_ID, previewUrl: url }),
      ]);
      expect(await mails()).toBe(2);
    });
    it('N2: a superseded row gives back the claim it held, unless a sibling row was sent', async () => {
      const mk = async (holder: string) => queueInOutbox(prisma, { to: `g-${tag}-${Math.random().toString(36).slice(2, 7)}@example.test`, subject: 'live', text: 't', kind: 'portal_golive', allow_external: true, task_id: a.taskId }, { intent: 'golive', task_id: a.taskId, snapshot: { claimed: true, holder } });
      await reset({ status: 'in_progress' }); // reopened: the go-live rows are wrong now
      let holder = (await claimNotice(a.taskId, 'live')) as string;
      const row = await mk(holder);
      expect((await claimPOST(jsonReq({}), params(row.id))).status).toBe(409);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags.filter((t) => t.includes('go-live-notified'))).toEqual([]);
      // with a sent sibling the client was told, so the claim stands
      await prisma.emailOutbox.deleteMany({ where: { task_id: a.taskId } });
      holder = (await claimNotice(a.taskId, 'live')) as string;
      const sibling = await mk(holder);
      await prisma.emailOutbox.update({ where: { id: sibling.id }, data: { sent_at: new Date() } });
      const row2 = await mk(holder);
      expect((await claimPOST(jsonReq({}), params(row2.id))).status).toBe(409);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags).toContain('go-live-notified');
    });
    it('N2: a row out of attempts gives back its claim', async () => {
      await reset({ status: 'done', client_approved_at: new Date() });
      const holder = (await claimNotice(a.taskId, 'live')) as string;
      const row = await queueInOutbox(prisma, { to: `f-${tag}@example.test`, subject: 'live', text: 't', kind: 'portal_golive', allow_external: true, task_id: a.taskId }, { intent: 'golive', task_id: a.taskId, snapshot: { claimed: true, holder } });
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { attempts: 4 } });
      await failedPOST(jsonReq({ last_error: 'boom' }), params(row.id));
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags).not.toContain('go-live-notified');
    });
    it('markStaged skips the mail when the preview was already claimed, and re-sends after a send-back', async () => {
      const url = 'https://preview.example.test/claimed';
      await reset({ status: 'in_progress', staging_preview_url: null });
      await claimNotice(a.taskId, 'preview', url);
      const first = await markStaged({ taskId: a.taskId, authorId: BAST_USER_ID, previewUrl: url });
      expect(first.approval_email).toBe('skipped');
      await reset({ status: 'in_progress', staging_preview_url: null, tags: ['client-sent-back'] });
      const second = await markStaged({ taskId: a.taskId, authorId: BAST_USER_ID, previewUrl: url });
      expect(second.approval_email).toBe('sent');
    });
  });

  describe('replays', () => {
    it('A: portal task staged, approval mail queued, client approves, the drain claim gets 409 already_approved', async () => {
      await reset({ status: 'in_progress', staging_preview_url: null });
      const staged = await markStaged({ taskId: a.taskId, authorId: BAST_USER_ID, previewUrl: 'https://preview.example.test/replay' });
      expect(staged.approval_email).toBe('sent');
      const queued = await prisma.emailOutbox.findFirstOrThrow({ where: { to: `olive-${tag}@example.test`, kind: 'other' }, orderBy: { created_at: 'desc' } });
      expect(queued.govern).toMatchObject({ intent: 'approval_request', task_id: a.taskId, snapshot: { preview_url: 'https://preview.example.test/replay' } });
      await recordTaskClientApproval({ id: a.taskId, client_approved_at: null, site: { auto_deploy: false } }, a.ownerId);
      const res = await claimPOST(jsonReq({}), params(queued.id));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'superseded', reason: 'already_approved' });
    });

    it('B: claim live on the route, then markLive force creates zero portal_golive rows and still posts the client-visible line', async () => {
      await reset({ tags: ['client-approved'], client_approved_at: new Date() });
      await prisma.chatConversation.deleteMany({ where: { task_id: a.taskId } });
      const claim = await (await recheckPOST(jsonReq({ govern: { intent: 'golive', task_id: a.taskId, snapshot: { before_live: true } }, claim: 'live' }))).json();
      expect(claim).toMatchObject({ ok: true, claimed: true });
      const res = await markLive({ taskId: a.taskId, authorId: BAST_USER_ID, liveUrl: 'https://site.example.test/', force: true });
      expect(res.already_notified).toBe(true);
      expect(await prisma.emailOutbox.count({ where: { task_id: a.taskId, kind: 'portal_golive' } })).toBe(0);
      const lines = await prisma.comment.findMany({ where: { task_id: a.taskId, client_visible: true } });
      expect(lines).toHaveLength(1);
      expect(lines[0].content).toContain('This is live now: https://site.example.test/');
      expect(lines[0].chat_meta).toMatchObject({ email_notice: 'go_live_claimed_elsewhere' });
      // a repeat adds nothing
      await markLive({ taskId: a.taskId, authorId: BAST_USER_ID, liveUrl: 'https://site.example.test/', force: true });
      expect(await prisma.comment.count({ where: { task_id: a.taskId, client_visible: true } })).toBe(1);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags.filter((t) => t === 'go-live-notified')).toHaveLength(1);
    });

    it('markLive without a prior claim still queues the golive rows, with govern, and they pass the recheck', async () => {
      await reset({ tags: ['client-approved'], client_approved_at: new Date() });
      await prisma.chatConversation.deleteMany({ where: { task_id: a.taskId } });
      const res = await markLive({ taskId: a.taskId, authorId: BAST_USER_ID, liveUrl: 'https://site.example.test/' });
      expect(res.lane).toBe('email');
      const rows = await prisma.emailOutbox.findMany({ where: { task_id: a.taskId, kind: 'portal_golive' } });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].govern).toMatchObject({ intent: 'golive', snapshot: { claimed: true } });
      const claimed = await claimPOST(jsonReq({}), params(rows[0].id));
      expect(claimed.status).toBe(200);
    });
  });
});
