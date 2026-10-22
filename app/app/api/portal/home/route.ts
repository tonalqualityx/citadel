import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import {
  canSeeAnalytics,
  canSeeBilling,
  loadPortalAccess,
  projectAccessScope,
  projectAccessWhere,
  taskAccessWhere,
} from '@/lib/portal/access';
import { clientHistoryTaskWhere, clientVisibleTaskWhere, stagedTaskWhere } from '@/lib/portal/visibility';
import { projectStatusLabel, REQUEST_LABELS } from '@/lib/portal/status-labels';
import { loadRequests } from '@/lib/portal/requests';
import { loadRetainers } from '@/lib/portal/retainer';
import { CLIENT_VISIBLE_COMMENT_WHERE } from '@/lib/comments/visibility';
import {
  AWAITING_CLARIFICATION_TAG,
  buildPhaseList,
  computeProgress,
  currentPhaseName,
  reviewLink,
  toClientLinks,
  toClientRequest,
  type ViewTask,
} from '@/lib/portal/project-view';
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

/** Request states already shown under "Needs from you" (staged approvals and open questions). */
const NEEDS_YOU_LABELS: string[] = [REQUEST_LABELS.review, REQUEST_LABELS.answer];

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
    // A3: role on the active client, re-checked per request. Project-only contacts (role none)
    // see only the projects and tasks they were granted, no articles, billing or stats.
    const access = await loadPortalAccess(session);
    const clientLevel = access.role !== 'none';
    const showBilling = canSeeBilling(access.role);
    const showAnalytics = canSeeAnalytics(access.role);

    const taskScope = {
      is_deleted: false,
      OR: [{ client_id: clientId }, { site: { client_id: clientId } }],
    };
    const taskAccess = taskAccessWhere(access);

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
      questionTasks,
    ] = await Promise.all([
      prisma.client.findFirst({
        where: { id: clientId, is_deleted: false },
        select: { id: true, name: true, qbo_customer_id: true },
      }),
      // Pending approvals — articles: in_review, WITH the full comment thread (same shape as the
      // single-article C4 screen), not the light list-only projection GET /api/portal/articles uses.
      prisma.article.findMany({
        where: { client_id: clientId, status: 'in_review', is_deleted: false, ...(clientLevel ? {} : { id: { in: [] } }) },
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
        // Leak 1: only client-visible AND staged work is "waiting on your review".
        where: { ...taskScope, client_approved_at: null, NOT: { tags: { has: 'client-approved' } }, AND: [clientVisibleTaskWhere(), stagedTaskWhere(), taskAccess] },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
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
        where: { ...projectAccessWhere(access), status: { in: ['ready', 'in_progress', 'review'] } },
        select: { id: true, name: true, status: true, target_date: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
      }),
      // Open/unbilled amount — Task side. There is no Invoice model in this schema; "open" is
      // computed directly from billing-eligible, not-yet-invoiced work. Amount + count only.
      // Billing is owner-only (A3), and only counts work the client may see (A1 visibility rule)
      // so internal tasks never inflate the client's balance. Skipped entirely for other roles.
      showBilling
        ? prisma.task.aggregate({
            where: {
              ...taskScope,
              is_billable: true,
              invoiced: false,
              billing_amount: { not: null },
              AND: [clientVisibleTaskWhere(), taskAccess],
            },
            _sum: { billing_amount: true },
            _count: true,
          })
        : Promise.resolve(null),
      // Open/unbilled amount — Milestone side ('triggered' = ready to invoice, not yet invoiced).
      showBilling
        ? prisma.milestone.aggregate({
            // Hidden means nobody (owners included), so milestones on hidden/ungranted projects are
            // not counted. Mike may rule otherwise (money owed on a hidden project).
            where: {
              billing_status: 'triggered',
              project: { client_id: clientId, is_deleted: false, AND: [projectAccessScope(access)] },
            },
            _sum: { billing_amount: true },
            _count: true,
          })
        : Promise.resolve(null),
      // Recent activity, derived (not read from ActivityLog — see lib/services/portal.ts /
      // implementation/plans/portal-v2-phase1.md for why): recently done or client-approved tasks.
      // NOTE: taskScope already carries its own OR (client_id/site.client_id) — combine via AND
      // rather than spreading a second OR over it, which would silently overwrite the scope filter.
      prisma.task.findMany({
        where: {
          is_deleted: false,
          AND: [
            { OR: taskScope.OR },
            clientHistoryTaskWhere(),
            taskAccess,
            // Staged-but-unapproved work is finished on our side but not yet the client's yes: keep it out.
            { OR: [{ status: 'done', NOT: stagedTaskWhere() }, { client_approved_at: { not: null } }] },
          ],
        },
        select: { id: true, title: true, status: true, client_approved_at: true, completed_at: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
      }),
      prisma.article.findMany({
        where: { client_id: clientId, status: 'published', is_deleted: false, ...(clientLevel ? {} : { id: { in: [] } }) },
        select: { id: true, title: true, published_url: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
      }),
      prisma.site.findMany({
        where: { client_id: clientId, is_deleted: false, ...(showAnalytics ? {} : { id: { in: [] } }) },
        select: { id: true, name: true },
      }),
      // Open questions: client-visible tasks tagged awaiting-clarification, with the newest
      // client-visible comment as the question. Internal comments never selected.
      prisma.task.findMany({
        where: {
          ...taskScope,
          tags: { has: AWAITING_CLARIFICATION_TAG },
          status: { notIn: ['done', 'abandoned'] },
          client_approved_at: null,
          AND: [clientVisibleTaskWhere(), taskAccess],
        },
        select: {
          id: true,
          title: true,
          comments: {
            where: { is_deleted: false, ...CLIENT_VISIBLE_COMMENT_WHERE, client_question: true },
            orderBy: { created_at: 'desc' },
            take: 5,
            select: {
              content: true,
              created_at: true,
              is_internal: true,
              client_question: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
        orderBy: { updated_at: 'desc' },
        take: 25,
      }),
    ]);

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Requests (portal phase B slice 1): the open count and the top three, attention first.
    // Loaded after the queries above so their order is unchanged.
    const requests = await loadRequests(access);
    // Retainers (slice 2): one summary row per active or paused plan, the three newest open items.
    const retainerCards = await loadRetainers(access);

    // Per-project progress, current phase and client links. One query each for all open projects.
    const projectIds = openProjects.map((p) => p.id);
    const [progressRows, phaseRows, linkRows] = projectIds.length
      ? await Promise.all([
          prisma.task.findMany({
            where: { is_deleted: false, project_id: { in: projectIds }, AND: [clientHistoryTaskWhere(), taskAccess] },
            select: {
              id: true,
              title: true,
              project_id: true,
              phase_id: true,
              status: true,
              completed_at: true,
              requested_by_contact_id: true,
              client_visible: true,
              staging_preview_url: true,
              approved: true,
              client_approved_at: true,
            },
          }),
          prisma.projectPhase.findMany({
            where: { project_id: { in: projectIds } },
            select: { id: true, project_id: true, name: true, sort_order: true },
          }),
          prisma.resourceLink.findMany({
            where: { project_id: { in: projectIds }, is_deleted: false },
            select: { project_id: true, name: true, url: true, icon: true },
            orderBy: { sort_order: 'asc' },
          }),
        ])
      : [[], [], []];
    const projectCards = openProjects.map((project) => {
      const tasks = progressRows.filter((t) => t.project_id === project.id) as unknown as ViewTask[];
      const phases = buildPhaseList(
        phaseRows.filter((ph) => ph.project_id === project.id),
        tasks
      );
      const links = toClientLinks(linkRows.filter((l) => l.project_id === project.id));
      return {
        id: project.id,
        name: project.name,
        status_label: projectStatusLabel(project.status),
        target_date: project.target_date,
        updated_at: project.updated_at,
        progress: computeProgress(tasks),
        current_phase: currentPhaseName(phases),
        // Phase track for the home card: the same list the project page builds (done, current, upcoming).
        phases: phases.map((ph) => ({ name: ph.name, state: ph.state })),
        // Review-surface link for open questions (no per-person token). Null shows a placeholder.
        review_link: reviewLink(links),
        links,
      };
    });

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

    // Billing (owners only). A client mapped to QuickBooks shows its REAL open invoices (the
    // ClientInvoice mirror); only an unmapped client falls back to Citadel's unbilled-work summary,
    // labelled as such so it is never mistaken for an invoice balance.
    let billing:
      | {
          source: 'quickbooks' | 'unbilled_work';
          label: string | null;
          open_amount: number;
          open_count: number;
          oldest_due_date: string | null;
          invoices: {
            id: string;
            number: string | null;
            date: string;
            due_date: string | null;
            balance: number;
            overdue: boolean;
            pay_link: string | null;
          }[];
        }
      | null = null;
    if (showBilling && client.qbo_customer_id) {
      const rows = await prisma.clientInvoice.findMany({
        where: { client_id: clientId, status: { in: ['open', 'overdue'] }, balance: { gt: 0 } },
        orderBy: [{ due_date: 'asc' }, { txn_date: 'asc' }],
        select: { id: true, doc_number: true, txn_date: true, due_date: true, balance: true, pay_link: true },
      });
      const today = new Date().toISOString().slice(0, 10);
      const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
      const invoices = rows.map((r) => ({
        id: r.id,
        number: r.doc_number,
        date: iso(r.txn_date) as string,
        due_date: iso(r.due_date),
        balance: Number(r.balance),
        overdue: Boolean(r.due_date && iso(r.due_date)! < today),
        pay_link: r.pay_link,
      }));
      const dues = invoices.map((i) => i.due_date).filter((d): d is string => Boolean(d)).sort();
      billing = {
        source: 'quickbooks',
        label: null,
        open_amount: Math.round(invoices.reduce((sum, i) => sum + i.balance, 0) * 100) / 100,
        open_count: invoices.length,
        oldest_due_date: dues[0] ?? null,
        invoices,
      };
    } else if (unbilledTaskAgg && triggeredMilestoneAgg) {
      billing = {
        source: 'unbilled_work',
        label: 'Work not yet invoiced',
        open_amount:
          Number(unbilledTaskAgg._sum.billing_amount ?? 0) + Number(triggeredMilestoneAgg._sum.billing_amount ?? 0),
        open_count: unbilledTaskAgg._count + triggeredMilestoneAgg._count,
        oldest_due_date: null,
        invoices: [],
      };
    }

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
      client: { id: client.id, name: client.name },
      pending_approvals: {
        articles: pendingArticles.map(formatArticleForClient),
        tasks: pendingTasks.map((task) => ({
          ...formatTaskForClient(task),
          staging_preview_url: task.staging_preview_url,
          staging_deployed_at: task.staging_deployed_at,
        })),
      },
      // Needs from you: approvals (above), open questions, review links, and the owner's balance.
      needs_from_you: {
        questions: questionTasks.map(toClientRequest),
        review_links: projectCards
          .filter((p) => p.review_link)
          .map((p) => ({ project_id: p.id, project_name: p.name, url: p.review_link as string })),
      },
      retainers: retainerCards.map((r) => ({
        id: r.id,
        heading: r.heading,
        status: r.status,
        period: r.period,
        plan_ready: r.plan_ready !== null,
        open: r.this_month.open.slice(0, 3),
      })),
      // The counts the home summary line is built from (zeros are skipped by the page). Needs-you
      // counts approvals (a staged plan is one of them), open questions, review links and a balance.
      summary: {
        needs_count:
          pendingArticles.length +
          pendingTasks.length +
          questionTasks.length +
          projectCards.filter((p) => p.review_link).length +
          (billing && billing.open_count > 0 ? 1 : 0),
        moving: { projects: projectCards.length, retainers: retainerCards.length, requests: requests.open.length },
      },
      requests: {
        open_count: requests.open.length,
        // Work waiting on the client already sits under "Needs from you"; the panel shows the rest.
        top: requests.open.filter((r) => !NEEDS_YOU_LABELS.includes(r.state.label)).slice(0, 3),
      },
      projects: projectCards,
      billing,
      activity,
      stats,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
