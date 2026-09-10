import { prisma } from '@/lib/db/prisma';
import {
  LIVE_RUN_STAGES,
  OPEN_TASK_STATUSES,
  RECENTLY_ACTIVE_DAYS,
  RUNWAY_TASK_TAG,
  computeSiteRunway,
  isRecentlyActive,
  renderMeetingRequestDraft,
  type MeetingRequestDraft,
  type SiteRunway,
} from '@/lib/troubador/runway';

export interface RunwayAlarm {
  runway: SiteRunway;
  /** Drafted, never sent. A human approves it before a client ever sees it. */
  meeting_request_draft: MeetingRequestDraft;
}

export interface RunwayReport {
  generated_at: string;
  sites: SiteRunway[];
  alarms: RunwayAlarm[];
}

// The shelf plus the parked backlog. Everything still being written is not runway, and published
// copy is loaded separately because it is only evidence the site was recently active.
const SHELF_AND_BACKLOG_STATUSES = ['approved', 'scheduled', 'postponed'] as const;

/** Best-guess publish date for a published article: the date it was scheduled for, else
 *  whenever the row last changed. Article carries no dedicated published_at column. */
function publishedAt(a: { scheduled_date: Date | null; updated_at: Date }): Date {
  return a.scheduled_date ?? a.updated_at;
}

/**
 * Per-site content runway across every site Troubador is still responsible for.
 *
 * Site-driven on purpose. The work queue scans runs, so a site whose every run has reached
 * `done` disappears from it entirely — which is the exact shape of a site that has run out of
 * content. Watching sites instead of runs is what makes an empty shelf visible.
 */
