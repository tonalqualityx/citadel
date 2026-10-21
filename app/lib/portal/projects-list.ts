/**
 * The Projects list (portal phase B slice 2, spec section 4): every project the contact may see,
 * active first, then complete. Scope is the A3 rule (`projectAccessWhere`), so hidden and
 * restricted projects and the pre-kickoff and cancelled statuses never appear. Progress counts
 * client-visible tasks only (the A1 history rule). Allow-list output: a name, a status word, a
 * count, the next milestone and a target date. No estimates, owners, tags or money.
 */
import { prisma } from '@/lib/db/prisma';
import { projectAccessWhere, taskAccessWhere, type PortalAccess } from '@/lib/portal/access';
import { clientHistoryTaskWhere } from '@/lib/portal/visibility';
import { projectStatusLabel } from '@/lib/portal/status-labels';
import { computeProgress, type Progress, type ViewTask } from '@/lib/portal/project-view';

export const ACTIVE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;
const LIST_LIMIT = 100;

export interface ProjectListItem {
  id: string;
  name: string;
  status_label: string;
  progress: Progress;
  next_milestone: { name: string; target_date: Date | string | null } | null;
  target_date: Date | string | null;
  updated_at: Date | string;
}

interface MilestoneRow {
  name: string;
  target_date: Date | string | null;
  completed_at: Date | string | null;
  sort_order: number;
}

/** The first milestone not yet completed: earliest target date, undated ones after, then sort order. */
export function nextMilestone(rows: MilestoneRow[]): { name: string; target_date: Date | string | null } | null {
  const open = rows.filter((m) => !m.completed_at);
  if (open.length === 0) return null;
  const key = (m: MilestoneRow) => (m.target_date ? new Date(m.target_date).getTime() : Number.POSITIVE_INFINITY);
  const next = [...open].sort((a, b) => key(a) - key(b) || a.sort_order - b.sort_order)[0];
  return { name: next.name, target_date: next.target_date };
}

export async function loadProjectList(access: PortalAccess): Promise<{ active: ProjectListItem[]; complete: ProjectListItem[] }> {
  if (access.revoked) return { active: [], complete: [] };
  const projects = await prisma.project.findMany({
    where: { AND: [projectAccessWhere(access), { status: { in: [...ACTIVE_PROJECT_STATUSES, 'done'] } }] },
    select: {
      id: true,
      name: true,
      status: true,
      target_date: true,
      updated_at: true,
      milestones: { select: { name: true, target_date: true, completed_at: true, sort_order: true } },
    },
    orderBy: { updated_at: 'desc' },
    take: LIST_LIMIT,
  });
  if (projects.length === 0) return { active: [], complete: [] };

  const taskRows = await prisma.task.findMany({
    where: {
      is_deleted: false,
      project_id: { in: projects.map((p) => p.id) },
      AND: [clientHistoryTaskWhere(), taskAccessWhere(access)],
    },
    select: {
      id: true,
      title: true,
      project_id: true,
      status: true,
      completed_at: true,
      requested_by_contact_id: true,
      client_visible: true,
      staging_preview_url: true,
      approved: true,
      client_approved_at: true,
    },
  });

  const items = projects.map((p) => ({
    status: p.status as string,
    item: {
      id: p.id,
      name: p.name,
      status_label: projectStatusLabel(p.status),
      progress: computeProgress(taskRows.filter((t) => t.project_id === p.id) as unknown as ViewTask[]),
      next_milestone: p.status === 'done' ? null : nextMilestone(p.milestones),
      target_date: p.target_date,
      updated_at: p.updated_at,
    } satisfies ProjectListItem,
  }));
  return {
    active: items.filter((i) => i.status !== 'done').map((i) => i.item),
    complete: items.filter((i) => i.status === 'done').map((i) => i.item),
  };
}
