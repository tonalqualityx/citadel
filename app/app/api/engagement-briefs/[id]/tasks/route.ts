import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { OPEN_TASK_STATUSES, scopeWhere } from '@/lib/engagement/brief';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENT_CHARS = 1200;

/**
 * GET /api/engagement-briefs/[id]/tasks: the open tasks the brief's scope resolves to, least
 * recently touched first, capped (?limit=, default 40, max 100), each with its last 10 comments
 * and open waits; plus counts of the rest and the project / charter state the pass needs. The one
 * place scope is resolved, so the machine side never re-implements it. pm or admin.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const limit = Math.min(100, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '40', 10) || 40));
    const brief = await prisma.engagementBrief.findUnique({ where: { id } });
    if (!brief) throw new ApiError('Brief not found', 404);

    const [project, charter] = await Promise.all([
      brief.project_id
        ? prisma.project.findUnique({
            where: { id: brief.project_id },
            select: { id: true, name: true, status: true, next_step_text: true, next_step_at: true, next_step_owner_label: true, next_step_source: true },
          })
        : null,
      brief.charter_id
        ? prisma.charter.findUnique({ where: { id: brief.charter_id }, select: { id: true, name: true, status: true, start_date: true, end_date: true } })
        : null,
    ]);

    const where = scopeWhere(brief);
    if (!where) return NextResponse.json({ brief_id: id, project, charter, total_open: 0, returned: 0, rest_by_status: {}, tasks: [] });
    const open = { AND: [where, { status: { in: [...OPEN_TASK_STATUSES] } }] };
    const [total, byStatus, rows] = await Promise.all([
      prisma.task.count({ where: open }),
      prisma.task.groupBy({ by: ['status'], where: open, _count: { _all: true } }),
      prisma.task.findMany({
        where: open,
        orderBy: { updated_at: 'asc' },
        take: limit,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          client_visible: true,
          source: true,
          requested_by_contact_id: true,
          needs_review: true,
          approved: true,
          client_id: true,
          project_id: true,
          charter_id: true,
          assignee_id: true,
          tags: true,
          requirements: true,
          source_ref: true,
          due_date: true,
          started_at: true,
          completed_at: true,
          created_at: true,
          updated_at: true,
          client_approved_at: true,
          staging_preview_url: true,
          claim_holder: true,
          lease_until: true,
          comments: {
            where: { is_deleted: false },
            orderBy: { created_at: 'desc' },
            take: 10,
            select: { id: true, user_id: true, content: true, is_internal: true, client_visible: true, author_contact_id: true, created_at: true },
          },
        },
      }),
    ]);

    const taskIds = rows.map((r) => r.id);
    const waits = taskIds.length
      ? await prisma.wait.findMany({
          where: { task_id: { in: taskIds }, state: { in: ['waiting', 'needs_human', 'blocked_by_switch', 'paused'] } },
          select: { id: true, task_id: true, template_key: true, title: true, state: true, due_at: true },
        })
      : [];

    const returnedStatus: Record<string, number> = {};
    for (const r of rows) returnedStatus[r.status] = (returnedStatus[r.status] ?? 0) + 1;
    const restByStatus: Record<string, number> = {};
    for (const g of byStatus) {
      const left = g._count._all - (returnedStatus[g.status] ?? 0);
      if (left > 0) restByStatus[g.status] = left;
    }

    return NextResponse.json({
      brief_id: id,
      project,
      charter,
      total_open: total,
      returned: rows.length,
      rest_by_status: restByStatus,
      tasks: rows.map((r) => ({
        ...r,
        comments: r.comments.map((c) => ({ ...c, content: c.content.slice(0, COMMENT_CHARS), author_is_client: !!c.author_contact_id })),
        waits: waits.filter((w) => w.task_id === r.id),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
