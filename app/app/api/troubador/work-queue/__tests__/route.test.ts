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

vi.mock('@/lib/services/troubador-runway', () => ({
  getRunwayReport: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { getRunwayReport } from '@/lib/services/troubador-runway';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRunFindMany = prisma.troubadorRun.findMany as Mock;
const mockRunwayReport = getRunwayReport as Mock;

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

function runway(overrides: Record<string, unknown> = {}) {
  return {
    site_id: 'site-2',
    site_name: 'botanicaldream.com',
    client_id: 'client-2',
    client_name: 'Herba',
    shelf_count: 0,
    unscheduled_count: 0,
    postponed_count: 7,
    publish_per_week: 1,
    cadence_source: 'schedule',
    lead_time_days: 14,
    runway_days: 0,
    runway_end: '2026-09-10',
    scheduled_through: null,
    trigger_days: 21,
    low_runway: true,
    has_live_run: false,
    has_open_alarm_task: false,
    ...overrides,
  };
}

function alarm(overrides: Record<string, unknown> = {}) {
  return {
    runway: runway(overrides),
    meeting_request_draft: {
      to_client: { subject: 'Booking the next content meeting for Herba', body: 'Hi Dan,' },
      to_mike: 'botanicaldream.com has 0 approved articles left',
      booking_url: 'https://calendly.com/indelible-mike/marketing-meeting',
      book_by_date: '2026-08-27',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'bot-1', role: 'pm', email: 'troubador@indelible.bot' });
  mockRunwayReport.mockResolvedValue({ generated_at: '2026-09-10T12:00:00.000Z', sites: [], alarms: [] });
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

  it('surfaces publish_article for a scheduled article whose date was cleared (the publish deadlock)', async () => {
    // Un-scheduling used to leave status='scheduled' with a null date: neither the
    // approved branch nor the date-arrived branch matched, so the article was
    // invisible to the worker forever.
    mockRunFindMany.mockResolvedValue([
      run('publishing', [article({ status: 'scheduled', scheduled_date: null })]),
    ]);
    expect(await actions()).toEqual([{ action: 'publish_article', article_id: 'a1' }]);
  });

  it('does NOT surface a dateless scheduled article while its worker lease is active', async () => {
    mockRunFindMany.mockResolvedValue([
      run('publishing', [
        article({ status: 'scheduled', scheduled_date: null, claimed_at: new Date() }),
      ]),
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

describe('GET /api/troubador/work-queue — content runway alarm', () => {
  it('queues a topic re-evaluation for a site that has run out of content', async () => {
    // A site whose runs have all finished contributes nothing to the run scan, so without
    // the site-driven runway check it is invisible however empty its shelf is.
    mockRunFindMany.mockResolvedValue([]);
    mockRunwayReport.mockResolvedValue({
      generated_at: '2026-09-10T12:00:00.000Z',
      sites: [runway()],
      alarms: [alarm()],
    });
    const res = await GET();
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].action).toBe('reevaluate_topics');
    expect(body.items[0].site.name).toBe('botanicaldream.com');
    expect(body.items[0].run_id).toBeNull();
    expect(body.items[0].article_id).toBeNull();
    expect(body.items[0].runway.shelf_count).toBe(0);
    expect(body.items[0].meeting_request_draft.to_client.subject).toContain('Herba');
    expect(body.runway.low_runway_count).toBe(1);
  });

  it('does NOT queue a re-evaluation while the site already has a cycle in flight', async () => {
    mockRunFindMany.mockResolvedValue([]);
    mockRunwayReport.mockResolvedValue({
      generated_at: '2026-09-10T12:00:00.000Z',
      sites: [runway({ has_live_run: true })],
      alarms: [alarm({ has_live_run: true })],
    });
    const body = await (await GET()).json();
    expect(body.items).toEqual([]);
    // The site is still reported, so the low runway stays visible even while suppressed.
    expect(body.runway.low_runway_count).toBe(1);
    expect(body.runway.sites).toHaveLength(1);
  });

  it('does NOT re-queue a re-evaluation while the alarm task from last time is still open', async () => {
    // Without this the worker refiles the same ask every tick for as long as the site stays dry.
    mockRunFindMany.mockResolvedValue([]);
    mockRunwayReport.mockResolvedValue({
      generated_at: '2026-09-10T12:00:00.000Z',
      sites: [runway({ has_open_alarm_task: true })],
      alarms: [alarm({ has_open_alarm_task: true })],
    });
    const body = await (await GET()).json();
    expect(body.items).toEqual([]);
    expect(body.runway.low_runway_count).toBe(1);
  });

  it('queues nothing when every watched site has runway left', async () => {
    mockRunFindMany.mockResolvedValue([]);
    mockRunwayReport.mockResolvedValue({
      generated_at: '2026-09-10T12:00:00.000Z',
      sites: [runway({ shelf_count: 10, runway_days: 70, low_runway: false })],
      alarms: [],
    });
    const body = await (await GET()).json();
    expect(body.items).toEqual([]);
    expect(body.runway.low_runway_count).toBe(0);
  });

  it('sorts a site that is already dry ahead of one that still has weeks left', async () => {
    mockRunFindMany.mockResolvedValue([]);
    mockRunwayReport.mockResolvedValue({
      generated_at: '2026-09-10T12:00:00.000Z',
      sites: [],
      alarms: [
        alarm({ site_id: 'site-3', site_name: 'later.com', runway_end: '2026-10-01' }),
        alarm({ site_id: 'site-2', site_name: 'botanicaldream.com', runway_end: '2026-09-10' }),
      ],
    });
    const body = await (await GET()).json();
    expect(body.items.map((i: { site: { name: string } }) => i.site.name)).toEqual([
      'botanicaldream.com',
      'later.com',
    ]);
  });

  it('still reports the runway block when there is ordinary article work to do', async () => {
    mockRunFindMany.mockResolvedValue([run('publishing', [article({ status: 'approved' })])]);
    const body = await (await GET()).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].action).toBe('publish_article');
    expect(body.runway).toEqual({ low_runway_count: 0, sites: [] });
  });
});
