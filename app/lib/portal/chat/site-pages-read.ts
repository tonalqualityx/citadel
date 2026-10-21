/**
 * Page lookup for the chat (phase C spec 3): the `site_pages` tool and the client's "Another page"
 * search. Always scoped to one client's own sites; a site that is not theirs is simply not found.
 */
import { prisma } from '@/lib/db/prisma';

export const PAGE_SEARCH_LIMIT = 20;
export const SECTIONS_PER_PAGE = 8;

export interface PageHit {
  id: string;
  site_id: string;
  title: string;
  path: string;
  sections: string[];
}

function headings(sections: unknown): string[] {
  return (Array.isArray(sections) ? (sections as Array<{ heading?: unknown }>) : [])
    .map((s) => (typeof s?.heading === 'string' ? s.heading : ''))
    .filter(Boolean)
    .slice(0, SECTIONS_PER_PAGE);
}

/**
 * Pages on the client's sites (one site, or all of them) that match `q` in the title, path or a
 * section heading; no `q` lists the shallowest pages. Null when `siteId` is not one of the client's sites.
 */
export async function searchSitePages(
  clientId: string,
  opts: { siteId?: string | null; q?: string | null; limit?: number } = {}
): Promise<PageHit[] | null> {
  const sites = await prisma.site.findMany({ where: { client_id: clientId, is_deleted: false }, select: { id: true } });
  const own = new Set(sites.map((s) => s.id));
  if (opts.siteId && !own.has(opts.siteId)) return null;
  const siteIds = opts.siteId ? [opts.siteId] : [...own];
  if (siteIds.length === 0) return [];
  const rows = await prisma.sitePage.findMany({
    where: { site_id: { in: siteIds }, missing_since: null },
    orderBy: [{ depth: 'asc' }, { path: 'asc' }],
    take: 400,
    select: { id: true, site_id: true, title: true, path: true, sections: true },
  });
  const q = (opts.q ?? '').trim().toLowerCase().slice(0, 100);
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SEARCH_LIMIT, 1), 50);
  const scored = rows
    .map((r) => {
      const hs = headings(r.sections);
      if (!q) return { r, hs, score: 0 };
      const title = r.title.toLowerCase().includes(q) ? 3 : 0;
      const path = r.path.toLowerCase().includes(q) ? 2 : 0;
      const sec = hs.some((h) => h.toLowerCase().includes(q)) ? 1 : 0;
      return { r, hs, score: title + path + sec };
    })
    .filter((x) => !q || x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ r, hs }) => ({ id: r.id, site_id: r.site_id, title: r.title, path: r.path, sections: hs }));
}
