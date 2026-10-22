/**
 * Portal requests list and work-page loader (portal phase B slice 1, spec sections 4 and 3.1).
 *
 * A "request" is a client-visible ad hoc task, plus every task a contact on the client filed,
 * on any chain (project, retainer or request). Visibility is the A1 rule, scope is the A3 rule.
 * Everything that leaves this module is an allow-list: no tags, no estimates, no assignees.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { taskAccessWhere, type PortalAccess } from '@/lib/portal/access';
import { clientVisibleTaskWhere, stagedTaskWhere } from '@/lib/portal/visibility';
import { engagementOf, type Engagement } from '@/lib/portal/engagement';
import { requestState, type RequestState } from '@/lib/portal/status-labels';

export const DEFAULT_CLOSED_DAYS = 30;
export const MAX_CLOSED_DAYS = 365;
const OPEN_LIMIT = 200;
const CLOSED_LIMIT = 100;

export interface RequestItem {
  id: string;
  title: string;
  state: RequestState;
  engagement: Engagement;
  site: { id: string; name: string } | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const ITEM_SELECT = {
  id: true,
  title: true,
  client_title: true,
  status: true,
  tags: true,
  staging_preview_url: true,
  approved: true,
  client_approved_at: true,
  created_at: true,
  updated_at: true,
  project_id: true,
  charter_id: true,
  project: { select: { id: true, name: true } },
  charter: { select: { id: true, charter_wares: { where: { is_active: true }, select: { ware: { select: { name: true } } } } } },
  site: { select: { id: true, name: true } },
} as const satisfies Prisma.TaskSelect;

interface ItemRow {
  id: string;
  title: string;
  client_title: string | null;
  status: string;
  tags: string[];
  staging_preview_url: string | null;
  approved: boolean;
  client_approved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  project_id: string | null;
  charter_id: string | null;
  project: { id: string; name: string } | null;
  charter: { id: string; charter_wares?: Array<{ ware?: { name: string } | null }> } | null;
  site: { id: string; name: string } | null;
}

export function wareNamesOf(charter: ItemRow['charter']): string[] {
  return (charter?.charter_wares ?? []).map((w) => w.ware?.name ?? '').filter(Boolean);
}

export function toRequestItem(row: ItemRow): RequestItem {
  return {
    id: row.id,
    title: row.client_title ?? row.title,
    state: requestState(row),
    engagement: engagementOf({
      project_id: row.project_id,
      project: row.project,
      charter_id: row.charter_id,
      charter: row.charter ? { id: row.charter.id, ware_names: wareNamesOf(row.charter) } : null,
      site: row.site,
    }),
    site: row.site,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Attention first, then newest. */
export function sortRequests<T extends { state: RequestState; updated_at: Date | string }>(items: T[]): T[] {
  const rank = (i: T) => (i.state.tone === 'attention' ? 0 : 1);
  return [...items].sort(
    (a, b) => rank(a) - rank(b) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

/** Where a task counts as a request for this client. */
export function requestsScope(access: PortalAccess): Prisma.TaskWhereInput {
  return {
    is_deleted: false,
    AND: [
      { OR: [{ client_id: access.clientId }, { site: { client_id: access.clientId } }] },
      taskAccessWhere(access),
      {
        OR: [
          // Client-visible ad hoc work: no project, no charter.
          { project_id: null, charter_id: null, AND: [clientVisibleTaskWhere()] },
          // Anything a contact filed, on any chain.
          { requested_by_contact_id: { not: null } },
        ],
      },
    ],
  };
}

/** Prisma fragments for "still open" and "closed" from the client's side. */
export function approvedGoingLiveWhere(): Prisma.TaskWhereInput {
  return {
    status: 'review',
    OR: [{ client_approved_at: { not: null } }, { tags: { has: 'client-approved' } }],
  };
}
export function openWhere(): Prisma.TaskWhereInput {
  return {
    status: { not: 'abandoned' },
    OR: [
      { client_approved_at: null, OR: [{ status: { not: 'done' } }, stagedTaskWhere()] },
      // Approved by the client, not live yet: still moving, so still open.
      approvedGoingLiveWhere(),
    ],
  };
}
export function closedWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      { status: 'abandoned' },
      { client_approved_at: { not: null }, NOT: approvedGoingLiveWhere() },
      { status: 'done', NOT: stagedTaskWhere() },
    ],
  };
}

