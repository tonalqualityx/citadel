/**
 * The engine's Citadel reads (phase C spec 5.2, `citadel_read`). Each kind returns exactly what the
 * portal already shows THIS contact, from the portal's own loaders, under the contact's own access
 * (role, agency inheritance, project grants). Nothing the portal hides (internal notes, hours
 * used, other clients) is reachable. Invoices only for roles that may see billing.
 */
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { canSeeBilling, resolveAccessibleClients, type PortalAccess } from '@/lib/portal/access';
import { loadRequests, loadWorkItem } from '@/lib/portal/requests';
import { loadProjectList } from '@/lib/portal/projects-list';
import { loadProjectDetail } from '@/lib/portal/project-detail';
import { loadRetainers, safeHttpUrl } from '@/lib/portal/retainer';
import { loadHistory } from '@/lib/portal/history';
import { searchSitePages } from '@/lib/portal/chat/site-pages-read';

export const READ_KINDS = ['requests', 'work_item', 'projects', 'project', 'retainer', 'history', 'reports', 'invoices', 'site_pages'] as const;
export type ReadKind = (typeof READ_KINDS)[number];
export const HISTORY_MAX_DAYS = 120;

export function isReadKind(value: string): value is ReadKind {
  return (READ_KINDS as readonly string[]).includes(value);
}

/**
 * The contact's access on the job's client, resolved exactly as at sign-in: by email across the
 * person's contact rows. Null when the contact has no access to that client (any more).
 */
export async function accessForJob(job: { client_id: string | null; contact_id: string | null }): Promise<PortalAccess | null> {
  if (!job.client_id || !job.contact_id) return null;
  const contact = await prisma.clientContact.findFirst({
    where: { id: job.contact_id, is_deleted: false },
    select: { email: true },
  });
  if (!contact?.email) return null;
  const clients = await resolveAccessibleClients(contact.email);
  const hit = clients.find((c) => c.clientId === job.client_id);
  if (!hit) return null;
  return { contactId: hit.contactId, contactIds: hit.contactIds, clientId: hit.clientId, role: hit.role };
}

export interface ReadParams {
  task_id?: string | null;
  project_id?: string | null;
  days?: number | null;
  site_id?: string | null;
  q?: string | null;
}

export async function runRead(access: PortalAccess, kind: ReadKind, params: ReadParams = {}, now: Date = new Date()): Promise<unknown> {
  switch (kind) {
    case 'requests':
      return loadRequests(access, { now });
    case 'work_item': {
      if (!params.task_id) throw new ApiError('task_id is required', 400);
      const item = await loadWorkItem(access, params.task_id);
      if (!item) throw new ApiError('Not found', 404);
      return item;
    }
    case 'projects':
      return loadProjectList(access);
    case 'project': {
      if (!params.project_id) throw new ApiError('project_id is required', 400);
      const detail = await loadProjectDetail(access, params.project_id);
      if (!detail) throw new ApiError('Not found', 404);
      return detail;
    }
    case 'retainer':
      return { retainers: await loadRetainers(access, { now }) };
    case 'history': {
      const days = Math.min(Math.max(Math.trunc(params.days ?? 30), 1), HISTORY_MAX_DAYS);
      const since = now.getTime() - days * 24 * 60 * 60 * 1000;
      const { items } = await loadHistory(access, { page: 1, pageSize: 50 });
      return { days, items: items.filter((i) => new Date(i.at).getTime() >= since) };
    }
    case 'reports': {
      if (access.role === 'none') return { reports: [] };
      const rows = await prisma.clientReport.findMany({
        where: { client_id: access.clientId, published_at: { not: null, lte: now } },
        orderBy: { published_at: 'desc' },
        take: 12,
        select: { title: true, headline: true, period: true, url: true, published_at: true },
      });
      return {
        reports: rows.flatMap((r) => {
          const url = safeHttpUrl(r.url);
          return url ? [{ title: r.title, headline: r.headline, period: r.period, url, published_at: r.published_at }] : [];
        }),
      };
    }
    case 'site_pages': {
      if (access.role === 'none') return { pages: [] };
      const pages = await searchSitePages(access.clientId, { siteId: params.site_id, q: params.q });
      if (!pages) throw new ApiError('Not found', 404);
      return { pages };
    }
    case 'invoices': {
      if (!canSeeBilling(access.role)) throw new ApiError('Billing is not visible to this contact', 403);
      const rows = await prisma.clientInvoice.findMany({
        where: { client_id: access.clientId, status: { not: 'void' } },
        orderBy: [{ txn_date: 'desc' }],
        take: 24,
        select: { doc_number: true, txn_date: true, due_date: true, total: true, balance: true, status: true },
      });
      const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
      return {
        invoices: rows.map((r) => ({
          doc_number: r.doc_number,
          txn_date: iso(r.txn_date),
          due_date: iso(r.due_date),
          total: Number(r.total),
          balance: Number(r.balance),
          status: r.status,
        })),
      };
    }
  }
}
