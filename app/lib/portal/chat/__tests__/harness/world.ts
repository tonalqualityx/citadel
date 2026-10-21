/**
 * Seeds one invented client for a harness scenario on the real scratch database, and removes
 * everything it made afterwards. Two clients are seeded so a scenario can prove client B's name
 * never reaches client A's reply.
 */
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';

export interface WorldSpec {
  sites: number;
  role: 'owner' | 'viewer';
  pages?: Array<{ title: string; path: string; sections?: Array<{ key: string; heading: string }> }>;
  invoices?: Array<{ doc: string; total: number; balance: number; status: string }>;
  analytics?: boolean;
  plan?: boolean;
}

export interface World {
  tag: string;
  clientId: string;
  contactId: string;
  ownerId: string;
  viewerId: string;
  email: string;
  sites: Array<{ id: string; domain: string }>;
  pageIds: Record<string, string>;
  otherClientId: string;
  otherName: string;
}

export async function seedWorld(spec: WorldSpec): Promise<World> {
  const tag = `h${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const client = await prisma.client.create({ data: { name: `Maple ${tag} Bakery`, type: 'direct', status: 'active' } });
  const owner = await prisma.clientContact.create({
    data: { client_id: client.id, name: `Dana ${tag}`, email: `dana-${tag}@example.test`, portal_role: 'owner', can_initiate_work: true },
  });
  const viewer = await prisma.clientContact.create({
    data: { client_id: client.id, name: `Vic ${tag}`, email: `vic-${tag}@example.test`, portal_role: 'viewer', can_initiate_work: false },
  });
  const sites: World['sites'] = [];
  for (let i = 0; i < spec.sites; i++) {
    const domain = `${tag}-${i}.example.test`;
    const s = await prisma.site.create({
      data: {
        name: `${tag} site ${i}`,
        url: `https://${domain}`,
        client_id: client.id,
        portal_chat_enabled: true,
        ga4_property: spec.analytics ? `properties/${1000 + i}` : null,
        gsc_property: spec.analytics ? `sc-domain:${domain}` : null,
      },
    });
    sites.push({ id: s.id, domain });
  }
  const pageIds: Record<string, string> = {};
  let depth = 0;
  for (const p of spec.pages ?? []) {
    const row = await prisma.sitePage.create({
      data: { site_id: sites[0].id, url: `https://${sites[0].domain}${p.path}`, path: p.path, title: p.title, sections: p.sections ?? [], depth: p.path === '/' ? 0 : 1 + (depth++ % 1), source: 'sitemap', last_seen_at: new Date() },
    });
    pageIds[p.title] = row.id;
  }
  for (const inv of spec.invoices ?? []) {
    await prisma.clientInvoice.create({
      data: { client_id: client.id, qbo_invoice_id: `inv-${tag}-${inv.doc}`, doc_number: inv.doc, txn_date: new Date('2026-09-30'), total: inv.total, balance: inv.balance, status: inv.status },
    });
  }
  const otherName = `Zenith ${tag} Rival Co`;
  const other = await prisma.client.create({ data: { name: otherName, type: 'direct', status: 'active' } });
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: { portal_chat_mode: 'on', portal_chat_daily_cap_usd: 30 },
    create: { id: 'singleton', portal_chat_mode: 'on' },
  });
  const who = spec.role === 'owner' ? owner : viewer;
  return { tag, clientId: client.id, contactId: who.id, ownerId: owner.id, viewerId: viewer.id, email: who.email!, sites, pageIds, otherClientId: other.id, otherName };
}

/** Remove every leftover harness world (a failed run leaves its rows behind). */
export async function cleanupStrays(): Promise<void> {
  const strays = await prisma.client.findMany({ where: { OR: [{ name: { startsWith: 'Maple h' } }, { name: { startsWith: 'Zenith h' } }] }, select: { id: true } });
  if (strays.length) await cleanupClients(strays.map((c) => c.id));
}

export async function cleanupWorld(w: World): Promise<void> {
  await cleanupClients([w.clientId, w.otherClientId]);
}

async function cleanupClients(clientIds: string[]): Promise<void> {
  const tasks = await prisma.task.findMany({ where: { client_id: { in: clientIds } }, select: { id: true } });
  const taskIds = tasks.map((t) => t.id);
  const jobs = await prisma.engineJob.findMany({ where: { client_id: { in: clientIds } }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  await prisma.engineToolCall.deleteMany({ where: { job_id: { in: jobIds } } });
  await prisma.engineRun.deleteMany({ where: { job_id: { in: jobIds } } });
  await prisma.engineJob.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.waitEvent.deleteMany({ where: { wait: { task_id: { in: taskIds } } } });
  await prisma.wait.deleteMany({ where: { task_id: { in: taskIds } } });
  await prisma.notification.deleteMany({ where: { entity_id: { in: taskIds } } });
  await prisma.portalAttachment.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.chatConversation.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.sitePage.deleteMany({ where: { site: { client_id: { in: clientIds } } } });
  await prisma.clientInvoice.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.clientReport.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.site.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.clientContact.deleteMany({ where: { client_id: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
}
