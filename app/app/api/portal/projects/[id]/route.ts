import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess, projectAccessWhere, taskAccessWhere } from '@/lib/portal/access';
import { clientHistoryTaskWhere } from '@/lib/portal/visibility';
import { projectStatusLabel } from '@/lib/portal/status-labels';
import { CLIENT_VISIBLE_COMMENT_WHERE } from '@/lib/comments/visibility';
import {
  AWAITING_CLARIFICATION_TAG,
  buildPhaseList,
  computeProgress,
  currentPhaseName,
  isAwaitingClient,
  isHttpUrl,
  isTaskDone,
  reviewLink,
  toClientLinks,
  toClientRequest,
  toClientTask,
  type ClientLink,
  type ViewTask,
} from '@/lib/portal/project-view';

const HISTORY_LIMIT = 10;

// GET /api/portal/projects/:id (portal MVP A5)
// One project, in client words. 404 whenever the project is not accessible to the signed-in
// contact (wrong client, hidden, restricted for a non-owner, quote/queue/suspended/cancelled,
// deleted): the same answer for "missing" and "not yours", so ids cannot be probed.
// Every field is an allow-list. No estimates, assignees, tags, billing or internal notes.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const { id } = await params;

    const project = await prisma.project.findFirst({
      where: { AND: [{ id }, projectAccessWhere(access)] },
      select: {
        id: true,
        name: true,
        status: true,
        target_date: true,
        completed_date: true,
        phases: { select: { id: true, name: true, sort_order: true }, orderBy: { sort_order: 'asc' } },
        resource_links: {
          where: { is_deleted: false },
          select: { name: true, url: true, icon: true },
          orderBy: { sort_order: 'asc' },
        },
      },
    });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const rows = await prisma.task.findMany({
      where: {
        is_deleted: false,
        project_id: project.id,
        AND: [clientHistoryTaskWhere(), taskAccessWhere(access)],
      },
      select: {
        id: true,
        title: true,
        status: true,
        phase_id: true,
        tags: true,
        completed_at: true,
        updated_at: true,
        requested_by_contact_id: true,
        client_visible: true,
        staging_preview_url: true,
        staging_deployed_at: true,
        approved: true,
        client_approved_at: true,
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
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });

    const phaseNameById = new Map(project.phases.map((p) => [p.id, p.name]));
    const phases = buildPhaseList(project.phases, rows as ViewTask[]);
    const listedPhaseIds = new Set(phases.map((p) => p.id));
    const progress = computeProgress(rows as ViewTask[]);

    const tasks = rows
      .filter((t) => t.status !== 'abandoned' || t.client_approved_at)
      .map((t) => toClientTask(t, t.phase_id && listedPhaseIds.has(t.phase_id) ? phaseNameById.get(t.phase_id) ?? null : null));

    const awaiting = rows.filter((t) => isAwaitingClient(t) && !t.client_approved_at);
    const requests = rows
      .filter((t) => t.tags.includes(AWAITING_CLARIFICATION_TAG) && t.status !== 'abandoned' && !isTaskDone(t))
      .map(toClientRequest);

    const links: ClientLink[] = toClientLinks(project.resource_links);
    for (const t of awaiting) {
      if (isHttpUrl(t.staging_preview_url)) links.push({ name: `Preview: ${t.title}`, url: t.staging_preview_url, kind: 'preview' as const });
    }

    const history = rows
      .filter((t) => isTaskDone(t) || (t.client_approved_at && t.status !== 'abandoned'))
      .sort(
        (a, b) =>
          new Date(b.client_approved_at ?? b.completed_at ?? b.updated_at).getTime() -
          new Date(a.client_approved_at ?? a.completed_at ?? a.updated_at).getTime()
      )
      .slice(0, HISTORY_LIMIT)
      .map((t) => ({
        type: t.client_approved_at ? ('task_approved' as const) : ('task_completed' as const),
        id: t.id,
        title: t.title,
        at: t.client_approved_at ?? t.completed_at ?? t.updated_at,
      }));

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        status_label: projectStatusLabel(project.status),
        target_date: project.target_date,
        completed_date: project.completed_date,
        progress,
        current_phase: currentPhaseName(phases),
      },
      phases,
      tasks,
      needs_from_you: {
        approvals: awaiting.map((t) => ({
          id: t.id,
          title: t.title,
          staging_preview_url: isHttpUrl(t.staging_preview_url) ? t.staging_preview_url : null,
          staging_deployed_at: t.staging_deployed_at,
        })),
        requests,
        review_link: reviewLink(links),
      },
      links,
      history,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
