/**
 * Placement for a chat request (phase B placement, phase C spec 2.4 and 2.5). Loads what
 * `fileRequest` loads and runs the same pure `placeRequest`, so a chat request lands exactly
 * where the stepper would have put it.
 */
import type { Prisma } from '@prisma/client';
import { projectAccessWhere, type PortalAccess } from '@/lib/portal/access';
import { OPEN_BUILD_STATUSES, placeRequest, type Placement } from '@/lib/portal/intake/placement';
import type { IntakeType } from '@/lib/portal/intake/tree';

export interface PlacedFor {
  placement: Placement;
  site: { id: string; name: string; site_type: string | null; platform: string | null } | null;
  isWordpress: boolean;
  candidates: Array<{ id: string; name: string }>;
}

export async function placeFor(
  tx: Prisma.TransactionClient,
  access: PortalAccess,
  input: { type: IntakeType; siteId: string | null; chosenProjectId: string | null; contentKind?: string | null; now: Date }
): Promise<PlacedFor> {
  const [sites, projects, charters] = await Promise.all([
    tx.site.findMany({
      where: { client_id: access.clientId, is_deleted: false },
      select: { id: true, name: true, site_type: true, platform: true, maintenance_plan_id: true, hosting_plan_id: true },
    }),
    tx.project.findMany({ where: projectAccessWhere(access), select: { id: true, name: true, site_id: true, status: true, scope_locked: true } }),
    tx.charter.findMany({
      where: { client_id: access.clientId, is_deleted: false, status: { in: ['active', 'paused'] } },
      select: { id: true, name: true, site_id: true, status: true, start_date: true, end_date: true, created_at: true },
    }),
  ]);
  const site = input.siteId ? sites.find((s) => s.id === input.siteId) ?? null : null;
  const visible = new Set(projects.map((p) => p.id));
  const hidden = input.siteId
    ? (
        await tx.project.findMany({
          where: { client_id: access.clientId, is_deleted: false, site_id: input.siteId, status: { in: [...OPEN_BUILD_STATUSES] } },
          select: { id: true, scope_locked: true },
        })
      )
        .filter((p) => !visible.has(p.id))
        .map((p) => ({ scope_locked: p.scope_locked }))
    : [];
  const placement = placeRequest({
    type: input.type,
    site_id: input.siteId,
    chosen_project_id: input.chosenProjectId,
    site_has_plan: Boolean(site && (site.maintenance_plan_id || site.hosting_plan_id)),
    projects,
    hidden_builds: hidden,
    charters,
    content_kind: input.contentKind ?? null,
    now: input.now,
  });
  const isWordpress = Boolean(site && (site.site_type === 'wordpress' || /wordpress/i.test(site.platform ?? '')));
  return {
    placement,
    site: site ? { id: site.id, name: site.name, site_type: site.site_type, platform: site.platform } : null,
    isWordpress,
    candidates: placement.ok ? [] : placement.candidates.map((c) => ({ id: c.id, name: c.name })),
  };
}

/**
 * Provisional placement (phase C spec 2.4): when the request type or site becomes known, re-run
 * placement and move the task. Never quotes or retags; that waits for the confirm step.
 */
export async function syncProvisionalPlacement(
  tx: Prisma.TransactionClient,
  access: PortalAccess,
  taskId: string,
  input: { type: IntakeType; siteId: string | null; now: Date }
): Promise<void> {
  const placed = await placeFor(tx, access, { type: input.type, siteId: input.siteId, chosenProjectId: null, now: input.now });
  if (!placed.placement.ok) {
    await tx.task.update({ where: { id: taskId }, data: { site_id: input.siteId } });
    return;
  }
  const p = placed.placement;
  await tx.task.update({
    where: { id: taskId },
    data: { site_id: p.site_id, project_id: p.project_id, charter_id: p.charter_id, is_retainer_work: p.chain === 'charter', is_support: p.is_support },
  });
}