export async function loadRequests(
  access: PortalAccess,
  opts: { site_id?: string | null; closed_days?: number; now?: Date } = {}
): Promise<{ open: RequestItem[]; recently_closed: RequestItem[] }> {
  const now = opts.now ?? new Date();
  const days = Math.min(Math.max(Math.trunc(opts.closed_days ?? DEFAULT_CLOSED_DAYS), 1), MAX_CLOSED_DAYS);
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const scope = requestsScope(access);
  const siteFilter: Prisma.TaskWhereInput = opts.site_id ? { site_id: opts.site_id } : {};

  const [openRows, closedRows] = await Promise.all([
    prisma.task.findMany({
      where: { AND: [scope, siteFilter, openWhere()] },
      select: ITEM_SELECT,
      orderBy: { updated_at: 'desc' },
      take: OPEN_LIMIT,
    }),
    prisma.task.findMany({
      where: { AND: [scope, siteFilter, closedWhere(), { updated_at: { gte: since } }] },
      select: ITEM_SELECT,
      orderBy: { updated_at: 'desc' },
      take: CLOSED_LIMIT,
    }),
  ]);

  return {
    open: sortRequests((openRows as unknown as ItemRow[]).map(toRequestItem)),
    recently_closed: (closedRows as unknown as ItemRow[]).map(toRequestItem),
  };
}

// ---- Work page --------------------------------------------------------------------------

export interface WorkItem {
  id: string;
  title: string;
  state: RequestState;
  engagement: Engagement;
  site: { id: string; name: string } | null;
  requested_by: { first_name: string } | null;
  requested_at: Date | string;
  /** When the client approved it, if they did. */
  approved_at: Date | string | null;
  /** The intake answers, verbatim. Empty for work that did not come through the intake. */
  answers: Array<{ prompt: string; value: string }>;
  /** Set when the work is staged for the client. */
  staged: { preview_url: string; awaiting_approval: boolean } | null;
  can_act: boolean;
}

function answersOf(intake: unknown): Array<{ prompt: string; value: string }> {
  if (!intake || typeof intake !== 'object') return [];
  const raw = (intake as { answers?: unknown }).answers;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is { prompt: string; value: string } => !!a && typeof a.prompt === 'string' && typeof a.value === 'string')
    .map((a) => ({ prompt: a.prompt, value: a.value }));
}

/** First name only: the page shows who asked, not their full record. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

export async function loadWorkItem(access: PortalAccess, taskId: string): Promise<WorkItem | null> {
  const row = await prisma.task.findFirst({
    where: {
      id: taskId,
      is_deleted: false,
      AND: [
        { OR: [{ client_id: access.clientId }, { site: { client_id: access.clientId } }] },
        clientVisibleTaskWhere(),
        taskAccessWhere(access),
      ],
    },
    select: {
      ...ITEM_SELECT,
      client_intake: true,
      requested_by_contact: { select: { name: true } },
    },
  });
  if (!row) return null;
  const r = row as unknown as ItemRow & { client_intake: unknown; requested_by_contact: { name: string } | null };
  const base = toRequestItem(r);
  const staged =
    typeof r.staging_preview_url === 'string' && r.staging_preview_url.length > 0 && !r.approved && (r.status === 'review' || r.status === 'done');
  const requester = firstName(r.requested_by_contact?.name);
  return {
    id: base.id,
    title: base.title,
    state: base.state,
    engagement: base.engagement,
    site: base.site,
    requested_by: requester ? { first_name: requester } : null,
    requested_at: r.created_at,
    approved_at: r.client_approved_at ?? null,
    answers: answersOf(r.client_intake),
    staged: staged ? { preview_url: r.staging_preview_url as string, awaiting_approval: !r.client_approved_at && !r.tags.includes('client-approved') } : null,
    // Mike's ruling: for now ANY portal user may approve or request changes (no role gate on the
    // approve routes), so the review block shows its buttons to everyone who can see the task.
    can_act: true,
  };
}
