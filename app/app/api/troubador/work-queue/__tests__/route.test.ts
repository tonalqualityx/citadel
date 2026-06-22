import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    troubadorRun: {
      findMany: vi.fn(),
    },
  },
}));

// isLeaseActive is a pure time helper — use the real implementation, not a mock.

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRunFindMany = prisma.troubadorRun.findMany as Mock;

const client = { id: 'client-1', name: 'Indelible' };
const site = { id: 'site-1', name: 'becomeindelible.com', site_type: 'eleventy' };

const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const STALE_CLAIM = new Date(Date.now() - 30 * 60 * 1000); // > 15min lease → expired

function run(stage: string, articles: Array<Record<string, unknown>>) {
  return {
    id: 'run-1',
    stage,
    ready: true,
    selection_ready: true,
    claimed_at: null,
    updated_at: new Date('2026-06-01T00:00:00Z'),
    client,
    site,
    articles,
  };
}

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    slug: 'local-seo',
    status: 'approved',
    scheduled_date: null,
    claimed_at: null,
    ...overrides,
  };
}

async function actions() {
  const res = await GET();
  const body = await res.json();
  return body.items.map((i: { action: string; article_id?: string }) => ({
    action: i.action,
    article_id: i.article_id,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'bot-1', role: 'pm', email: 'troubador@indelible.bot' });
});

describe('GET /api/troubador/work-queue — publish surfacing', () => {
  it('surfaces publish_article for an approved article in a publishing-stage run', async () => {
    mockRunFindMany.mockResolvedValue([run('publishing', [article({ status: 'approved' })])]);
    expect(await actions()).toEqual([{ action: 'publish_article', article_id: 'a1' }]);
  });

  it('surfaces publish_article for an approved article in an in_production run', async () => {
    mockRunFindMany.mockResolvedValue([run('in_production', [article({ status: 'approved' })])]);
    expect(await actions()).toEqual([{ action: 'publish_article', article_id: 'a1' }]);
  });

  it('does NOT surface an approved article while its worker lease is active', async () => {
    mockRunFindMany.mockResolvedValue([
      run('publishing', [article({ status: 'approved', claimed_at: new Date() })]),
    ]);
    expect(await actions()).toEqual([]);
  });

  it('re-surfaces an approved article once its lease has expired', async () => {
    mockRunFindMany.mockResolvedValue([
      run('publishing', [article({ status: 'approved', claimed_at: STALE_CLAIM })]),
    ]);
    expect(await actions()).toEqual([{ action: 'publish_article', article_id: 'a1' }]);
  });

  it('surfaces publish_article for a scheduled article whose date has passed (was unreachable in publishing)', async () => {
    mockRunFindMany.mockResolvedValue([
      run('publishing', [article({ status: 'scheduled', scheduled_date: PAST })]),
    ]);
    expect(await actions()).toEqual([{ action: 'publish_article', article_id: 'a1' }]);
  });

  it('does NOT surface a scheduled article whose date is still in the future', async () => {
    mockRunFindMany.mockResolvedValue([
      run('publishing', [article({ status: 'scheduled', scheduled_date: FUTURE })]),
    ]);
    expect(await actions()).toEqual([]);
  });
});

describe('GET /api/troubador/work-queue — existing in_production work (no regression)', () => {
  it('still surfaces draft_article and rewrite_article for in_production runs', async () => {
    mockRunFindMany.mockResolvedValue([
      run('in_production', [
        article({ id: 'a-draft', slug: 's1', status: 'researched' }),
        article({ id: 'a-rewrite', slug: 's2', status: 'needs_revision' }),
      ]),
    ]);
    const result = await actions();
    expect(result).toContainEqual({ action: 'draft_article', article_id: 'a-draft' });
    expect(result).toContainEqual({ action: 'rewrite_article', article_id: 'a-rewrite' });
  });
});
