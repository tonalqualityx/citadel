/**
 * "What we still need" for the portal Home Needs-you box (Saturday 10-24 run, item 3). Read only,
 * behind PORTAL_ONBOARD_CHECKLIST (callers check it). Items come from the client's open
 * onboarding checklists: required, state missing. The text is the template's client label by key,
 * so an item whose key the templates do not know is dropped (allow-list). Only contacts who can
 * act on work (owner, member) get the list; a viewer, a grant-only contact or a revoked one gets none.
 */
import { prisma } from '@/lib/db/prisma';
import { canActOnWork, type PortalAccess } from '@/lib/portal/access';
import { CHECKLIST_TEMPLATES, findTemplateItem } from '@/lib/checklists/templates';

export interface StillNeeded {
  label: string;
}

const ORDER = new Map<string, number>(
  Object.values(CHECKLIST_TEMPLATES).flatMap((t) => t.items.map((i, n) => [i.key, n] as [string, number]))
);

export async function loadStillNeeded(access: PortalAccess): Promise<StillNeeded[]> {
  if (access.revoked || !canActOnWork(access.role)) return [];
  const rows = await prisma.checklistItem.findMany({
    where: {
      required: true,
      state: 'missing',
      checklist: { kind: 'onboarding', client_id: access.clientId, done_at: null },
    },
    select: { key: true },
  });
  const seen = new Set<string>();
  const out: Array<StillNeeded & { n: number }> = [];
  for (const r of rows) {
    const t = findTemplateItem(r.key);
    if (!t || seen.has(t.client_label)) continue;
    seen.add(t.client_label);
    out.push({ label: t.client_label, n: ORDER.get(r.key) ?? 999 });
  }
  return out.sort((a, b) => a.n - b.n).map(({ label }) => ({ label }));
}
