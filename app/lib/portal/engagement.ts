/**
 * The engagement chip (portal phase B slice 1, spec section 4): every client-visible task belongs
 * to exactly one of Project, Retainer or Request, derived from `project_id`, then `charter_id`.
 *
 * Pure. The label for a retainer is the plan name the client knows (the active wares' names, or
 * "Marketing plan"); `Charter.name` is internal and is never used here.
 */
export type EngagementKind = 'project' | 'retainer' | 'request';

export interface EngagementFields {
  project_id?: string | null;
  project?: { id: string; name: string } | null;
  charter_id?: string | null;
  charter?: { id: string; ware_names?: string[] | null } | null;
  site?: { id: string; name: string } | null;
}

export interface Engagement {
  kind: EngagementKind;
  /** The text on the chip, without the kind: a project name, a plan label, or the site. */
  label: string;
  /** Where the chip links, or null when the destination page does not exist yet. */
  href: string | null;
}

export const DEFAULT_PLAN_LABEL = 'Marketing plan';

export function planLabel(wareNames: string[] | null | undefined): string {
  const names = (wareNames ?? []).map((n) => n.trim()).filter(Boolean);
  return names.length > 0 ? names.join(', ') : DEFAULT_PLAN_LABEL;
}

export function engagementOf(task: EngagementFields): Engagement {
  if (task.project_id) {
    const id = task.project?.id ?? task.project_id;
    return { kind: 'project', label: task.project?.name ?? 'Project', href: `/portal/projects/${id}` };
  }
  if (task.charter_id) {
    // The retainer page lands in slice 2; until then the chip does not link.
    return { kind: 'retainer', label: planLabel(task.charter?.ware_names), href: null };
  }
  return {
    kind: 'request',
    label: task.site?.name ?? 'Request',
    href: task.site ? `/portal/requests?site_id=${task.site.id}` : '/portal/requests',
  };
}

/** "Project: Website relaunch", "Retainer: Marketing plan", "Request: example.com". */
export function engagementText(e: Engagement): string {
  const kind = e.kind === 'project' ? 'Project' : e.kind === 'retainer' ? 'Retainer' : 'Request';
  return e.kind === 'request' && e.label === 'Request' ? 'Request' : `${kind}: ${e.label}`;
}
