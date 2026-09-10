import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    troubadorSchedule: { findMany: vi.fn() },
    troubadorRun: { findMany: vi.fn() },
    article: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    clientContact: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { getRunwayReport } from '../troubador-runway';

const mockSchedules = prisma.troubadorSchedule.findMany as Mock;
const mockRuns = prisma.troubadorRun.findMany as Mock;
const mockArticles = prisma.article.findMany as Mock;
const mockSites = prisma.site.findMany as Mock;
const mockContacts = prisma.clientContact.findMany as Mock;
const mockTasks = prisma.task.findMany as Mock;
const mockClients = prisma.client.findMany as Mock;

const NOW = new Date('2026-09-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const SITE = {
  id: 'site-1',
  name: 'botanicaldream.com',
  client: { id: 'client-1', name: 'Herba' },
};

function article(overrides: Record<string, unknown> = {}) {
  return {
    site_id: 'site-1',
    client_id: 'client-1',
    status: 'approved',
    scheduled_date: null,
    published_url: null,
    updated_at: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSchedules.mockResolvedValue([]);
  mockRuns.mockResolvedValue([]);
  mockArticles.mockResolvedValue([]);
  mockSites.mockResolvedValue([SITE]);
  mockContacts.mockResolvedValue([]);
  mockTasks.mockResolvedValue([]);
  mockClients.mockResolvedValue([{ id: 'client-1', name: 'Herba' }]);
});

describe('getRunwayReport — which sites are watched', () => {
  it('watches nothing, and touches no site table, when Troubador has no state at all', async () => {
    const report = await getRunwayReport(NOW);
    expect(report.sites).toEqual([]);
    expect(report.alarms).toEqual([]);
    expect(mockSites).not.toHaveBeenCalled();
  });

  it('watches a site whose runs have ALL finished but which published recently', async () => {
    // The exact blind spot: the run-driven work queue sees nothing here, because a run in
    // `done` is out of its scan. A site that just ran dry looks identical to a dead one.
    mockArticles.mockResolvedValue([
      article({
        status: 'published',
        published_url: 'https://botanicaldream.com/sleep-tea',
        scheduled_date: new Date(NOW.getTime() - 3 * DAY),
      }),
    ]);
    const report = await getRunwayReport(NOW);
    expect(report.sites).toHaveLength(1);
    expect(report.sites[0].shelf_count).toBe(0);
    expect(report.sites[0].low_runway).toBe(true);
    expect(report.sites[0].has_live_run).toBe(false);
  });

  it('ages a long-finished site off the alarm instead of nagging forever', async () => {
    mockArticles.mockResolvedValue([
      article({
        status: 'published',
        published_url: 'https://old/1',
        scheduled_date: new Date(NOW.getTime() - 200 * DAY),
      }),
    ]);
    const report = await getRunwayReport(NOW);
    expect(report.sites).toEqual([]);
    expect(report.alarms).toEqual([]);
  });

  it('watches a site with an active schedule even when it has no articles yet', async () => {
    mockSchedules.mockResolvedValue([
      { site_id: 'site-1', publish_per_week: 1, lead_time_days: 14, updated_at: NOW },
    ]);
    const report = await getRunwayReport(NOW);
    expect(report.sites).toHaveLength(1);
    expect(report.sites[0].cadence_source).toBe('schedule');
    expect(report.sites[0].publish_per_week).toBe(1);
    expect(report.sites[0].trigger_days).toBe(21);
  });

  it('watches a site with a live run and marks it as already re-evaluating', async () => {
    mockRuns.mockResolvedValue([{ site_id: 'site-1' }]);
    const report = await getRunwayReport(NOW);
    expect(report.sites[0].has_live_run).toBe(true);
    expect(report.sites[0].has_open_alarm_task).toBe(false);
  });

  it('marks a site whose runway task is still open', async () => {
    mockRuns.mockResolvedValue([{ site_id: 'site-1' }]);
    mockTasks.mockResolvedValue([{ site_id: 'site-1' }]);
    const report = await getRunwayReport(NOW);
    expect(report.sites[0].has_open_alarm_task).toBe(true);
    // Still an alarm — the runway is still low. Only the queue item is suppressed.
    expect(report.alarms).toHaveLength(1);
  });

  it('ignores a runway task that carries no site', async () => {
    mockRuns.mockResolvedValue([{ site_id: 'site-1' }]);
    mockTasks.mockResolvedValue([{ site_id: null }]);
    const report = await getRunwayReport(NOW);
    expect(report.sites[0].has_open_alarm_task).toBe(false);
  });

  it('keeps the most recently updated schedule when a site somehow has several', async () => {
    mockSchedules.mockResolvedValue([
      { site_id: 'site-1', publish_per_week: 3, lead_time_days: 5, updated_at: NOW },
      { site_id: 'site-1', publish_per_week: 1, lead_time_days: 30, updated_at: new Date('2020-01-01') },
    ]);
    const report = await getRunwayReport(NOW);
    expect(report.sites[0].publish_per_week).toBe(3);
    expect(report.sites[0].lead_time_days).toBe(5);
  });
});

