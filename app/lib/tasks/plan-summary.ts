/** The one line on the home Triage card when a plan exists: "Plan: 12 requirements, 9 pages, launch Jan 19, milestones billing". Counts requirements, pages, the launch date and the billing kind, never tasks. Pure. */
import { isProjectDateLabel } from './plan-schema';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jan 19" from YYYY-MM-DD, with no time zone in play. */
export function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
}

export interface PlanLineInput {
  /** Requirement items that are not dropped. */
  requirements: number;
  /** The project's launch date (the field of record), else null. */
  project_launch: string | null;
  /** Plan date items: label and day. */
  dates: { label: string; date: string; mark?: string }[];
  billing_kind: string | null;
  /** Pages in the project's sitemap (project cards). */
  pages?: number;
  /** Anything else in the plan at all (so a plan with only examples still shows a line). */
  other_items: number;
}

const BILLING_WORDS: Record<string, string> = { retainer: 'retainer billing', hourly: 'hourly billing', milestones: 'milestones billing', internal: 'not billed' };

export function planLine(i: PlanLineInput): string | null {
  const parts: string[] = [];
  if (i.requirements > 0) parts.push(`${i.requirements} ${i.requirements === 1 ? 'requirement' : 'requirements'}`);
  if ((i.pages ?? 0) > 0) parts.push(`${i.pages} ${i.pages === 1 ? 'page' : 'pages'}`);
  const launchPlan = i.dates.find((d) => d.mark !== 'dropped' && /^(project )?launch( date)?$/i.test(d.label.trim()) && isProjectDateLabel(d.label));
  const launch = i.project_launch ?? launchPlan?.date ?? i.dates.find((d) => d.mark !== 'dropped' && /launch/i.test(d.label))?.date ?? null;
  if (launch) parts.push(`launch ${shortDay(launch)}`);
  const b = i.billing_kind ? BILLING_WORDS[i.billing_kind] : null;
  if (b) parts.push(b);
  if (parts.length === 0) return i.other_items > 0 ? 'Plan: started' : null;
  return `Plan: ${parts.join(', ')}`;
}
