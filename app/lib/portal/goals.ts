/**
 * Confirmed KPI goals for the portal (Saturday 10-24 run, item 3). Read only, and only behind the
 * PORTAL_KPI_VIEWS switch (callers check it). Scoped to the active client of the session, the same
 * way the rest of the portal is: a contact reaches a sub-client only through the agency path that
 * loadPortalAccess already resolved into access.clientId. A contact with no client role, or a
 * revoked one, gets nothing. Rows that are proposed or retired never show.
 */
import { prisma } from '@/lib/db/prisma';
import type { PortalAccess } from '@/lib/portal/access';
import { toClientGoal, type ClientGoal } from '@/lib/kpis/client-goals';

const SELECT = {
  site_id: true,
  charter_id: true,
  metric: true,
  label: true,
  direction: true,
  target_value: true,
  target_by: true,
  last_value: true,
} as const;

async function confirmedRows(access: PortalAccess) {
  if (access.revoked || access.role === 'none') return [];
  return prisma.siteKpi.findMany({
    where: { client_id: access.clientId, status: 'confirmed' },
    select: SELECT,
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
}

/** Goals per charter: rows for the sites the charter covers, plus rows linked to the charter itself. */
export async function loadCharterGoals(
  access: PortalAccess,
  charters: Array<{ id: string; covered_site_ids: string[] }>
): Promise<Map<string, ClientGoal[]>> {
  const out = new Map<string, ClientGoal[]>();
  const rows = await confirmedRows(access);
  for (const c of charters) {
    const sites = new Set(c.covered_site_ids);
    out.set(
      c.id,
      rows.filter((r) => r.charter_id === c.id || (r.site_id !== null && sites.has(r.site_id))).map(toClientGoal)
    );
  }
  return out;
}

/** Goals per site, for the sites given. */
export async function loadSiteGoals(access: PortalAccess, siteIds: string[]): Promise<Map<string, ClientGoal[]>> {
  const out = new Map<string, ClientGoal[]>();
  if (siteIds.length === 0) return out;
  const ids = new Set(siteIds);
  for (const r of await confirmedRows(access)) {
    if (r.site_id === null || !ids.has(r.site_id)) continue;
    const list = out.get(r.site_id) ?? [];
    list.push(toClientGoal(r));
    out.set(r.site_id, list);
  }
  return out;
}