describe('getRunwayReport — alarms and drafts', () => {
  it('drafts a meeting request addressed to the primary contact for a dry site', async () => {
    mockRuns.mockResolvedValue([{ site_id: 'site-1' }]);
    mockContacts.mockResolvedValue([{ client_id: 'client-1', name: 'Dan Whitfield' }]);
    const report = await getRunwayReport(NOW);
    expect(report.alarms).toHaveLength(1);
    expect(report.alarms[0].meeting_request_draft.to_client.body).toContain('Hi Dan,');
    expect(report.alarms[0].meeting_request_draft.to_client.subject).toContain('Herba');
  });

  it('raises no alarm and looks up no contact when every site has runway', async () => {
    mockSchedules.mockResolvedValue([
      { site_id: 'site-1', publish_per_week: 1, lead_time_days: 7, updated_at: NOW },
    ]);
    mockArticles.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) =>
        article({ status: 'scheduled', scheduled_date: new Date(NOW.getTime() + (i + 1) * DAY) }),
      ),
    );
    const report = await getRunwayReport(NOW);
    expect(report.sites[0].runway_days).toBe(42);
    expect(report.sites[0].low_runway).toBe(false);
    expect(report.alarms).toEqual([]);
    expect(mockContacts).not.toHaveBeenCalled();
  });

  it('orders sites by how soon they run out', async () => {
    const SITE_2 = { id: 'site-2', name: 'kratomnewstoday.com', client: { id: 'client-1', name: 'Herba' } };
    mockSchedules.mockResolvedValue([
      { site_id: 'site-1', publish_per_week: 1, lead_time_days: 7, updated_at: NOW },
      { site_id: 'site-2', publish_per_week: 1, lead_time_days: 7, updated_at: NOW },
    ]);
    mockSites.mockResolvedValue([SITE, SITE_2]);
    mockArticles.mockResolvedValue([
      article({ site_id: 'site-1', scheduled_date: new Date(NOW.getTime() + DAY) }),
      article({ site_id: 'site-1', scheduled_date: new Date(NOW.getTime() + 2 * DAY) }),
      article({ site_id: 'site-2', scheduled_date: new Date(NOW.getTime() + DAY) }),
    ]);
    const report = await getRunwayReport(NOW);
    expect(report.sites.map((s) => s.site_name)).toEqual([
      'kratomnewstoday.com',
      'botanicaldream.com',
    ]);
  });

  it('never mixes one site’s articles into another’s runway', async () => {
    const SITE_2 = { id: 'site-2', name: 'kratomnewstoday.com', client: { id: 'client-1', name: 'Herba' } };
    mockRuns.mockResolvedValue([{ site_id: 'site-1' }, { site_id: 'site-2' }]);
    mockSites.mockResolvedValue([SITE, SITE_2]);
    mockArticles.mockResolvedValue([
      article({ site_id: 'site-2', scheduled_date: new Date(NOW.getTime() + DAY) }),
    ]);
    const report = await getRunwayReport(NOW);
    const bySite = Object.fromEntries(report.sites.map((s) => [s.site_name, s.shelf_count]));
    expect(bySite['botanicaldream.com']).toBe(0);
    expect(bySite['kratomnewstoday.com']).toBe(1);
  });
});

describe('getRunwayReport — what it refuses to load', () => {
  it('excludes soft-deleted sites, which keep their schedules and articles', async () => {
    // Deleting a site does not cascade to Troubador state, so without this filter a torn-down
    // engagement keeps alarming and keeps drafting notes to its former client.
    mockRuns.mockResolvedValue([{ site_id: 'site-1', client_id: 'client-1' }]);
    await getRunwayReport(NOW);
    expect(mockSites).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ is_deleted: false }) }),
    );
  });

  it('bounds the published-article scan to the recency window it is used for', async () => {
    mockRuns.mockResolvedValue([{ site_id: 'site-1', client_id: 'client-1' }]);
    await getRunwayReport(NOW);
    const where = mockArticles.mock.calls[0][0].where;
    const publishedClause = where.OR.find((c: { status?: string }) => c.status === 'published');
    expect(publishedClause).toBeDefined();
    const cutoff = new Date(NOW.getTime() - 90 * DAY);
    expect(publishedClause.OR).toEqual([
      { updated_at: { gte: cutoff } },
      { scheduled_date: { gte: cutoff } },
    ]);
  });
});

describe('getRunwayReport — whose client this is', () => {
  it("takes the client from Troubador's own rows, not from the site record", async () => {
    // A schedule is created with an explicit client_id that is never checked against the site,
    // and a site may carry no client at all.
    mockSites.mockResolvedValue([{ id: 'site-1', name: 'botanicaldream.com', client: null }]);
    mockSchedules.mockResolvedValue([
      { site_id: 'site-1', client_id: 'client-1', publish_per_week: 1, lead_time_days: 14, updated_at: NOW },
    ]);
    const report = await getRunwayReport(NOW);
    expect(report.sites[0].client_id).toBe('client-1');
    expect(report.sites[0].client_name).toBe('Herba');
    expect(report.alarms[0].meeting_request_draft.to_client.subject).toContain('Herba');
  });

  it('prefers the schedule client over an article client when they disagree', async () => {
    mockSchedules.mockResolvedValue([
      { site_id: 'site-1', client_id: 'client-1', publish_per_week: 1, lead_time_days: 14, updated_at: NOW },
    ]);
    mockArticles.mockResolvedValue([article({ client_id: 'client-stale' })]);
    mockClients.mockResolvedValue([{ id: 'client-1', name: 'Herba' }]);
    const report = await getRunwayReport(NOW);
    expect(report.sites[0].client_id).toBe('client-1');
  });

  it('falls back to the site record when Troubador carries no client', async () => {
    mockSchedules.mockResolvedValue([
      { site_id: 'site-1', client_id: null, publish_per_week: 1, lead_time_days: 14, updated_at: NOW },
    ]);
    mockSites.mockResolvedValue([
      { id: 'site-1', name: 'botanicaldream.com', client: { id: 'client-site', name: 'From the site record' } },
    ]);
    const report = await getRunwayReport(NOW);
    expect(report.sites[0].client_id).toBe('client-site');
    expect(report.sites[0].client_name).toBe('From the site record');
  });
});
