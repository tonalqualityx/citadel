import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';
import { taskAccessWhere } from '@/lib/portal/access';
import { clientHistoryTaskWhere, stagedTaskWhere } from '@/lib/portal/visibility';
import { HISTORY_MAX_PAGE, loadHistory, pageMerged, parsePagination } from '@/lib/portal/history';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: vi.fn() },
    article: { findMany: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockAuth = requireClientAuth as Mock;
const mockTasks = prisma.task.findMany as Mock;
const mockArticles = prisma.article.findMany as Mock;

const req = (qs = '') => new NextRequest(new URL(`http://localhost/api/portal/history${qs}`));

// Day n of October 2026, newest first when n is larger.
const day = (n: number) => new Date(Date.UTC(2026, 9, n));

interface Row {
  id: string;
  title: string;
  client_approved_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
  project: { id: string; name: string };
  // Extra columns a careless select could leak.
  estimated_minutes: number;
  notes: string;
}

function taskRow(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    title: `Task ${id}`,
    client_approved_at: null,
    completed_at: day(5),
    updated_at: day(5),
    project: { id: 'p1', name: 'Site' },
    estimated_minutes: 60,
    notes: 'internal',
    ...over,
  };
}

const ms = (d: Date | null) => (d ? d.getTime() : -Infinity);

/**
 * Serve the three history queries like Prisma would: the approved half (ordered by
 * client_approved_at desc, id desc), the completed half (completed_at desc nulls last, id desc)
 * and articles (updated_at desc, id desc), each honoring `take`.
 */
function serveTasks(approved: Row[], completed: Row[], cancelled: Row[] = []) {
  mockTasks.mockImplementation(async (args: { orderBy: Record<string, unknown>[]; take: number }) => {
    const byApproved = 'client_approved_at' in args.orderBy[0];
    const byCancelled = 'updated_at' in args.orderBy[0];
    const rows = [...(byCancelled ? cancelled : byApproved ? approved : completed)];
    const key = (r: Row) => ms(byCancelled ? r.updated_at : byApproved ? r.client_approved_at : r.completed_at);
    rows.sort((a, b) => key(b) - key(a) || (a.id < b.id ? 1 : -1));
    return rows.slice(0, args.take);
  });
}
function serveArticles(rows: { id: string; title: string; published_url: string | null; updated_at: Date }[]) {
  mockArticles.mockImplementation(async (args: { take: number }) =>
    [...rows].sort((a, b) => ms(b.updated_at) - ms(a.updated_at) || (a.id < b.id ? 1 : -1)).slice(0, args.take)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1', role: 'owner' });
  serveTasks([], []);
  serveArticles([]);
});

