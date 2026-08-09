import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import {
  formatArticleForClient,
  formatTaskForClient,
  formatSiteStatsForClient,
} from '@/lib/api/client-projections';

const ARTICLE_COMMENT_SELECT = {
  where: { is_deleted: false },
  orderBy: { created_at: 'asc' as const },
  select: {
    id: true,
    content: true,
    created_at: true,
    user: { select: { name: true } },
  },
};

const RECENT_ACTIVITY_LIMIT = 15;

// GET /api/portal/home (Portal v2 phase 1)
// One payload for the client account home: identity, pending approvals (articles + tasks),
// open/active projects, an open-amount billing summary, a derived recent-activity feed, and the
// latest stats snapshot per site. Requires a client_session cookie; every query is scoped to the
// session's client_id (never from input) — same isolation model as every other portal route.
//
// Reuses the SAME client-safe projections as the standalone endpoints (formatArticleForClient,
// formatTaskForClient, formatSiteStatsForClient) rather than inventing home-specific shapes, so a
// field that's hidden everywhere else in the portal can't accidentally leak here.
export async function GET(_request: NextRequest) {
  try {
    const session = await requireClientAuth();
    const clientId = session.clientId;

    const taskScope = {
      is_deleted: false,
      OR: [{ client_id: clientId }, { site: { client_id: clientId } }],
    };

    const [
      client,
      pendingArticles,
      pendingTasks,
      openProjects,
      unbilledTaskAgg,
      triggeredMilestoneAgg,
      recentDoneOrApprovedTasks,
      recentPublishedArticles,
      sites,
    ] = await Promise.all([
      prisma.client.findFirst({
        where: { id: clientId, is_deleted: false },
        select: { id: true, name: true },
      }),
      // Pending approvals — articles: in_review, WITH the full comment thread (same shape as the
      // single-article C4 screen), not the light list-only projection GET /api/portal/articles uses.
      prisma.article.findMany({
        where: { client_id: clientId, status: 'in_review', is_deleted: false },
        select: {
          id: true,
          title: true,
          status: true,
          body: true,
          created_at: true,
          updated_at: true,
          comments: ARTICLE_COMMENT_SELECT,
        },
        orderBy: { updated_at: 'desc' },
      }),
      // Pending approvals — tasks awaiting the client's own approval, with staging preview.
      prisma.task.findMany({
        where: { ...taskScope, client_approved_at: null },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          estimated_minutes: true,
          staging_preview_url: true,
          staging_deployed_at: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { updated_at: 'desc' },
        take: 25,
      }),
      // Open/active projects (queue/quote are pre-kickoff internal stages, done/suspended/
      // cancelled are closed out — neither belongs on the account home).
      prisma.project.findMany({
        where: { client_id: clientId, is_deleted: false, status: { in: ['ready', 'in_progress', 'review'] } },
        select: { id: true, name: true, status: true, target_date: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
      }),
      // Open/unbilled amount — Task side. There is no Invoice model in this schema; "open" is
      // computed directly from billing-eligible, not-yet-invoiced work. Amount + count only.
      prisma.task.aggregate({
        where: { ...taskScope, is_billable: true, invoiced: false, billing_amount: { not: null } },
        _sum: { billing_amount: true },
        _count: true,
      }),
      // Open/unbilled amount — Milestone side ('triggered' = ready to invoice, not yet invoiced).
      prisma.milestone.aggregate({
        where: { billing_status: 'triggered', project: { client_id: clientId, is_deleted: false } },
        _sum: { billing_amount: true },
        _count: true,
      }),
      // Recent activity, derived (not read from ActivityLog — see lib/services/portal.ts /
      // implementation/plans/portal-v2-phase1.md for why): recently done or client-approved tasks.
      // NOTE: taskScope already carries its own OR (client_id/site.client_id) — combine via AND
      // rather than spreading a second OR over it, which would silently overwrite the scope filter.
      prisma.task.findMany({
        where: {
          is_deleted: false,
          AND: [
            { OR: taskScope.OR },
            { OR: [{ status: 'done' }, { client_approved_at: { not: null } }] },
          ],
        },
        select: { id: true, title: true, status: true, client_approved_at: true, completed_at: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
      }),
      prisma.article.findMany({
        where: { client_id: clientId, status: 'published', is_deleted: false },
        select: { id: true, title: true, published_url: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
      }),
      prisma.site.findMany({
        where: { client_id: clientId, is_deleted: false },
        select: { id: true, name: true },
      }),
    ]);

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Latest stats snapshot per site — same read as GET /api/portal/stats, embedded here so the
    // home page needs one round trip. Sites with no snapshot yet are simply omitted.
    const latestSnapshots = sites.length
      ? await Promise.all(
          sites.map((site) =>
            prisma.siteStatsSnapshot.findFirst({
              where: { site_id: site.id },
              orderBy: { captured_at: 'desc' },
              select: { site_id: true, captured_at: true, period: true, payload: true },
            })
          )
        )
      : [];
    const snapshotBySiteId = new Map(latestSnapshots.filter(Boolean).map((s) => [s!.site_id, s!]));
    const stats = sites
      .filter((site) => snapshotBySiteId.has(site.id))
      .map((site) => ({
        site: { id: site.id, name: site.name },
        ...formatSiteStatsForClient(snapshotBySiteId.get(site.id)!),
      }));

    const openAmount =
      Number(unbilledTaskAgg._sum.billing_amount ?? 0) + Number(triggeredMilestoneAgg._sum.billing_amount ?? 0);
    const openCount = unbilledTaskAgg._count + triggeredMilestoneAgg._count;

    const activity = [
      ...recentDoneOrApprovedTasks.map((task) => ({
        type: task.client_approved_at ? ('task_approved' as const) : ('task_completed' as const),
        id: task.id,
        title: task.title,
        at: task.client_approved_at ?? task.completed_at ?? task.updated_at,
      })),
      ...recentPublishedArticles.map((article) => ({
        type: 'article_published' as const,
        id: article.id,
        title: article.title,
        url: article.published_url,
        at: article.updated_at,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, RECENT_ACTIVITY_LIMIT);

    return NextResponse.json({
      client,
      pending_approvals: {
        articles: pendingArticles.map(formatArticleForClient),
        tasks: pendingTasks.map((task) => ({
          ...formatTaskForClient(task),
          staging_preview_url: task.staging_preview_url,
          staging_deployed_at: task.staging_deployed_at,
        })),
      },
      projects: openProjects,
      billing: { open_amount: openAmount, open_count: openCount },
      activity,
      stats,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
