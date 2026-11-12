// @vitest-environment node
/** Adversarial review of the triage status: paths that step around patchTask. Expected to FAIL where there is a hole. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/services/email', () => ({
  sendTaskApprovalRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH, seedClient } from '@/lib/engine/__tests__/seed';
import { POST as postComment } from '@/app/api/tasks/[id]/comments/route';
import { MIKE_USER_ID, BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { patchTask } from '@/lib/services/task-patch';
import { POST as stagedPOST } from '@/app/api/tasks/[id]/staged/route';
import { POST as createTask } from '@/app/api/tasks/route';

const authMock = requireAuth as Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(!SCRATCH)('triage attack (real database)', () => {
  const tag = `atk${Date.now()}`;
  const ids: string[] = [];
  let techId: string;
  const bast = (): AuthPayload => ({ userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'kb', lane: 'citadel-worker', laneEnforced: true });

  beforeAll(async () => {
    for (const [id, name] of [[MIKE_USER_ID, 'Mike'], [BAST_USER_ID, 'Bast']] as const) {
      await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${name}-${tag}@example.test`, password_hash: 'x', name, role: 'admin' } });
    }
    techId = (await prisma.user.create({ data: { email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech', role: 'tech' } })).id;
  });
  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { user_id: techId } });
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('a worker key cannot move a triage task to review through POST /staged', async () => {
    const t = await prisma.task.create({ data: { title: `${tag} staged`, status: 'triage' } });
    ids.push(t.id);
    authMock.mockResolvedValue(bast());
    const res = await stagedPOST(
      new NextRequest(new URL('http://localhost/api/tasks/x/staged'), { method: 'POST', body: JSON.stringify({ preview_url: 'https://preview.example.test/a', commit_sha: 'a'.repeat(40), deploy_url: 'https://preview.example.test/a' }) } as never),
      params(t.id),
    );
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    console.log('staged status', res.status, '->', after.status);
    expect(after.status).toBe('triage');
  });

  it('assigning a triage task to a contractor does not notify the contractor with its title', async () => {
    const t = await prisma.task.create({ data: { title: `${tag} secret idea`, status: 'triage' } });
    ids.push(t.id);
    await patchTask({ actor: bast(), id: t.id, body: { assignee_id: techId } });
    const n = await prisma.notification.findMany({ where: { user_id: techId } });
    console.log('notifications to tech after PATCH assign:', n.map((x) => x.title));
    expect(n.filter((x) => x.title.includes('secret idea'))).toHaveLength(0);
  });

  it('a shared (client_visible) comment on a triage task queues no client email', async () => {
    const s = await seedClient(`${tag}c`);
    ids.push(s.taskId);
    await patchTask({ actor: bast(), id: s.taskId, body: { status: 'triage' } });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: s.taskId } })).status).toBe('triage');
    authMock.mockResolvedValue(bast());
    const res = await postComment(new NextRequest(new URL(`http://localhost/api/tasks/${s.taskId}/comments`), { method: 'POST', body: JSON.stringify({ content: 'We will start on the new homepage idea next week.', client_visible: true }) } as never), params(s.taskId));
    const out = await prisma.emailOutbox.findMany({ where: { task_id: s.taskId } });
    console.log('comment', res.status, 'outbox rows to client:', out.map((o) => `${o.to} ${o.kind} ${o.subject}`));
    expect(out).toHaveLength(0);
    // Same with a plain (non-chat) client request in triage.
    const plain = await prisma.task.create({ data: { title: `${tag} plain`, status: 'triage', client_id: s.clientId, requested_by_contact_id: s.ownerId, source: 'portal' } });
    ids.push(plain.id);
    const res2 = await postComment(new NextRequest(new URL(`http://localhost/api/tasks/${plain.id}/comments`), { method: 'POST', body: JSON.stringify({ content: 'Plain shared note.', client_visible: true }) } as never), params(plain.id));
    const out2 = await prisma.emailOutbox.findMany({ where: { task_id: plain.id } });
    console.log('plain comment', res2.status, 'outbox rows to client:', out2.map((o) => `${o.to} ${o.kind} ${o.subject}`));
    expect(out2).toHaveLength(0);
  });

  it('creating a task straight into triage for a contractor does not notify them', async () => {
    authMock.mockResolvedValue(bast());
    const res = await createTask(new NextRequest(new URL('http://localhost/api/tasks'), { method: 'POST', body: JSON.stringify({ title: `${tag} filed idea`, status: 'triage', assignee_id: techId }) } as never));
    const body = await res.json();
    if (body.id) ids.push(body.id);
    console.log('create', res.status, body.status ?? body.error);
    const n = await prisma.notification.findMany({ where: { user_id: techId, title: { contains: 'filed idea' } } });
    expect(n).toHaveLength(0);
  });
});
