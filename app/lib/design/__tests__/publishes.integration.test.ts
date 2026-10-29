/**
 * The publish lifecycle against the scratch database: intent -> confirm -> worker running -> published (the
 * publish-complete transaction), rollback, and the failure paths. Asserts exactly one comment, zero or one
 * live receipt with the right approval_source, one FYI notification with the right priority, the session back
 * to awaiting_input, and Task.staging_* / approved_* untouched.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@/lib/services/email-notifications', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(true) }));

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sendNotificationEmail } from '@/lib/services/email-notifications';
import { applyWorkerPublishPatch, confirmPublish, createPublishIntent, createRollback } from '../publishes';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';

const sha = () => crypto.randomBytes(20).toString('hex');

describe.skipIf(!SCRATCH)('publish lifecycle (real database)', () => {
  let f: DesignFixture;
  let workerId: string;
  let saved: { settings: Record<string, unknown>; roles: unknown; urls: unknown };

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    f = await seedDesign(`pub${Date.now()}`);
    const w = await prisma.user.create({ data: { email: `dp-${f.tag}-w@example.test`, password_hash: 'x', name: `worker ${f.tag}`, role: 'tech' } });
    workerId = w.id;
    const s = await prisma.designPortalSettings.findUniqueOrThrow({ where: { id: 1 } });
    const ws = await prisma.designWorkerState.findUniqueOrThrow({ where: { id: 1 } });
    saved = {
      settings: { owner_user_id: s.owner_user_id, designer_publish_mode: s.designer_publish_mode, confirmation_ttl_minutes: s.confirmation_ttl_minutes },
      roles: ws.site_main_roles,
      urls: ws.site_live_urls,
    };
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { owner_user_id: f.admin.userId, designer_publish_mode: 'per_site', confirmation_ttl_minutes: 10 } });
  });

  afterAll(async () => {
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: saved.settings });
    await prisma.designWorkerState.update({
      where: { id: 1 },
      data: { site_main_roles: (saved.roles ?? Prisma.DbNull) as Prisma.InputJsonValue, site_live_urls: (saved.urls ?? Prisma.DbNull) as Prisma.InputJsonValue },
    });
    await teardownDesign(f);
    await prisma.user.deleteMany({ where: { id: workerId } });
    await prisma.$disconnect();
  });

  async function setRole(role: 'production' | 'client_preview', liveUrl: string) {
    const ws = await prisma.designWorkerState.findUniqueOrThrow({ where: { id: 1 } });
    const roles = { ...((ws.site_main_roles as Record<string, unknown>) ?? {}), [f.siteId]: role };
    const urls = { ...((ws.site_live_urls as Record<string, unknown>) ?? {}), [f.siteId]: liveUrl };
    await prisma.designWorkerState.update({ where: { id: 1 }, data: { site_main_roles: roles as Prisma.InputJsonValue, site_live_urls: urls as Prisma.InputJsonValue } });
  }

  /** A task with staging/approval fields set (they must survive), and an idle session with a green head. */
  async function idleSession() {
    const taskId = await seedTask(f, 'publish');
    await prisma.task.update({
      where: { id: taskId },
      data: {
        staging_preview_url: 'https://review-x.example.pages.dev', staging_commit_sha: 'f'.repeat(40), staging_deploy_id: 'stg1',
        staging_deploy_url: 'https://hash.example.pages.dev', staging_deployed_at: new Date('2026-10-01T00:00:00Z'),
        approved_preview_url: 'https://review-x.example.pages.dev', approved_commit_sha: 'f'.repeat(40), approved_deploy_id: 'stg1',
      },
    });
    const head = sha();
    const session = await prisma.designSession.create({
      data: {
        task_id: taskId, site_id: f.siteId, project_id: f.projectId, designer_id: f.designer.userId, status: 'awaiting_input',
        branch: `design/${taskId.slice(0, 8)}`, preview_alias: `design-${taskId.slice(0, 8)}`, model: 'opus', budget_usd: 25, cost_usd: 2.5,
        base_sha: sha(), head_sha: head,
        publish_precheck: { head_sha: head, gates_ok: true, gates: [{ name: 'library_lint', ok: true }], files_changed: ['src/index.njk'], pages_affected: ['/'] },
      },
    });
    return { taskId, sessionId: session.id, head };
  }

  const stagingOf = (taskId: string) =>
    prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        staging_preview_url: true, staging_commit_sha: true, staging_deploy_id: true, staging_deploy_url: true, staging_deployed_at: true,
        approved_preview_url: true, approved_commit_sha: true, approved_deploy_id: true, status: true, client_approved_at: true,
      },
    });

  async function publishThrough(actor: typeof f.designer, sessionId: string, head: string) {
    const intent = await createPublishIntent(actor, sessionId, head);
    await confirmPublish(actor, intent.publish_id, { confirmation_token: intent.confirmation_token, typed_confirmation: 'main' });
    return intent.publish_id;
  }

  const result = (from: string, to: string) => ({
    from_main_sha: from, result_sha: to, deploy_id: 'dep-1', deploy_url: 'https://abc123.example.pages.dev', alias_url: 'https://www.example.test',
    gates: [{ name: 'library_lint', ok: true }, { name: 'a11y', ok: true }, { name: 'balance_check', ok: true }],
  });

  it('production: the published transaction writes one comment, one live receipt, one high FYI; rollback marks the target', async () => {
    await setRole('production', 'https://www.example.test');
    const { taskId, sessionId, head } = await idleSession();
    const before = await stagingOf(taskId);

    const publishId = await publishThrough(f.designer, sessionId, head);
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('publishing');
    const cmd = await prisma.designCommand.findFirstOrThrow({ where: { session_id: sessionId, verb: 'publish' } });
    expect(cmd.payload).toMatchObject({ publish_id: publishId, head_sha: head, main_role: 'production', live_url: 'https://www.example.test' });

    // The worker cannot skip running.
    await expect(applyWorkerPublishPatch(publishId, { status: 'published', ...result(sha(), sha()) }, { workerUserId: workerId })).rejects.toMatchObject({ statusCode: 409 });

    await applyWorkerPublishPatch(publishId, { status: 'running' }, { workerUserId: workerId });
    const from = sha();
    const to = sha();
    const done = await applyWorkerPublishPatch(publishId, { status: 'published', ...result(from, to) }, { workerUserId: workerId });
    expect(done.status).toBe('published');
    expect(done.result_sha).toBe(to);
    expect(done.notified_at).toBeInstanceOf(Date);

    const comments = await prisma.comment.findMany({ where: { task_id: taskId } });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ user_id: workerId, is_internal: true, actor_lane: 'design-worker', client_visible: false });
    expect(comments[0].content).toContain('the LIVE production site at www.example.test');
    expect(comments[0].content).toContain(to.slice(0, 12));
    expect(comments[0].content).toContain('Gates: library_lint ok, a11y ok, balance_check ok');

    const receipts = await prisma.taskReceipt.findMany({ where: { task_id: taskId } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ step: 'live', approval_source: `design_publish:${publishId}`, commit_sha: to, deploy_url: 'https://abc123.example.pages.dev', live_url: 'https://www.example.test', actor_user_id: f.designer.userId });

    const notes = await prisma.notification.findMany({ where: { entity_id: publishId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: f.admin.userId, type: 'design_published', priority: 'high', entity_type: 'design_publish' });
    // high priority = immediate email through the dispatcher (mocked here: nothing leaves the box)
    expect(vi.mocked(sendNotificationEmail)).toHaveBeenCalledWith(f.admin.userId, 'design_published', expect.any(String), expect.any(String), 'design_publish', publishId);

    const session = await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe('awaiting_input');
    expect(session.base_sha).toBe(to);
    expect(session.last_publish_id).toBe(publishId);
    expect(await stagingOf(taskId)).toEqual(before);

    // A retried PATCH writes nothing twice.
    await applyWorkerPublishPatch(publishId, { status: 'published', ...result(from, to) }, { workerUserId: workerId });
    expect(await prisma.comment.count({ where: { task_id: taskId } })).toBe(1);
    expect(await prisma.taskReceipt.count({ where: { task_id: taskId } })).toBe(1);
    expect(await prisma.notification.count({ where: { entity_id: publishId } })).toBe(1);

    // Rollback, one click by the publisher.
    const { publish_id: rbId } = await createRollback(f.designer, publishId, 'client asked');
    const rb = await prisma.designPublish.findUniqueOrThrow({ where: { id: rbId } });
    expect(rb).toMatchObject({ kind: 'rollback', status: 'queued', rolls_back_id: publishId, from_main_sha: to });
    expect(rb.confirmed_at).toBeInstanceOf(Date);
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('publishing');
    await applyWorkerPublishPatch(rbId, { status: 'running' }, { workerUserId: workerId });
    const rbSha = sha();
    await applyWorkerPublishPatch(rbId, { status: 'published', ...result(to, rbSha) }, { workerUserId: workerId });

    const target = await prisma.designPublish.findUniqueOrThrow({ where: { id: publishId } });
    expect(target.status).toBe('rolled_back');
    expect(target.rolled_back_by_id).toBe(f.designer.userId);
    expect(target.rolled_back_at).toBeInstanceOf(Date);
    expect(await prisma.comment.count({ where: { task_id: taskId } })).toBe(2);
    const rbReceipts = await prisma.taskReceipt.findMany({ where: { task_id: taskId, approval_source: `design_rollback:${rbId}` } });
    expect(rbReceipts).toHaveLength(1);
    expect(rbReceipts[0].commit_sha).toBe(rbSha);
    // design_rolled_back goes to the owner and the publisher, never the person who clicked (the publisher here).
    const rbNotes = await prisma.notification.findMany({ where: { entity_id: rbId } });
    expect(rbNotes).toHaveLength(1);
    expect(rbNotes[0]).toMatchObject({ user_id: f.admin.userId, type: 'design_rolled_back', priority: 'high' });
    const after = await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.status).toBe('awaiting_input');
    expect(after.base_sha).toBe(to); // a rollback moves main, not the design branch
    expect(after.last_publish_id).toBe(rbId);
    expect(await stagingOf(taskId)).toEqual(before);

    // The rolled-back publish (and the rollback itself) cannot be rolled back again.
    await expect(createRollback(f.designer, publishId, null)).rejects.toMatchObject({ statusCode: 409 });
    await expect(createRollback(f.designer, rbId, null)).rejects.toMatchObject({ statusCode: 409, code: 'not_rollbackable' });
  });

  it('client_preview: zero receipts, one normal FYI to the owner, staging untouched', async () => {
    await setRole('client_preview', 'https://example.pages.dev');
    const { taskId, sessionId, head } = await idleSession();
    const before = await stagingOf(taskId);
    const publishId = await publishThrough(f.designer, sessionId, head);
    await applyWorkerPublishPatch(publishId, { status: 'running' }, { workerUserId: workerId });
    await applyWorkerPublishPatch(publishId, { status: 'published', ...result(sha(), sha()) }, { workerUserId: workerId });

    expect(await prisma.comment.count({ where: { task_id: taskId } })).toBe(1);
    expect(await prisma.taskReceipt.count({ where: { task_id: taskId } })).toBe(0);
    const notes = await prisma.notification.findMany({ where: { entity_id: publishId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: f.admin.userId, type: 'design_published', priority: 'normal' });
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('awaiting_input');
    expect(await stagingOf(taskId)).toEqual(before);
  });

  it('an admin publish on production: receipt source design_admin_publish; the owner who clicked is not notified', async () => {
    await setRole('production', 'https://www.example.test');
    const { taskId, sessionId, head } = await idleSession();
    const publishId = await publishThrough(f.admin, sessionId, head);
    await applyWorkerPublishPatch(publishId, { status: 'running' }, { workerUserId: workerId });
    await applyWorkerPublishPatch(publishId, { status: 'published', ...result(sha(), sha()) }, { workerUserId: workerId });
    const receipts = await prisma.taskReceipt.findMany({ where: { task_id: taskId } });
    expect(receipts.map((r) => r.approval_source)).toEqual([`design_admin_publish:${publishId}`]);
    expect(await prisma.notification.count({ where: { entity_id: publishId } })).toBe(0);
  });

  it('failed and blocked_gates: session back to awaiting_input with a system publish event; nothing else written', async () => {
    await setRole('production', 'https://www.example.test');
    const { taskId, sessionId, head } = await idleSession();
    const publishId = await publishThrough(f.designer, sessionId, head);
    await applyWorkerPublishPatch(publishId, { status: 'running' }, { workerUserId: workerId });
    const row = await applyWorkerPublishPatch(publishId, { status: 'blocked_gates', error: 'a11y: 3 contrast errors', gates: [{ name: 'a11y', ok: false }] }, { workerUserId: workerId });
    expect(row.status).toBe('blocked_gates');
    expect(row.finished_at).toBeInstanceOf(Date);
    const s = await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.status).toBe('awaiting_input');
    const ev = await prisma.designEvent.findFirstOrThrow({ where: { session_id: sessionId, kind: 'publish' } });
    expect(ev.role).toBe('system');
    expect(ev.seq).toBe(s.last_seq);
    expect(ev.payload).toMatchObject({ publish_id: publishId, status: 'blocked_gates', error: 'a11y: 3 contrast errors' });
    expect(await prisma.comment.count({ where: { task_id: taskId } })).toBe(0);
    expect(await prisma.taskReceipt.count({ where: { task_id: taskId } })).toBe(0);
    expect(await prisma.notification.count({ where: { entity_id: publishId } })).toBe(0);
    // Final: no move out of blocked_gates; a repeat of the same status is a no-op.
    await expect(applyWorkerPublishPatch(publishId, { status: 'published', ...result(sha(), sha()) })).rejects.toMatchObject({ statusCode: 409 });
    await applyWorkerPublishPatch(publishId, { status: 'blocked_gates', error: 'again' });
    expect(await prisma.designEvent.count({ where: { session_id: sessionId, kind: 'publish' } })).toBe(1);

    // A preflight failure straight from queued.
    const second = await publishThrough(f.designer, sessionId, head);
    await applyWorkerPublishPatch(second, { status: 'failed', error: 'repo dirty' });
    expect((await prisma.designPublish.findUniqueOrThrow({ where: { id: second } })).status).toBe('failed');
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('awaiting_input');
  });

  it('the worker cannot move a publish out of awaiting_confirmation, and the partial index holds one live publish per site', async () => {
    await setRole('production', 'https://www.example.test');
    const { sessionId, head } = await idleSession();
    const intent = await createPublishIntent(f.designer, sessionId, head);
    for (const status of ['running', 'published', 'failed'] as const) {
      await expect(applyWorkerPublishPatch(intent.publish_id, { status })).rejects.toMatchObject({ statusCode: 409 });
    }
    expect((await prisma.designPublish.findUniqueOrThrow({ where: { id: intent.publish_id } })).status).toBe('awaiting_confirmation');

    // Another session on the same site already has a queued publish: confirm refuses.
    const other = await idleSession();
    const queued = await publishThrough(f.designer, other.sessionId, other.head);
    await expect(confirmPublish(f.designer, intent.publish_id, { confirmation_token: intent.confirmation_token, typed_confirmation: 'main' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'publish_in_progress' });
    expect((await prisma.designSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('awaiting_input');
    await applyWorkerPublishPatch(queued, { status: 'failed', error: 'test clean-up' });
  });
});
