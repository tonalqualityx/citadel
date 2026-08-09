import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { formatSiteStatsForClient } from '@/lib/api/client-projections';

// GET /api/portal/stats (Portal v2 phase 1)
// The logged-in client's latest stats snapshot per site — leads/traffic/rankings/uptime, shaped
// for the researched hierarchy (leads on top, traffic middle, rankings/health bottom). Requires a
// client_session cookie; scope is implicit via the session's client_id, never from input.
//
// "Latest" = the most recently captured_at snapshot per site, regardless of period (a collector
// may push daily AND monthly snapshots; the freshest one wins for the headline read). Sites with
// no snapshot yet are simply omitted — the frontend renders a quiet placeholder for those, no
// fake/zeroed data is synthesized here.
export async function GET(_request: NextRequest) {
  try {
    const session = await requireClientAuth();

    const sites = await prisma.site.findMany({
      where: { client_id: session.clientId, is_deleted: false },
      select: { id: true, name: true },
    });

    if (sites.length === 0) {
      return NextResponse.json({ sites: [] });
    }

    const siteIds = sites.map((s) => s.id);

    // Latest snapshot per site: fetch each site's most recent row directly rather than a window
    // function (Prisma has no native "distinct on ordered" for this shape without $queryRaw;
    // per-client site counts are small, so N small queries in parallel is simpler and safe).
    const latestSnapshots = await Promise.all(
      siteIds.map((siteId) =>
        prisma.siteStatsSnapshot.findFirst({
          where: { site_id: siteId },
          orderBy: { captured_at: 'desc' },
          select: { site_id: true, captured_at: true, period: true, payload: true, source: true },
        })
      )
    );

    const bySiteId = new Map(latestSnapshots.filter(Boolean).map((snap) => [snap!.site_id, snap!]));

    const result = sites
      .filter((site) => bySiteId.has(site.id))
      .map((site) => ({
        site: { id: site.id, name: site.name },
        ...formatSiteStatsForClient(bySiteId.get(site.id)!),
      }));

    return NextResponse.json({ sites: result });
  } catch (error) {
    return handleApiError(error);
  }
}
