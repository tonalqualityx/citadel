/**
 * Seed helpers for the engine and chat tests that run against a real scratch Postgres. Everything
 * is tagged and removed by `cleanup`; the tests skip unless DATABASE_URL names a scratch database.
 */
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';

export const SCRATCH = /scratch/i.test(process.env.DATABASE_URL ?? '');

export interface Seeded {
  tag: string;
  clientId: string;
  ownerId: string;
  viewerId: string;
  siteId: string;
  taskId: string;
  conversationId: string;
}

export async function seedClient(tag: string, opts: { ga4?: string; gsc?: string } = {}): Promise<Seeded> {
  const client = await prisma.client.create({ data: { name: `Chat ${tag} Co`, type: 'direct', status: 'active' } });
  const owner = await prisma.clientContact.create({
    data: { client_id: client.id, name: `Olive ${tag}`, email: `olive-${tag}@example.test`, portal_role: 'owner', can_initiate_work: true },
  });
  const viewer = await prisma.clientContact.create({
    data: { client_id: client.id, name: `Vera ${tag}`, email: `vera-${tag}@example.test`, portal_role: 'viewer', can_initiate_work: false },
  });
  const site = await prisma.site.create({
    data: {
      name: `${tag} site`,
      url: `https://${tag}.example.test`,
      client_id: client.id,
      portal_chat_enabled: true,
      ga4_property: opts.ga4 ?? null,
      gsc_property: opts.gsc ?? null,
    },
  });
  const task = await prisma.task.create({
    data: {
      title: `Request: ${tag}`,
      client_id: client.id,
      site_id: site.id,
      requested_by_contact_id: owner.id,
      status: 'not_started',
      tags: ['portal-chat', 'chat-clarifying'],
      client_visible: true,
    },
  });
  const convo = await prisma.chatConversation.create({
    data: {
      task_id: task.id,
      client_id: client.id,
      site_id: site.id,
      opened_by_contact_id: owner.id,
      email_token: crypto.randomBytes(9).toString('base64url').slice(0, 12),
    },
  });
  return { tag, clientId: client.id, ownerId: owner.id, viewerId: viewer.id, siteId: site.id, taskId: task.id, conversationId: convo.id };
}

export async function cleanup(seeds: Seeded[]): Promise<void> {
  const clientIds = seeds.map((s) => s.clientId);
  const convoIds = seeds.map((s) => s.conversationId);
  const jobs = await prisma.engineJob.findMany({ where: { OR: [{ client_id: { in: clientIds } }, { conversation_id: { in: convoIds } }] }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  await prisma.engineToolCall.deleteMany({ where: { job_id: { in: jobIds } } });
  await prisma.engineRun.deleteMany({ where: { job_id: { in: jobIds } } });
  await prisma.engineJob.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.portalAttachment.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.chatConversation.deleteMany({ where: { id: { in: convoIds } } });
  await prisma.comment.deleteMany({ where: { task: { client_id: { in: clientIds } } } });
  await prisma.task.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.sitePage.deleteMany({ where: { site: { client_id: { in: clientIds } } } });
  await prisma.clientInvoice.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.clientReport.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.site.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.clientContact.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
}

/** Any user row, or a throwaway one: comments by staff and assistants need an author. */
export async function anyUser(): Promise<{ id: string }> {
  const existing = await prisma.user.findFirst({ select: { id: true } });
  if (existing) return existing;
  return prisma.user.create({
    data: { email: 'chat-test-user@example.test', password_hash: 'not-a-real-hash', name: 'Chat Test', role: 'pm' },
    select: { id: true },
  });
}
