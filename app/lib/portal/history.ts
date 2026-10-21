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
import { clientHistoryTaskWhere } from '@/lib/portal/visibility';
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

/**
 * Merge two newest-first lists and cut one page. Each source must already be sorted by `sortAt`
 * descending and hold at least page * pageSize + 1 rows when more exist (the loader guarantees it).
 */
export function pageMerged<T extends { sortAt: Date | string }>(
  lists: T[][],
  page: number,
  pageSize: number
): { items: T[]; hasMore: boolean } {
  const merged = lists.flat().sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime());
  const start = (page - 1) * pageSize;
  return { items: merged.slice(start, start + pageSize), hasMore: merged.length > start + pageSize };
}

export async function loadHistory(
  access: PortalAccess,
  opts: { page: number; pageSize: number }
): Promise<{ items: HistoryItem[]; hasMore: boolean }> {
  const { page, pageSize } = opts;
  const clientLevel = access.role !== 'none';
  const take = page * pageSize + 1;

  const [tasks, articles] = await Promise.all([
    prisma.task.findMany({
      where: {
        is_deleted: false,
        AND: [
          { OR: [{ client_id: access.clientId }, { site: { client_id: access.clientId } }] },
          clientHistoryTaskWhere(),
          taskAccessWhere(access),
          { OR: [{ status: 'done' }, { client_approved_at: { not: null } }] },
        ],
      },
      select: {
        id: true,
        title: true,
        client_approved_at: true,
        completed_at: true,
        updated_at: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: { updated_at: 'desc' },
      take,
    }),
    clientLevel
      ? prisma.article.findMany({
          where: { client_id: access.clientId, status: 'published', is_deleted: false },
          select: { id: true, title: true, published_url: true, updated_at: true },
          orderBy: { updated_at: 'desc' },
          take,
        })
      : Promise.resolve([] as { id: string; title: string; published_url: string | null; updated_at: Date }[]),
  ]);

  const taskItems = tasks.map((t): { sortAt: Date; item: HistoryItem } => ({
    sortAt: t.updated_at,
    item: {
      type: (t.client_approved_at ? 'task_approved' : 'task_completed') as ActivityType,
      id: t.id,
      title: t.title,
      url: null,
      project: t.project ? { id: t.project.id, name: t.project.name } : null,
      at: t.client_approved_at ?? t.completed_at ?? t.updated_at,
    },
  }));
  const articleItems = articles.map((a): { sortAt: Date; item: HistoryItem } => ({
    sortAt: a.updated_at,
    item: {
      type: 'article_published' as ActivityType,
      id: a.id,
      title: a.title,
      url: a.published_url ?? null,
      project: null,
      at: a.updated_at,
    },
  }));

  const { items, hasMore } = pageMerged([taskItems, articleItems], page, pageSize);
  return { items: items.map((i) => i.item), hasMore };
}
