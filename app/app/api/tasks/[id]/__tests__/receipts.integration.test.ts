// @vitest-environment node
// Fleet item 5: receipts, and the client's yes bound to the build they saw (real database).
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
import { voidApprovalIfRestaged, sameSha } from '@/lib/portal/receipts';
import { POST as stagedPOST } from '../staged/route';
import { POST as livePOST } from '../live/route';
import { PATCH as taskPATCH } from '../route';
import { GET as receiptsGET } from '../receipts/route';
import type { Mock } from 'vitest';

const authMock = requireAuth as Mock;
const approvalMail = sendTaskApprovalRequestEmail as Mock;

const req = (path: string, body: unknown, method = 'POST') =>
  new NextRequest(new URL(`http://localhost/api/tasks/x/${path}`), { method, ...(body === null ? {} : { body: JSON.stringify(body) }) } as never);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const SHA1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA2 = 'b2c3d4e5f60718293a4b5c6d7e8f9012345678aa';

describe.skipIf(!SCRATCH)('receipts and approval binding (real database)', () => {
  const tag = `r${Date.now()}`;
  let a: Seeded;

  const staged = (body: unknown) => stagedPOST(req('staged', body), params(a.taskId));
  const live = (body: unknown) => livePOST(req('live', body), params(a.taskId));
  const patch = (body: unknown) => taskPATCH(req('', body, 'PATCH'), params(a.taskId));
  const task = () => prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });
  const receipts = (step?: string) => prisma.taskReceipt.findMany({ where: { task_id: a.taskId, ...(step ? { step: step as never } : {}) }, orderBy: { created_at: 'asc' } });
  const approve = () => recordTaskClientApproval({ id: a.taskId, client_approved_at: null, site: { auto_deploy: false } }, a.ownerId);
  const setMode = (m: string) => prisma.appSettings.upsert({ where: { id: 'singleton' }, update: { approval_binding_mode: m }, create: { id: 'singleton', approval_binding_mode: m } });
  const stage = (url: string, sha: string | null = SHA1) => staged({ preview_url: url, ...(sha ? { commit_sha: sha, deploy_url: 'https://abc123.proj.pages.dev', deploy_id: 'dep-1' } : {}) });

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: BAST_USER_ID },
      update: {},
      create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' },
    });
    a = await seedClient(tag);
  });
  afterAll(async () => {
    await setMode('warn');
    await prisma.emailOutbox.deleteMany({ where: { task_id: a.taskId } });
    await prisma.wait.deleteMany({ where: { task_id: a.taskId } });
    await cleanup([a]);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    authMock.mockResolvedValue({ userId: BAST_USER_ID, role: 'admin', email: 'bast@test', via: 'session' });
    approvalMail.mockClear();
    await setMode('warn');
    await prisma.taskReceipt.deleteMany({ where: { task_id: a.taskId } });
    await prisma.emailOutbox.deleteMany({ where: { task_id: a.taskId } });
    await prisma.comment.deleteMany({ where: { task_id: a.taskId } });
    await prisma.chatConversation.deleteMany({ where: { task_id: a.taskId } });
    await prisma.task.update({
      where: { id: a.taskId },
      data: {
        status: 'in_progress', source: 'portal', tags: [], client_approved_at: null, approved_by_contact_id: null, approved: false, completed_at: null,
        staging_preview_url: null, staging_commit_sha: null, staging_deploy_id: null, staging_deploy_url: null,
        approved_preview_url: null, approved_commit_sha: null, approved_deploy_id: null,
        client_title: 'Genre page descriptions', requested_by_contact_id: a.ownerId,
      },
    });
  });

  it('staged stores the build on the task and writes a staged receipt with the checks', async () => {
    const res = await staged({ preview_url: 'https://p.example.test/1', commit_sha: SHA1, deploy_id: 'dep-1', deploy_url: 'https://abc123.proj.pages.dev', checks: [{ name: 'build', ok: true, exit_code: 0 }] });
    expect(res.status).toBe(200);
    const t = await task();
    expect(t).toMatchObject({ staging_commit_sha: SHA1, staging_deploy_id: 'dep-1', staging_deploy_url: 'https://abc123.proj.pages.dev/' });
    const [r] = await receipts('staged');
    expect(r).toMatchObject({ commit_sha: SHA1, deploy_id: 'dep-1', preview_url: 'https://p.example.test/1', actor_user_id: BAST_USER_ID, mismatch: false });
    expect(r.checks).toEqual([{ name: 'build', ok: true, exit_code: 0 }]);
  });

  it('enforce mode: staged without commit_sha and deploy_url is a 400 and changes nothing', async () => {
    await setMode('enforce');
    const res = await staged({ preview_url: 'https://p.example.test/2' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('receipt_required');
    expect((await task()).status).toBe('in_progress');
    expect((await staged({ preview_url: 'https://p.example.test/2', commit_sha: SHA1, deploy_url: 'https://x.example.test' })).status).toBe(200);
  });

  it('a re-stage via /staged after the yes voids it: fields, tag, receipt, internal comment, then a new approval email', async () => {
    await stage('https://p.example.test/3');
    await approve();
    expect((await task()).approved_commit_sha).toBe(SHA1);
    approvalMail.mockClear();

    const res = await stage('https://p.example.test/3b', SHA2);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ already_staged: false, approval_email: 'sent' });
    const t = await task();
    expect(t.client_approved_at).toBeNull();
    expect(t.approved_by_contact_id).toBeNull();
    expect(t.tags).not.toContain('client-approved');
    expect(t).toMatchObject({ approved_preview_url: null, approved_commit_sha: null, approved_deploy_id: null, status: 'review', staging_preview_url: 'https://p.example.test/3b', staging_commit_sha: SHA2 });
    expect(approvalMail).toHaveBeenCalledTimes(1);
    const [v] = await receipts('approval_voided');
    expect(v).toMatchObject({ commit_sha: SHA1, preview_url: 'https://p.example.test/3' });
    const note = await prisma.comment.findFirstOrThrow({ where: { task_id: a.taskId, content: { startsWith: 'Approval voided' } } });
    expect(note.is_internal).toBe(true);
    expect(note.client_visible).toBe(false);
    expect((await receipts()).map((r) => r.step)).toEqual(['staged', 'approved', 'approval_voided', 'staged']);
  });

  it('the same preview url and commit after a yes is a no-op: the yes stands, nothing sent', async () => {
    await stage('https://p.example.test/4');
    await approve();
    approvalMail.mockClear();
    const res = await stage('https://p.example.test/4');
    expect(res.status).toBe(200);
    expect((await res.json()).already_staged).toBe(true);
    expect(approvalMail).not.toHaveBeenCalled();
    expect((await task()).client_approved_at).not.toBeNull();
    expect(await receipts('approval_voided')).toHaveLength(0);
  });

  it('the same preview url with a different commit voids the yes', async () => {
    await stage('https://p.example.test/5', SHA1);
    await approve();
    await stage('https://p.example.test/5', SHA2);
    const t = await task();
    expect(t.client_approved_at).toBeNull();
    expect(t.staging_commit_sha).toBe(SHA2);
    expect(await receipts('approval_voided')).toHaveLength(1);
  });

  it('PATCH to a new preview url voids the yes; the same url keeps it', async () => {
    await stage('https://p.example.test/6');
    await approve();
    expect((await patch({ staging_preview_url: 'https://p.example.test/6' })).status).toBe(200);
    expect((await task()).client_approved_at).not.toBeNull();
    expect(await receipts('approval_voided')).toHaveLength(0);

    const res = await patch({ staging_preview_url: 'https://p.example.test/6b' });
    expect(res.status).toBe(200);
    const t = await task();
    expect(t.staging_preview_url).toBe('https://p.example.test/6b');
    expect(t.client_approved_at).toBeNull();
    expect(t.tags).not.toContain('client-approved');
    expect(t.approved_commit_sha).toBeNull();
    expect(await receipts('approval_voided')).toHaveLength(1);
  });

  it("mode off: PATCH keeps the approval and /staged is today's 409", async () => {
    await stage('https://p.example.test/7');
    await approve();
    await setMode('off');
    expect((await patch({ staging_preview_url: 'https://p.example.test/7b' })).status).toBe(200);
    expect((await task()).client_approved_at).not.toBeNull();
    expect((await stage('https://p.example.test/7c')).status).toBe(409);
    expect(await receipts('approval_voided')).toHaveLength(0);
  });

  it('a done task is never voided: /staged is a 409, PATCH keeps the yes, the helper refuses', async () => {
    await stage('https://p.example.test/8');
    await approve();
    await prisma.task.update({ where: { id: a.taskId }, data: { status: 'done', approved: true, completed_at: new Date() } });
    expect((await stage('https://p.example.test/8b', SHA2)).status).toBe(409);
    expect((await patch({ staging_preview_url: 'https://p.example.test/8c' })).status).toBe(200);
    expect(await voidApprovalIfRestaged(a.taskId, { previewUrl: 'https://p.example.test/8d', commitSha: SHA2 }, { actorUserId: BAST_USER_ID, mode: 'enforce' })).toEqual({ voided: false, unchanged: false });
    const t = await task();
    expect(t.client_approved_at).not.toBeNull();
    expect(t.tags).toContain('client-approved');
    expect(t.approved_commit_sha).toBe(SHA1);
    expect(await receipts('approval_voided')).toHaveLength(0);
  });

  it('a task that went live between the read and the void is not voided (the guarded update touches nothing)', async () => {
    await stage('https://p.example.test/9');
    await approve();
    // The helper reads a review task; the task then goes done before its transaction runs.
    const racing = new Proxy(prisma, {
      get(target, key) {
        if (key === 'task') {
          return new Proxy(target.task, {
            get(t, k) {
              if (k !== 'findUnique') return (t as never)[k];
              return async (args: never) => {
                const row = await t.findUnique(args);
                await t.update({ where: { id: a.taskId }, data: { status: 'done', approved: true } });
                return row;
              };
            },
          });
        }
        const v = (target as never)[key];
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    });
    await expect(voidApprovalIfRestaged(a.taskId, { previewUrl: 'https://p.example.test/9b' }, { actorUserId: BAST_USER_ID, mode: 'warn' }, racing as never)).rejects.toMatchObject({ statusCode: 409 });
    expect((await task()).client_approved_at).not.toBeNull();
    expect(await receipts('approval_voided')).toHaveLength(0);
  });

  it('the portal yes stamps approved_* and an approved receipt with source portal', async () => {
    await stage('https://p.example.test/10');
    await approve();
    expect(await task()).toMatchObject({ approved_preview_url: 'https://p.example.test/10', approved_commit_sha: SHA1, approved_deploy_id: 'dep-1' });
    const [r] = await receipts('approved');
    expect(r).toMatchObject({ approval_source: 'portal', commit_sha: SHA1 });
  });

  it('an emailed yes through PATCH stamps approved_* with the email source', async () => {
    await stage('https://p.example.test/11');
    const res = await patch({ tags: ['client-approved'], client_approved_at: new Date().toISOString(), approval_source: 'email:<CAF123@mail.example.test>' });
    expect(res.status).toBe(200);
    expect(await task()).toMatchObject({ approved_preview_url: 'https://p.example.test/11', approved_commit_sha: SHA1 });
    const approved = await receipts('approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].approval_source).toBe('email:<CAF123@mail.example.test>');
  });

  it('an emailed yes is voided by a re-stage too', async () => {
    await stage('https://p.example.test/12');
    await patch({ tags: ['client-approved'], client_approved_at: new Date().toISOString(), approval_source: 'email:<m1@x.test>' });
    await stage('https://p.example.test/12b', SHA2);
    const t = await task();
    expect(t.client_approved_at).toBeNull();
    expect(t.tags).not.toContain('client-approved');
  });

  it('live with the approved commit passes and writes a live receipt', async () => {
    await stage('https://p.example.test/13');
    await approve();
    const res = await live({ live_url: 'https://site.example.test/', commit_sha: SHA1, deploy_id: 'prod-9', checks: [{ name: 'live', ok: true }], live_check: { status: 200, contains: 'new intro' } });
    expect(res.status).toBe(200);
    const [r] = await receipts('live');
    expect(r).toMatchObject({ commit_sha: SHA1, deploy_id: 'prod-9', live_url: 'https://site.example.test/', mismatch: false });
    expect(r.live_check).toMatchObject({ status: 200 });
    expect((await task()).status).toBe('done');
  });

  it('warn mode: a different live commit goes live, with the mismatch on the receipt and an internal comment', async () => {
    await stage('https://p.example.test/14');
    await approve();
    const res = await live({ live_url: 'https://site.example.test/', commit_sha: SHA2 });
    expect(res.status).toBe(200);
    expect((await task()).status).toBe('done');
    const [r] = await receipts('live');
    expect(r.mismatch).toBe(true);
    const note = await prisma.comment.findFirstOrThrow({ where: { task_id: a.taskId, content: { startsWith: 'Build check' } } });
    expect(note.is_internal).toBe(true);
  });

  it('warn mode: no commit reported for an approved build counts as a mismatch too', async () => {
    await stage('https://p.example.test/15');
    await approve();
    await live({ live_url: 'https://site.example.test/' });
    expect((await receipts('live'))[0].mismatch).toBe(true);
  });

  it('enforce mode: a different live commit is a 409 build_not_approved and nothing changes', async () => {
    await stage('https://p.example.test/16');
    await approve();
    await setMode('enforce');
    const res = await live({ live_url: 'https://site.example.test/', commit_sha: SHA2 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('build_not_approved');
    expect((await task()).status).toBe('review');
    expect(await receipts('live')).toHaveLength(0);
  });

  it('enforce mode: force without a reason is refused, a non-admin cannot force, an admin with a reason can', async () => {
    await stage('https://p.example.test/17');
    await approve();
    await setMode('enforce');
    const noReason = await live({ live_url: 'https://site.example.test/', commit_sha: SHA2, force: true });
    expect(noReason.status).toBe(400);
    expect((await noReason.json()).code).toBe('force_reason_required');
    authMock.mockResolvedValue({ userId: BAST_USER_ID, role: 'pm', email: 'bast@test' });
    expect((await live({ live_url: 'https://site.example.test/', commit_sha: SHA2, force: true, force_reason: 'Hotfix agreed with the client' })).status).toBe(403);
    expect((await task()).status).toBe('review');
    authMock.mockResolvedValue({ userId: BAST_USER_ID, role: 'admin', email: 'bast@test', via: 'session' });
    const ok = await live({ live_url: 'https://site.example.test/', commit_sha: SHA2, force: true, force_reason: 'Hotfix agreed with the client' });
    expect(ok.status).toBe(200);
    const [r] = await receipts('live');
    expect(r.mismatch).toBe(true);
    expect(r.live_check).toMatchObject({ forced: true, force_reason: 'Hotfix agreed with the client' });
  });

  it('enforce mode: the approved commit going live passes', async () => {
    await stage('https://p.example.test/18');
    await approve();
    await setMode('enforce');
    expect((await live({ live_url: 'https://site.example.test/', commit_sha: SHA1 })).status).toBe(200);
  });

  it('mode off: live never compares builds', async () => {
    await stage('https://p.example.test/19');
    await approve();
    await setMode('off');
    expect((await live({ live_url: 'https://site.example.test/', commit_sha: SHA2 })).status).toBe(200);
    expect((await receipts('live'))[0].mismatch).toBe(false);
  });

  it('PATCH carrying a tag list with client-approved plus a new preview url leaves the task not approved', async () => {
    await stage('https://p.example.test/21');
    await approve();
    const res = await patch({ staging_preview_url: 'https://p.example.test/21b', tags: ['client-approved', 'cp:abc', 'preview-notified:x', 'keep-me'] });
    expect(res.status).toBe(200);
    const t = await task();
    expect(t.client_approved_at).toBeNull();
    expect(t.tags).toEqual(['keep-me']);
  });

  it('same url after a yes: a missing incoming commit, a missing approved commit, or different commits all void; the same commit is a no-op', async () => {
    // incoming commit missing
    await stage('https://p.example.test/22', SHA1);
    await approve();
    await stage('https://p.example.test/22', null);
    expect((await task()).client_approved_at).toBeNull();
    // approved commit missing
    await prisma.task.update({ where: { id: a.taskId }, data: { client_approved_at: new Date(), tags: ['client-approved'], approved_commit_sha: null, approved_preview_url: 'https://p.example.test/22' } });
    await stage('https://p.example.test/22', SHA1);
    expect((await task()).client_approved_at).toBeNull();
    // different commits
    await prisma.task.update({ where: { id: a.taskId }, data: { client_approved_at: new Date(), tags: ['client-approved'], approved_commit_sha: SHA1, approved_preview_url: 'https://p.example.test/22' } });
    await stage('https://p.example.test/22', SHA2);
    expect((await task()).client_approved_at).toBeNull();
    // same commit, both present: no-op
    await prisma.task.update({ where: { id: a.taskId }, data: { client_approved_at: new Date(), tags: ['client-approved'], approved_commit_sha: SHA2, approved_preview_url: 'https://p.example.test/22' } });
    const res = await stage('https://p.example.test/22', SHA2.toUpperCase());
    expect((await res.json()).already_staged).toBe(true);
    expect((await task()).client_approved_at).not.toBeNull();
  });

  it('a PATCH of the preview url then a stage call records the commit and deploy; a new commit on an unapproved review task is recorded', async () => {
    await patch({ staging_preview_url: 'https://p.example.test/23' });
    const first = await stage('https://p.example.test/23', SHA1);
    expect((await first.json()).already_staged).toBe(false);
    expect((await task()).staging_commit_sha).toBe(SHA1);
    const again = await stage('https://p.example.test/23', SHA2);
    expect((await again.json()).already_staged).toBe(false);
    expect((await task()).staging_commit_sha).toBe(SHA2);
    expect((await (await stage('https://p.example.test/23', SHA2)).json()).already_staged).toBe(true);
  });

  it('enforce: an approval with no recorded build is refused; only an admin on a browser session can force it, with a reason', async () => {
    await stage('https://p.example.test/24');
    await approve();
    await prisma.task.update({ where: { id: a.taskId }, data: { approved_commit_sha: null } });
    await setMode('enforce');
    const refused = await live({ live_url: 'https://site.example.test/', commit_sha: SHA1 });
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('build_not_approved');
    authMock.mockResolvedValue({ userId: BAST_USER_ID, role: 'admin', email: 'bast@test', via: 'api_key' });
    expect((await live({ live_url: 'https://site.example.test/', commit_sha: SHA1, force: true, force_reason: 'Approved by phone' })).status).toBe(403);
    authMock.mockResolvedValue({ userId: BAST_USER_ID, role: 'admin', email: 'bast@test', via: 'session' });
    expect((await live({ live_url: 'https://site.example.test/', commit_sha: SHA1, force: true, force_reason: 'Approved by phone' })).status).toBe(200);
    expect((await receipts('live'))[0].mismatch).toBe(true);
  });

  it('warn: an approval with no recorded build goes live without a mismatch', async () => {
    await stage('https://p.example.test/25');
    await approve();
    await prisma.task.update({ where: { id: a.taskId }, data: { approved_commit_sha: null } });
    expect((await live({ live_url: 'https://site.example.test/', commit_sha: SHA1 })).status).toBe(200);
    expect((await receipts('live'))[0].mismatch).toBe(false);
  });

  it('commit compare ignores case and accepts a short sha as a prefix', () => {
    expect(sameSha(SHA1.toUpperCase(), SHA1)).toBe(true);
    expect(sameSha(SHA1.slice(0, 8), SHA1)).toBe(true);
    expect(sameSha(SHA2.slice(0, 8), SHA1)).toBe(false);
    expect(sameSha('abc', 'abcdef0')).toBe(false);
  });

  it('the yes is recorded only for the preview the client saw: if it changed, nothing is approved and the new address comes back', async () => {
    await stage('https://p.example.test/26a');
    await stage('https://p.example.test/26b', SHA2); // restaged while the client looked at 26a
    const r = await recordTaskClientApproval({ id: a.taskId, client_approved_at: null, site: { auto_deploy: false } }, a.ownerId, 'approval_link', 'https://p.example.test/26a');
    expect(r).toMatchObject({ preview_changed: true, already_approved: false, staging_preview_url: 'https://p.example.test/26b' });
    const t = await task();
    expect(t.client_approved_at).toBeNull();
    expect(t.tags).not.toContain('client-approved');
    expect(await receipts('approved')).toHaveLength(0);
    const ok = await recordTaskClientApproval({ id: a.taskId, client_approved_at: null, site: { auto_deploy: false } }, a.ownerId, 'approval_link', 'https://p.example.test/26b');
    expect(ok.preview_changed).toBeUndefined();
    expect(await task()).toMatchObject({ approved_preview_url: 'https://p.example.test/26b', approved_commit_sha: SHA2 });
    expect((await receipts('approved'))[0].approval_source).toBe('approval_link');
  });

  it('GET receipts returns the trail for staff', async () => {
    await stage('https://p.example.test/20');
    await approve();
    const res = await receiptsGET(req('receipts', null, 'GET'), params(a.taskId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipts.map((r: { step: string }) => r.step)).toEqual(['staged', 'approved']);
    expect(body.approved.commit_sha).toBe(SHA1);
  });
});
