/**
 * Portal history (portal MVP A5): completed client-visible tasks and published articles, newest
 * first, paginated. Shared by GET /api/portal/history.
 *
 * Uses the A1 history fragment (clientHistoryTaskWhere) and the A3 task scope (taskAccessWhere),
 * so a client sees work they asked for, work shared with them and work they approved, only on
 * projects they may see. Time estimates and every internal field are left out by construction:
 * the select below is the allow-list.
 */
import { prisma } from '@/lib/db/prisma';
import { taskAccessWhere, type PortalAccess } from '@/lib/portal/access';
import { clientHistoryTaskWhere, stagedTaskWhere } from '@/lib/portal/visibility';
import { engagementOf, type Engagement } from '@/lib/portal/engagement';
import type { ActivityType } from '@/lib/portal/status-labels';

export const HISTORY_DEFAULT_PAGE_SIZE = 20;
export const HISTORY_MAX_PAGE_SIZE = 50;
export const HISTORY_MAX_PAGE = 20;

export interface HistoryItem {
  type: ActivityType;
  id: string;
  title: string;
  url: string | null;
  project: { id: string; name: string } | null;
  /** Project, Retainer or Request (portal phase B slice 2). Null for articles. */
  engagement: Engagement | null;
  at: Date | string;
}

function toInt(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

/** Clamp page and page_size query values. Bad input falls back to the defaults. */
export function parsePagination(params: URLSearchParams): { page: number; pageSize: number } {
  const page = Math.min(Math.max(toInt(params.get('page'), 1), 1), HISTORY_MAX_PAGE);
  const pageSize = Math.min(Math.max(toInt(params.get('page_size'), HISTORY_DEFAULT_PAGE_SIZE), 1), HISTORY_MAX_PAGE_SIZE);
  return { page, pageSize };
}

export interface Sortable {
  /** Sort key, newest first. Null sorts last. */
  sortAt: Date | string | null;
  /** Tie-break, descending. */
  id: string;
}

const keyMs = (v: Date | string | null): number => (v === null ? Number.NEGATIVE_INFINITY : new Date(v).getTime());

/** Newest first by key, then id descending. Every source query uses the same two keys. */
export function compareNewest(a: Sortable, b: Sortable): number {
  const ka = keyMs(a.sortAt);
  const kb = keyMs(b.sortAt);
  if (ka !== kb) return kb > ka ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Merge newest-first lists and cut one page. Each source must already be sorted by compareNewest
 * and hold at least page * pageSize + 1 rows when more exist (the loader guarantees it), so the
 * merged window is exact. hasMore is false once page reaches HISTORY_MAX_PAGE: nothing past it is
 * reachable, so no "Show more" is offered.
 */
export function pageMerged<T extends Sortable>(
  lists: T[][],
  page: number,
  pageSize: number
): { items: T[]; hasMore: boolean } {
  const merged = lists.flat().sort(compareNewest);
  const start = (page - 1) * pageSize;
  return {
    items: merged.slice(start, start + pageSize),
    hasMore: page < HISTORY_MAX_PAGE && merged.length > start + pageSize,
  };
}

export async function loadHistory(
  access: PortalAccess,
  opts: { page: number; pageSize: number }
): Promise<{ items: HistoryItem[]; hasMore: boolean }> {
  const page = Math.min(Math.max(opts.page, 1), HISTORY_MAX_PAGE);
  const pageSize = opts.pageSize;
  const clientLevel = access.role !== 'none';
  const take = page * pageSize + 1;

  const base = [
    { OR: [{ client_id: access.clientId }, { site: { client_id: access.clientId } }] },
    clientHistoryTaskWhere(),
    taskAccessWhere(access),
  ];
  const select = {
    id: true,
    title: true,
    client_title: true,
    client_approved_at: true,
    completed_at: true,
    updated_at: true,
    project_id: true,
    charter_id: true,
    project: { select: { id: true, name: true } },
    charter: { select: { id: true, charter_wares: { where: { is_active: true }, select: { ware: { select: { name: true } } } } } },
    site: { select: { id: true, name: true } },
  } as const;

  // Sort key is COALESCE(client_approved_at, completed_at), then id. Prisma cannot order by a
  // coalesce, so the two halves are queried apart (each ordered by its own column) and merged
  // with the same key. The merge is exact because each half is a sorted prefix.
  const [approved, completed, articles] = await Promise.all([
    prisma.task.findMany({
      where: { is_deleted: false, AND: [...base, { client_approved_at: { not: null } }] },
      select,
      orderBy: [{ client_approved_at: 'desc' }, { id: 'desc' }],
      take,
    }),
    prisma.task.findMany({
      where: {
        is_deleted: false,
        // Finished on our side AND not waiting on the client: staged-but-unapproved work is out.
        AND: [...base, { client_approved_at: null }, { status: 'done', NOT: stagedTaskWhere() }],
      },
      select,
      orderBy: [{ completed_at: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take,
    }),
    clientLevel
      ? prisma.article.findMany({
          where: { client_id: access.clientId, status: 'published', is_deleted: false },
          select: { id: true, title: true, published_url: true, updated_at: true },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          take,
        })
      : Promise.resolve([] as { id: string; title: string; published_url: string | null; updated_at: Date }[]),
  ]);

  type Row = Sortable & { item: HistoryItem };
  const taskRow = (t: (typeof approved)[number]): Row => ({
    sortAt: t.client_approved_at ?? t.completed_at,
    id: t.id,
    item: {
      type: t.client_approved_at ? 'task_approved' : 'task_completed',
      id: t.id,
      title: t.client_title ?? t.title,
      url: null,
      project: t.project ? { id: t.project.id, name: t.project.name } : null,
      engagement: engagementOf({
        project_id: t.project_id,
        project: t.project,
        charter_id: t.charter_id,
        charter: t.charter
          ? { id: t.charter.id, ware_names: t.charter.charter_wares.map((w) => w.ware?.name ?? '').filter(Boolean) }
          : null,
        site: t.site,
      }),
      at: t.client_approved_at ?? t.completed_at ?? t.updated_at,
    },
  });
  const articleRows = articles.map(
    (a): Row => ({
      sortAt: a.updated_at,
      id: a.id,
      item: { type: 'article_published', id: a.id, title: a.title, url: a.published_url ?? null, project: null, engagement: null, at: a.updated_at },
    })
  );

  const { items, hasMore } = pageMerged([approved.map(taskRow), completed.map(taskRow), articleRows], page, pageSize);
  return { items: items.map((i) => i.item), hasMore };
}
