import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { addTaskTagQuery, recordTaskClientApproval, recordTaskClientRequestChanges, removeTaskTagQuery, SEND_BACK_TAG } from '../portal';

// Task tags are changed by single UPDATE statements, so a tag another writer adds at the same moment
// is never dropped. Real Postgres; skips unless DATABASE_URL names a scratch database.
const SCRATCH = /scratch/i.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('task tag updates are atomic (real database)', () => {
  const tag = `tags-${Date.now()}`;
  let clientId = '';
  let contactId = '';
  const tagsOf = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id }, select: { tags: true } })).tags;
  const newTask = (tags: string[]) => prisma.task.create({ data: { title: `Tags task ${tag}`, client_id: clientId, status: 'review', tags } });

  beforeAll(async () => {
    await prisma.user.findFirstOrThrow({ where: { email: 'bast@becomeindelible.com' } });
    clientId = (await prisma.client.create({ data: { name: `Tags client ${tag}`, type: 'direct', status: 'active' } })).id;
    contactId = (await prisma.clientContact.create({ data: { client_id: clientId, name: 'Dana', email: `d-${tag}@example.test`, portal_role: 'member' } })).id;
  });

  afterAll(async () => {
    await prisma.comment.deleteMany({ where: { task: { client_id: clientId } } });
    await prisma.task.deleteMany({ where: { client_id: clientId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  it('adding is idempotent and keeps order and other tags', async () => {
    const t = await newTask(['portal-chat']);
    await addTaskTagQuery(t.id, SEND_BACK_TAG);
    await addTaskTagQuery(t.id, SEND_BACK_TAG);
    expect(await tagsOf(t.id)).toEqual(['portal-chat', SEND_BACK_TAG]);
    await removeTaskTagQuery(t.id, SEND_BACK_TAG);
    expect(await tagsOf(t.id)).toEqual(['portal-chat']);
  });

  it('a send-back racing another writer\'s tag add keeps both tags', async () => {
    for (let i = 0; i < 8; i++) {
      const t = await newTask(['portal-chat']);
      await Promise.all([
        recordTaskClientRequestChanges({ id: t.id, client_approved_at: null }, `note ${i}`, 'Dana', contactId),
        addTaskTagQuery(t.id, 'needs-mike'),
      ]);
      const tags = await tagsOf(t.id);
      expect(tags).toEqual(expect.arrayContaining(['portal-chat', SEND_BACK_TAG, 'needs-mike']));
    }
  });

  it('approval clears the send-back tag and still keeps a tag added at the same moment', async () => {
    for (let i = 0; i < 8; i++) {
      const t = await newTask(['portal-chat', SEND_BACK_TAG]);
      await Promise.all([
        recordTaskClientApproval({ id: t.id, client_approved_at: null, site: null }, contactId),
        addTaskTagQuery(t.id, 'needs-mike'),
      ]);
      const tags = await tagsOf(t.id);
      expect(tags).not.toContain(SEND_BACK_TAG);
      expect(tags).toEqual(expect.arrayContaining(['portal-chat', 'needs-mike']));
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).client_approved_at).not.toBeNull();
    }
  });
});
