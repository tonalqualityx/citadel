import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';
import { taskAccessWhere } from '@/lib/portal/access';
import { clientHistoryTaskWhere } from '@/lib/portal/visibility';
import { pageMerged, parsePagination } from '@/lib/portal/history';

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

function taskRow(n: number) {
  return {
    id: `t${n}`,
    title: `Task ${n}`,
    client_approved_at: null,
    completed_at: day(n),
    updated_at: day(n),
    project: { id: 'p1', name: 'Site' },
    // Extra columns a careless select could leak.
    estimated_minutes: 60,
    notes: 'internal',
  };
}

/** Make the mocked findMany honor `take`, like Prisma, over a newest-first list. */
function serve(mock: Mock, rows: object[]) {
  mock.mockImplementation(async ({ take }: { take: number }) => rows.slice(0, take));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1', role: 'owner' });
  serve(mockArticles, []);
  serve(mockTasks, []);
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

  it('pages newest first across tasks and articles', async () => {
    // 25 tasks (days 25..1) and 10 articles interleaved on even days 50..32 offset into November.
    serve(mockTasks, Array.from({ length: 25 }, (_, i) => taskRow(25 - i)));
    serve(
      mockArticles,
      Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, title: `Post ${i}`, published_url: `https://x.example/${i}`, updated_at: day(40 - i) }))
    );

    const p1 = await (await GET(req('?page=1&page_size=10'))).json();
    expect(p1.items).toHaveLength(10);
    expect(p1.has_more).toBe(true);
    // All ten articles (days 40..31) are newer than every task, so they fill page 1.
    expect(p1.items.every((i: { type: string }) => i.type === 'article_published')).toBe(true);

    const p2 = await (await GET(req('?page=2&page_size=10'))).json();
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual(['t25', 't24', 't23', 't22', 't21', 't20', 't19', 't18', 't17', 't16']);
    expect(p2.has_more).toBe(true);

    const p4 = await (await GET(req('?page=4&page_size=10'))).json();
    expect(p4.items.map((i: { id: string }) => i.id)).toEqual(['t5', 't4', 't3', 't2', 't1']);
    expect(p4.has_more).toBe(false);

    const dates = p2.items.map((i: { at: string }) => new Date(i.at).getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('fetches page * size + 1 from each source so has_more is exact', async () => {
    await GET(req('?page=3&page_size=10'));
    expect(mockTasks.mock.calls[0][0].take).toBe(31);
    expect(mockArticles.mock.calls[0][0].take).toBe(31);
  });

  it('clamps bad page and page_size input', () => {
    expect(parsePagination(new URLSearchParams('page=0&page_size=9999'))).toEqual({ page: 1, pageSize: 50 });
    expect(parsePagination(new URLSearchParams('page=abc&page_size=-4'))).toEqual({ page: 1, pageSize: 1 });
    expect(parsePagination(new URLSearchParams(''))).toEqual({ page: 1, pageSize: 20 });
    expect(parsePagination(new URLSearchParams('page=999'))).toEqual({ page: 20, pageSize: 20 });
  });

  it('pageMerged slices correctly', () => {
    const a = [{ sortAt: day(5) }, { sortAt: day(3) }];
    const b = [{ sortAt: day(4) }];
    expect(pageMerged([a, b], 1, 2)).toMatchObject({ hasMore: true });
    expect(pageMerged([a, b], 2, 2).items).toHaveLength(1);
    expect(pageMerged([a, b], 2, 2).hasMore).toBe(false);
  });

  it('applies the A1 history rule and the A3 task scope', async () => {
    await GET(req());
    const where = mockTasks.mock.calls[0][0].where;
    const access = { contactId: 'contact-1', clientId: 'client-acme', role: 'owner' as const };
    expect(where.AND).toContainEqual(clientHistoryTaskWhere());
    expect(where.AND).toContainEqual(taskAccessWhere(access));
    expect(where.AND[0].OR).toEqual([{ client_id: 'client-acme' }, { site: { client_id: 'client-acme' } }]);
    expect(mockArticles.mock.calls[0][0].where.client_id).toBe('client-acme');
  });

  it('project-only contacts get no articles and a grant-scoped task query', async () => {
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-2', role: 'none' });
    await GET(req());
    expect(mockArticles).not.toHaveBeenCalled();
    const where = mockTasks.mock.calls[0][0].where;
    const access = { contactId: 'contact-2', clientId: 'client-acme', role: 'none' as const };
    expect(where.AND).toContainEqual(taskAccessWhere(access));
    expect(JSON.stringify(taskAccessWhere(access))).toContain('contact_grants');
  });

  it('a revoked contact matches nothing', async () => {
    // loadPortalAccess has no role on the session here, so it looks the contact up: none found.
    mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'gone' });
    const { prisma: p } = await import('@/lib/db/prisma');
    (p as unknown as { clientContact: { findFirst: Mock } }).clientContact = { findFirst: vi.fn().mockResolvedValue(null) };
    await GET(req());
    expect(mockTasks.mock.calls[0][0].where.AND).toContainEqual({ id: { in: [] } });
  });

  it('exposes no estimates or internal fields', async () => {
    serve(mockTasks, [taskRow(3)]);
    serve(mockArticles, [{ id: 'a1', title: 'Post', published_url: null, updated_at: day(4), body: 'x', research_summary: 'secret' }]);
    const res = await GET(req());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('estimated_minutes');
    expect(text).not.toContain('internal');
    expect(text).not.toContain('research_summary');
    const select = mockTasks.mock.calls[0][0].select;
    expect(Object.keys(select)).not.toContain('estimated_minutes');
    const body = JSON.parse(text);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['at', 'id', 'project', 'title', 'type', 'url']);
    }
  });
});