export async function getRunwayReport(now: Date = new Date()): Promise<RunwayReport> {
  const recencyCutoff = new Date(now.getTime() - RECENTLY_ACTIVE_DAYS * 24 * 60 * 60 * 1000);

  const [schedules, runs, articles, openAlarmTasks] = await Promise.all([
    prisma.troubadorSchedule.findMany({
      where: { is_deleted: false, status: 'active' },
      select: {
        site_id: true,
        client_id: true,
        publish_per_week: true,
        lead_time_days: true,
        updated_at: true,
      },
      orderBy: { updated_at: 'desc' },
    }),
    prisma.troubadorRun.findMany({
      where: { is_deleted: false, stage: { in: [...LIVE_RUN_STAGES] } },
      select: { site_id: true, client_id: true },
    }),
    // The shelf and the parked backlog are small and always loaded. Published copy is loaded
    // only as evidence a site was recently active, so it is bounded by that same window —
    // otherwise this query grows with the whole publishing history and runs on every poll.
    prisma.article.findMany({
      where: {
        is_deleted: false,
        OR: [
          { status: { in: [...SHELF_AND_BACKLOG_STATUSES] } },
          {
            status: 'published',
            OR: [{ updated_at: { gte: recencyCutoff } }, { scheduled_date: { gte: recencyCutoff } }],
          },
        ],
      },
      select: {
        site_id: true,
        client_id: true,
        status: true,
        scheduled_date: true,
        published_url: true,
        updated_at: true,
      },
    }),
    // The alarm's own follow-up tasks. An open one means the ask has already been raised for
    // that site, so nothing should raise it again until a human closes it.
    prisma.task.findMany({
      where: {
        is_deleted: false,
        status: { in: [...OPEN_TASK_STATUSES] },
        tags: { has: RUNWAY_TASK_TAG },
        site_id: { not: null },
      },
      select: { site_id: true },
    }),
  ]);

  // Most recently updated active schedule wins if a site somehow carries several.
  const cadenceBySite = new Map<string, { publish_per_week: number | null; lead_time_days: number }>();
  for (const s of schedules) {
    if (cadenceBySite.has(s.site_id)) continue;
    cadenceBySite.set(s.site_id, {
      publish_per_week: s.publish_per_week == null ? null : Number(s.publish_per_week),
      lead_time_days: s.lead_time_days,
    });
  }

  const liveRunSites = new Set(runs.map((r) => r.site_id));

  // Whose client this is comes from Troubador's own rows, not from Site.client_id. A site may
  // carry no client at all, or a different one: schedules are created with an explicit client_id
  // that is never checked against the site. Schedule wins, then a live run, then an article.
  const clientIdBySite = new Map<string, string>();
  for (const row of [...articles, ...runs, ...schedules]) {
    if (row.client_id) clientIdBySite.set(row.site_id, row.client_id);
  }
  const alarmedSites = new Set(
    openAlarmTasks.map((t) => t.site_id).filter((id): id is string => id != null),
  );

  const articlesBySite = new Map<string, typeof articles>();
  for (const a of articles) {
    const list = articlesBySite.get(a.site_id);
    if (list) list.push(a);
    else articlesBySite.set(a.site_id, [a]);
  }

  // A site is watched when it has an active schedule, a cycle still in flight, or copy it
  // published recently. The last clause both catches a site that just ran dry and lets a
  // finished engagement age off the alarm instead of nagging forever.
  const watched = new Set<string>([...cadenceBySite.keys(), ...liveRunSites]);
  for (const [siteId, list] of articlesBySite) {
    if (watched.has(siteId)) continue;
    if (list.some((a) => a.status === 'published' && isRecentlyActive(publishedAt(a), now))) {
      watched.add(siteId);
    }
  }

  if (watched.size === 0) {
    return { generated_at: now.toISOString(), sites: [], alarms: [] };
  }

  const [sites, clients] = await Promise.all([
    prisma.site.findMany({
      // A soft-deleted site keeps its schedules, runs and articles — nothing cascades — so
      // without this filter a torn-down engagement still alarms and still drafts a client note.
      where: { id: { in: [...watched] }, is_deleted: false },
      select: { id: true, name: true, client: { select: { id: true, name: true } } },
    }),
    prisma.client.findMany({
      where: { id: { in: [...new Set(clientIdBySite.values())] } },
      select: { id: true, name: true },
    }),
  ]);

  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

  const runways: SiteRunway[] = sites.map((site) => {
    const troubadorClientId = clientIdBySite.get(site.id);
    const client = troubadorClientId
      ? { id: troubadorClientId, name: clientNameById.get(troubadorClientId) ?? site.client?.name ?? '' }
      : { id: site.client?.id ?? '', name: site.client?.name ?? '' };

    return computeSiteRunway({
      site: { id: site.id, name: site.name },
      client,
      articles: articlesBySite.get(site.id) ?? [],
      cadence: cadenceBySite.get(site.id) ?? null,
      hasLiveRun: liveRunSites.has(site.id),
      hasOpenAlarmTask: alarmedSites.has(site.id),
      now,
    });
  });

  runways.sort((a, b) => a.runway_days - b.runway_days || a.site_name.localeCompare(b.site_name));

  const low = runways.filter((r) => r.low_runway);
  let alarms: RunwayAlarm[] = [];

  if (low.length > 0) {
    const contacts = await prisma.clientContact.findMany({
      where: {
        is_deleted: false,
        is_primary: true,
        client_id: { in: [...new Set(low.map((r) => r.client_id).filter(Boolean))] },
      },
      select: { client_id: true, name: true },
    });
    const firstNameByClient = new Map<string, string | null>();
    for (const c of contacts) {
      if (firstNameByClient.has(c.client_id)) continue;
      firstNameByClient.set(c.client_id, c.name ? c.name.trim().split(/\s+/)[0] : null);
    }

    alarms = low.map((runway) => ({
      runway,
      meeting_request_draft: renderMeetingRequestDraft(runway, {
        contactFirstName: firstNameByClient.get(runway.client_id) ?? null,
        now,
      }),
    }));
  }

  return { generated_at: now.toISOString(), sites: runways, alarms };
}

export { RECENTLY_ACTIVE_DAYS, RUNWAY_TASK_TAG };