describe('GET /api/portal/history', () => {
  it('401 without a session', async () => {
    mockAuth.mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await GET(req())).status).toBe(401);
  });

  it('returns an empty first page', async () => {
    const body = await (await GET(req())).json();
    expect(body).toEqual({ items: [], page: 1, page_size: 20, has_more: false });
  });

  it('sorts by approval or completion date, then id, across tasks and articles', async () => {
    serveTasks(
      [taskRow('a1', { client_approved_at: day(20), completed_at: day(2) })],
      [taskRow('c1', { completed_at: day(10) }), taskRow('c2', { completed_at: day(25) })]
    );
    serveArticles([{ id: 'art1', title: 'Post', published_url: 'https://x.example/1', updated_at: day(15) }]);
    const body = await (await GET(req())).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['c2', 'a1', 'art1', 'c1']);
    expect(body.items[1]).toMatchObject({ type: 'task_approved' });
  });

  it('lists a request the client cancelled as task_cancelled, dated by its last update, and queries only abandoned work with the tag', async () => {
    serveTasks([], [taskRow('c1', { completed_at: day(10) })], [taskRow('x1', { completed_at: null, updated_at: day(20) })]);
    const body = await (await GET(req())).json();
    expect(body.items.map((i: { id: string; type: string }) => [i.id, i.type])).toEqual([['x1', 'task_cancelled'], ['c1', 'task_completed']]);
    expect(body.items[0].at).toBe(day(20).toISOString());
    const cancelledCall = mockTasks.mock.calls.map((c) => c[0]).find((c) => 'updated_at' in c.orderBy[0]);
    expect(cancelledCall.where.AND).toContainEqual({ status: 'abandoned', tags: { has: 'client-cancelled' } });
    expect(cancelledCall.where.AND).toContainEqual(clientHistoryTaskWhere());
    expect(cancelledCall.where.AND).toContainEqual(taskAccessWhere({ contactId: 'contact-1', clientId: 'client-acme', role: 'owner' }));
  });

  it('pages with no duplicates and no gaps, even with identical timestamps', async () => {
    // 30 completed tasks all sharing one timestamp, 12 approved sharing another, 9 articles.
    const completed = Array.from({ length: 30 }, (_, i) => taskRow(`c${String(i).padStart(2, '0')}`, { completed_at: day(10) }));
    const approved = Array.from({ length: 12 }, (_, i) =>
      taskRow(`a${String(i).padStart(2, '0')}`, { client_approved_at: day(10), completed_at: day(3) })
    );
    const arts = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, title: `Post ${i}`, published_url: null, updated_at: day(10) }));
    serveTasks(approved, completed);
    serveArticles(arts);

    const seen: string[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const body = await (await GET(req(`?page=${page}&page_size=7`))).json();
      seen.push(...body.items.map((i: { id: string }) => i.id));
      if (!body.has_more) break;
    }
    const all = [...completed.map((r) => r.id), ...approved.map((r) => r.id), ...arts.map((r) => r.id)];
    expect(seen).toHaveLength(all.length);
    expect(new Set(seen).size).toBe(all.length);
    // Same key everywhere, so the order is id descending.
    expect(seen).toEqual([...all].sort().reverse());
  });

  it('fetches page * size + 1 from each source so has_more is exact', async () => {
    await GET(req('?page=3&page_size=10'));
    for (const call of mockTasks.mock.calls) expect(call[0].take).toBe(31);
    expect(mockArticles.mock.calls[0][0].take).toBe(31);
  });

  it('has_more is false at the last reachable page even when more rows exist', async () => {
    serveTasks([], Array.from({ length: 30 }, (_, i) => taskRow(`c${i}`, { completed_at: day(10) })));
    const at20 = await (await GET(req('?page=20&page_size=1'))).json();
    expect(at20.page).toBe(HISTORY_MAX_PAGE);
    expect(at20.has_more).toBe(false);
    // page 21 is clamped to 20.
    const at21 = await (await GET(req('?page=21&page_size=1'))).json();
    expect(at21.page).toBe(HISTORY_MAX_PAGE);
    expect(at21.has_more).toBe(false);
    // page 19 of the same data still offers more.
    expect((await (await GET(req('?page=19&page_size=1'))).json()).has_more).toBe(true);
    // The loader itself also refuses to offer more past the cap.
    const direct = await loadHistory({ contactId: 'c', clientId: 'client-acme', role: 'owner' }, { page: 21, pageSize: 1 });
    expect(direct.hasMore).toBe(false);
  });

  it('clamps bad page and page_size input', () => {
    expect(parsePagination(new URLSearchParams('page=0&page_size=9999'))).toEqual({ page: 1, pageSize: 50 });
    expect(parsePagination(new URLSearchParams('page=abc&page_size=-4'))).toEqual({ page: 1, pageSize: 1 });
    expect(parsePagination(new URLSearchParams(''))).toEqual({ page: 1, pageSize: 20 });
    expect(parsePagination(new URLSearchParams('page=999'))).toEqual({ page: 20, pageSize: 20 });
  });

  it('pageMerged slices correctly and stops offering more at the cap', () => {
    const a = [{ sortAt: day(5), id: 'a' }, { sortAt: day(3), id: 'b' }];
    const b = [{ sortAt: day(4), id: 'c' }];
    expect(pageMerged([a, b], 1, 2)).toMatchObject({ hasMore: true });
    expect(pageMerged([a, b], 2, 2).items).toHaveLength(1);
    expect(pageMerged([a, b], 2, 2).hasMore).toBe(false);
    const many = Array.from({ length: 100 }, (_, i) => ({ sortAt: day(1), id: `x${i}` }));
    expect(pageMerged([many], HISTORY_MAX_PAGE, 1).hasMore).toBe(false);
    expect(pageMerged([many], HISTORY_MAX_PAGE - 1, 1).hasMore).toBe(true);
  });

  it('excludes staged-but-unapproved done work and applies the A1 history rule and A3 scope', async () => {
    await GET(req());
    const access = { contactId: 'contact-1', clientId: 'client-acme', role: 'owner' as const };
    const [approvedCall, completedCall] = mockTasks.mock.calls.map((c) => c[0]);
    for (const call of [approvedCall, completedCall]) {
      expect(call.where.AND).toContainEqual(clientHistoryTaskWhere());
      expect(call.where.AND).toContainEqual(taskAccessWhere(access));
      expect(call.where.AND[0].OR).toEqual([{ client_id: 'client-acme' }, { site: { client_id: 'client-acme' } }]);
    }
    expect(approvedCall.where.AND).toContainEqual({ client_approved_at: { not: null } });
    expect(completedCall.where.AND).toContainEqual({ client_approved_at: null });
    expect(completedCall.where.AND).toContainEqual({ status: 'done', NOT: stagedTaskWhere() });
    expect(mockArticles.mock.calls[0][0].where.client_id).toBe('client-acme');
  });

  it('project-only contacts get no articles and a grant-scoped task query', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-2', role: 'none' });
    await GET(req());
    expect(mockArticles).not.toHaveBeenCalled();
    const access = { contactId: 'contact-2', clientId: 'client-acme', role: 'none' as const };
    for (const call of mockTasks.mock.calls) {
      expect(call[0].where.AND).toContainEqual(taskAccessWhere(access));
    }
    expect(JSON.stringify(taskAccessWhere(access))).toContain('contact_grants');
  });

  it('a revoked contact matches nothing', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'gone' });
    const { prisma: p } = await import('@/lib/db/prisma');
    (p as unknown as { clientContact: { findFirst: Mock } }).clientContact = { findFirst: vi.fn().mockResolvedValue(null) };
    await GET(req());
    for (const call of mockTasks.mock.calls) expect(call[0].where.AND).toContainEqual({ id: { in: [] } });
  });

  it('exposes no estimates or internal fields', async () => {
    serveTasks([], [taskRow('t3')]);
    serveArticles([{ id: 'a1', title: 'Post', published_url: null, updated_at: day(4), body: 'x', research_summary: 'secret' } as never]);
    const text = JSON.stringify(await (await GET(req())).json());
    expect(text).not.toContain('estimated_minutes');
    expect(text).not.toContain('internal');
    expect(text).not.toContain('research_summary');
    for (const call of mockTasks.mock.calls) expect(Object.keys(call[0].select)).not.toContain('estimated_minutes');
    for (const item of JSON.parse(text).items) {
      expect(Object.keys(item).sort()).toEqual(['at', 'engagement', 'id', 'project', 'title', 'type', 'url']);
    }
  });
});
