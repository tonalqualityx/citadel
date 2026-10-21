import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { accessForJob, runRead, isReadKind, READ_KINDS } from '../reads';
import { cleanup, SCRATCH, seedClient, type Seeded } from './seed';

// Phase C slice C1: the citadel_read kinds return what the portal shows THIS contact, nothing more.
describe.skipIf(!SCRATCH)('engine reads (real database)', () => {
  const tag = `r${Date.now()}`;
  let a: Seeded;
  let b: Seeded;

  beforeAll(async () => {
    a = await seedClient(`${tag}a`);
    b = await seedClient(`${tag}b`);
    await prisma.clientInvoice.create({
      data: { client_id: a.clientId, qbo_invoice_id: `inv-${tag}`, doc_number: '1042', txn_date: new Date('2026-09-30'), total: 1500, balance: 750.5, status: 'open', pay_link: 'https://pay.example.test/x' },
    });
    await prisma.clientInvoice.create({
      data: { client_id: a.clientId, qbo_invoice_id: `invv-${tag}`, doc_number: '1043', txn_date: new Date('2026-09-01'), total: 10, balance: 0, status: 'void' },
    });
    await prisma.clientInvoice.create({
      data: { client_id: b.clientId, qbo_invoice_id: `invb-${tag}`, doc_number: '2001', txn_date: new Date('2026-09-02'), total: 99, balance: 99, status: 'open' },
    });
    await prisma.clientReport.create({
      data: { client_id: a.clientId, period: '2026-09', title: 'September report', url: `https://reports.example.test/${tag}-a`, published_at: new Date('2026-10-02') },
    });
    await prisma.clientReport.create({
      data: { client_id: a.clientId, period: '2026-10', title: 'Draft report', url: `https://reports.example.test/${tag}-draft`, published_at: null },
    });
    await prisma.clientReport.create({
      data: { client_id: a.clientId, period: '2026-08', title: 'Bad link', url: 'javascript:alert(1)', published_at: new Date('2026-09-02') },
    });
  });
  afterAll(async () => {
    await cleanup([a, b]);
    await prisma.$disconnect();
  });

  const job = (s: Seeded, contactId: string) => ({ client_id: s.clientId, contact_id: contactId });

  it('knows the eight read kinds', () => {
    expect(READ_KINDS).toHaveLength(9);
    expect(isReadKind('invoices')).toBe(true);
    expect(isReadKind('tasks')).toBe(false);
  });

  it('resolves access the way sign-in does, and refuses a contact of another client', async () => {
    const owner = await accessForJob(job(a, a.ownerId));
    expect(owner).toMatchObject({ clientId: a.clientId, role: 'owner' });
    const viewer = await accessForJob(job(a, a.viewerId));
    expect(viewer?.role).toBe('viewer');
    // A job that names client A with client B's contact finds no access.
    expect(await accessForJob({ client_id: a.clientId, contact_id: (await prisma.clientContact.findFirstOrThrow({ where: { client_id: b.clientId } })).id })).toBeNull();
    expect(await accessForJob({ client_id: null, contact_id: a.ownerId })).toBeNull();
  });

  it('a deleted contact has no access', async () => {
    const gone = await prisma.clientContact.create({
      data: { client_id: a.clientId, name: 'Gone', email: `gone-${tag}@example.test`, portal_role: 'owner', is_deleted: true },
    });
    expect(await accessForJob(job(a, gone.id))).toBeNull();
  });

  it('invoices: the owner sees them (voids and pay links left out), a viewer is refused, other clients never appear', async () => {
    const owner = (await accessForJob(job(a, a.ownerId)))!;
    const data = (await runRead(owner, 'invoices')) as { invoices: Array<Record<string, unknown>> };
    expect(data.invoices).toHaveLength(1);
    expect(data.invoices[0]).toMatchObject({ doc_number: '1042', balance: 750.5, total: 1500, status: 'open', txn_date: '2026-09-30' });
    expect(JSON.stringify(data)).not.toContain('pay.example.test');
    expect(JSON.stringify(data)).not.toContain('2001');

    const viewer = (await accessForJob(job(a, a.viewerId)))!;
    await expect(runRead(viewer, 'invoices')).rejects.toMatchObject({ statusCode: 403 });
    await expect(runRead(viewer, 'invoices')).rejects.toBeInstanceOf(ApiError);
  });

  it('reports: published and web-safe only', async () => {
    const owner = (await accessForJob(job(a, a.ownerId)))!;
    const data = (await runRead(owner, 'reports')) as { reports: Array<{ title: string }> };
    expect(data.reports.map((r) => r.title)).toEqual(['September report']);
  });

  it('requests list this client only', async () => {
    const ownerA = (await accessForJob(job(a, a.ownerId)))!;
    const data = (await runRead(ownerA, 'requests')) as { open: Array<{ id: string }> };
    expect(data.open.map((i) => i.id)).toContain(a.taskId);
    expect(data.open.map((i) => i.id)).not.toContain(b.taskId);
  });

  it('work_item: another client\'s task is a 404, an own task reads, a missing id is a 400', async () => {
    const ownerA = (await accessForJob(job(a, a.ownerId)))!;
    await expect(runRead(ownerA, 'work_item', { task_id: b.taskId })).rejects.toMatchObject({ statusCode: 404 });
    const own = (await runRead(ownerA, 'work_item', { task_id: a.taskId })) as { id: string; title: string };
    expect(own.id).toBe(a.taskId);
    await expect(runRead(ownerA, 'work_item', {})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('project: an unknown or another client\'s project is a 404', async () => {
    const ownerA = (await accessForJob(job(a, a.ownerId)))!;
    const projB = await prisma.project.create({ data: { name: `Proj ${tag}`, client_id: b.clientId, status: 'in_progress' } });
    try {
      await expect(runRead(ownerA, 'project', { project_id: projB.id })).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      await prisma.project.delete({ where: { id: projB.id } });
    }
  });

  it('site_pages: this client\'s sites only, searched by title, path or section; another client\'s site is a 404', async () => {
    await prisma.sitePage.createMany({
      data: [
        { site_id: a.siteId, url: 'https://a.test/', path: '/', title: 'Home', depth: 0, source: 'sitemap', last_seen_at: new Date() },
        { site_id: a.siteId, url: 'https://a.test/team', path: '/team', title: 'Meet the crew', sections: [{ key: 'staff', heading: 'Our staff' }], depth: 1, source: 'sitemap', last_seen_at: new Date() },
        { site_id: a.siteId, url: 'https://a.test/old', path: '/old', title: 'Old', depth: 1, source: 'sitemap', last_seen_at: new Date(), missing_since: new Date() },
        { site_id: b.siteId, url: 'https://b.test/', path: '/', title: 'Bravo secret page', depth: 0, source: 'sitemap', last_seen_at: new Date() },
      ],
    });
    const ownerA = (await accessForJob(job(a, a.ownerId)))!;
    const all = (await runRead(ownerA, 'site_pages')) as { pages: Array<{ title: string }> };
    expect(all.pages.map((p) => p.title).sort()).toEqual(['Home', 'Meet the crew']);
    const byHeading = (await runRead(ownerA, 'site_pages', { q: 'STAFF' })) as { pages: Array<{ title: string; sections: string[] }> };
    expect(byHeading.pages).toEqual([expect.objectContaining({ title: 'Meet the crew', sections: ['Our staff'] })]);
    expect(JSON.stringify(all)).not.toContain('Bravo');
    await expect(runRead(ownerA, 'site_pages', { site_id: b.siteId })).rejects.toMatchObject({ statusCode: 404 });
    expect(((await runRead(ownerA, 'site_pages', { site_id: a.siteId, q: 'zzz' })) as { pages: unknown[] }).pages).toEqual([]);
  });

  it('history and retainer and projects return shapes without internal fields', async () => {
    const ownerA = (await accessForJob(job(a, a.ownerId)))!;
    const hist = (await runRead(ownerA, 'history', { days: 9999 })) as { days: number; items: unknown[] };
    expect(hist.days).toBe(120);
    expect(Array.isArray(hist.items)).toBe(true);
    expect(await runRead(ownerA, 'retainer')).toEqual({ retainers: [] });
    expect(await runRead(ownerA, 'projects')).toMatchObject({ active: expect.any(Array), complete: expect.any(Array) });
  });
});
