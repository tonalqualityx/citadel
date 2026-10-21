import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { claimNotice, queuePortalNotices, cancelStaleNotices } from '../notices';

// Portal phase B slice 2: the notice races, against a real Postgres. Skips unless DATABASE_URL is set
// and names a scratch database (it writes rows), so it never runs against a database that matters.
const URL = process.env.DATABASE_URL ?? '';
const SCRATCH = /scratch/i.test(URL);

describe.skipIf(!SCRATCH)('portal notice races (real database)', () => {
  const tag = `race-${Date.now()}`;
  let userId = '';
  let clientId = '';
  let contactId = '';
  let taskId = '';
  const commentIds: string[] = [];

  const task = () => ({ id: taskId, client_title: 'Site change: hours', client_id: clientId, requested_by_contact_id: contactId });

  async function share(text: string) {
    const c = await prisma.comment.create({ data: { task_id: taskId, user_id: userId, content: text, client_visible: true, is_internal: false } });
    commentIds.push(c.id);
    return c;
  }
  const notices = () => prisma.portalNotice.findMany({ where: { task_id: taskId }, orderBy: { created_at: 'asc' } });

  beforeAll(async () => {
    userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
    const client = await prisma.client.create({ data: { name: `Race client ${tag}`, type: 'direct', status: 'active' } });
    clientId = client.id;
    const contact = await prisma.clientContact.create({
      data: { client_id: clientId, name: 'Dana Race', email: `dana-${tag}@example.test`, portal_role: 'member', can_initiate_work: true },
    });
    contactId = contact.id;
  });

  async function freshTask() {
    const t = await prisma.task.create({ data: { title: `Race task ${tag} ${Math.random()}`, client_id: clientId, requested_by_contact_id: contactId, status: 'not_started' } });
    taskId = t.id;
  }

  afterAll(async () => {
    await prisma.portalNotice.deleteMany({ where: { contact_id: contactId } });
    await prisma.comment.deleteMany({ where: { task: { client_id: clientId } } });
    await prisma.task.deleteMany({ where: { client_id: clientId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  it('hidden after the list: the claim cancels the notice and says so', async () => {
    await freshTask();
    const c = await share('First reply');
    await queuePortalNotices(task(), c);
    const [listed] = await notices();
    expect(listed.status).toBe('queued');
    // Staff hide the reply after the sender listed the notice.
    await prisma.comment.update({ where: { id: c.id }, data: { client_visible: false } });
    const claim = await claimNotice(listed.id);
    expect(claim).toEqual({ ok: false, reason: 'withdrawn' });
    const [after] = await notices();
    expect(after.status).toBe('cancelled');
    expect(after.sent_at).toBeNull();
  });

  it('folded after the list: the claim returns the newer body and the sender must send that', async () => {
    await freshTask();
    const c1 = await share('First reply');
    await queuePortalNotices(task(), c1);
    const [listed] = await notices(); // the copy the sender read
    const c2 = await share('Second reply, added after the list');
    expect((await queuePortalNotices(task(), c2)).absorbed).toBe(1);
    const claim = await claimNotice(listed.id);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(listed.body).not.toContain('Second reply');
    expect(claim.notice.body).toContain('First reply');
    expect(claim.notice.body).toContain('Second reply, added after the list');
    expect(claim.notice.to_email).toBe(`dana-${tag}@example.test`);
    expect((await notices())).toHaveLength(1);
  });

  it('folded after the claim: the reply gets its own notice and the claimed one is untouched', async () => {
    await freshTask();
    const c1 = await share('First reply');
    await queuePortalNotices(task(), c1);
    const [n1] = await notices();
    const claim = await claimNotice(n1.id);
    expect(claim.ok).toBe(true);
    const c2 = await share('Arrived while the first email was going out');
    const r = await queuePortalNotices(task(), c2);
    expect(r).toEqual({ queued: 1, absorbed: 0 });
    const all = await notices();
    expect(all).toHaveLength(2);
    const claimed = all.find((n) => n.id === n1.id)!;
    expect(claimed.status).toBe('sending');
    expect(claimed.comment_ids).toEqual([c1.id]);
    expect(claimed.body).not.toContain('Arrived while');
    const fresh = all.find((n) => n.id !== n1.id)!;
    expect(fresh.status).toBe('queued');
    expect(fresh.comment_ids).toEqual([c2.id]);
  });

  it('a claim is single-use: the second claimant gets not_queued', async () => {
    await freshTask();
    await queuePortalNotices(task(), await share('Only reply'));
    const [n] = await notices();
    const [a, b] = await Promise.all([claimNotice(n.id), claimNotice(n.id)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, reason: 'not_queued' });
  });

  it('a claim racing a new reply never loses it: the reply is in exactly one notice, and in the claimed body only if the notice carries it', async () => {
    for (let i = 0; i < 5; i++) {
      await freshTask();
      await queuePortalNotices(task(), await share('First reply'));
      const [n1] = await notices();
      const c2 = await share(`Racing reply ${i}`);
      const [claim] = await Promise.all([claimNotice(n1.id), queuePortalNotices(task(), c2)]);
      expect(claim.ok).toBe(true);
      if (!claim.ok) continue;
      const all = await notices();
      const carrying = all.filter((n) => n.comment_ids.includes(c2.id));
      expect(carrying).toHaveLength(1);
      const sentBody = claim.notice.body;
      const first = all.find((n) => n.id === n1.id)!;
      expect(sentBody.includes(`Racing reply ${i}`)).toBe(first.comment_ids.includes(c2.id));
    }
  });

  it('a recipient who lost access before the claim is skipped and the notice is marked', async () => {
    await freshTask();
    await queuePortalNotices(task(), await share('Reply for a contact who is then removed'));
    const [n] = await notices();
    await prisma.clientContact.update({ where: { id: contactId }, data: { is_deleted: true } });
    try {
      const claim = await claimNotice(n.id);
      expect(claim).toEqual({ ok: false, reason: 'no_access' });
      const [after] = await notices();
      expect(after.status).toBe('cancelled');
      expect(after.send_error).toMatch(/no longer has access/);
    } finally {
      await prisma.clientContact.update({ where: { id: contactId }, data: { is_deleted: false } });
    }
  });

  it('the list pass cancels and refreshes the same way', async () => {
    await freshTask();
    const c = await share('Will be hidden');
    await queuePortalNotices(task(), c);
    await prisma.comment.update({ where: { id: c.id }, data: { client_visible: false } });
    expect(await cancelStaleNotices()).toBeGreaterThanOrEqual(1);
    expect((await notices())[0].status).toBe('cancelled');
  });
});
