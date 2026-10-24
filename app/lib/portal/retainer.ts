/**
 * The Retainer page (portal phase B slice 2, spec section 4; redesign 7.4 adds the plan-year months).
 *
 * One card per active or paused charter. Everything that leaves this module is an allow-list in
 * client words. Rules the spec fixes:
 *  - The heading is `Charter.client_label`, else the active wares' names, else "Marketing plan".
 *    `Charter.name` is internal and is never shown.
 *  - "This month" is client-visible charter work: open items plus those completed this period.
 *    Internal updates (migrations, infrastructure) never appear, because only client-visible tasks
 *    are read (the A1 rule).
 *  - The allowance is the plan's `budget_hours`, stated as what the plan includes. Hours used are
 *    never selected, summed or sent (MIKE decision 1).
 *  - "Plan ready for you" appears when a charter task tagged `marketing-plan` is staged and not
 *    yet approved. Approving here or by email both count: the approve endpoint is the existing one.
 *  - The latest report is the newest published `ClientReport` for the charter or a site it covers.
 *    The Steward lane writes those rows (POST /api/client-reports) from its publish.json.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { taskAccessWhere, type PortalAccess } from '@/lib/portal/access';
import { clientVisibleTaskWhere, stagedTaskWhere } from '@/lib/portal/visibility';
import { DEFAULT_PLAN_LABEL, planLabel } from '@/lib/portal/engagement';
import { requestState, type RequestState } from '@/lib/portal/status-labels';
import { approvedGoingLiveWhere } from '@/lib/portal/requests';
import { PORTAL_KPI_VIEWS } from '@/lib/config/feature-flags';
import { loadCharterGoals } from '@/lib/portal/goals';
import type { ClientGoal } from '@/lib/kpis/client-goals';

export const PLAN_TAG = 'marketing-plan';
export const BOOK_MARKETING_HREF = '/portal/book?type=marketing';
const OPEN_ITEMS_LIMIT = 50;
const DONE_ITEMS_LIMIT = 50;
const TZ = 'America/New_York';

export interface RetainerItem {
  id: string;
  title: string;
  state: RequestState;
  site: { id: string; name: string } | null;
  updated_at: Date | string;
}

export type YearMonthState = 'delivered' | 'current' | 'ready' | 'upcoming' | 'past';

export interface RetainerMonth {
  label: string;
  state: YearMonthState;
}

export interface RetainerCard {
  id: string;
  heading: string;
  status: { label: 'Active' | 'Paused'; tone: 'done' | 'quiet' };
  period: string;
  covers: string[];
  allowance: string | null;
  plan_ready: { task_id: string; title: string; preview_url: string; book_href: string } | null;
  this_month: { open: RetainerItem[]; done: RetainerItem[] };
  latest_report: { title: string; headline: string | null; period: string; url: string } | null;
  /** The contract year, up to twelve months. Empty when the charter has no usable start date. */
  year_label: string | null;
  months: RetainerMonth[];
  /**
   * Confirmed KPI goals in client words. Present ONLY when PORTAL_KPI_VIEWS is on; the key is
   * absent (not null) when it is off.
   */
  goals?: ClientGoal[];
}

// ---- pure helpers -----------------------------------------------------------------------

function ymParts(d: Date): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric' }).formatToParts(d);
  return {
    y: Number(parts.find((p) => p.type === 'year')?.value),
    m: Number(parts.find((p) => p.type === 'month')?.value),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

/** Midnight at the start of a calendar month in Eastern time, as a UTC instant. */
function monthStart(y: number, m: number): Date {
  const guess = Date.UTC(y, m - 1, 1, 5, 0, 0); // EST offset; correct below for EDT
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(guess));
  const hour = Number(p.find((x) => x.type === 'hour')?.value);
  return new Date(guess - hour * 3600 * 1000);
}

export interface Period {
  label: string;
  start: Date;
  end: Date;
}

/**
 * The period a charter is in right now. Monthly: the calendar month ("October 2026"). Annual: the
 * contract year that holds `now`, counted from the start date ("Oct 2026 to Sep 2027").
 */
export function periodOf(
  charter: { billing_period: 'monthly' | 'annually'; start_date: Date | string },
  now: Date
): Period {
  const { y, m } = ymParts(now);
  if (charter.billing_period === 'monthly') {
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    return { label: `${MONTHS[m - 1]} ${y}`, start: monthStart(y, m), end: monthStart(next.y, next.m) };
  }
  const s = new Date(charter.start_date);
  const startMonth = s.getUTCMonth() + 1; // start_date is a date column: its UTC parts are the calendar date
  let startYear = y;
  if (m < startMonth) startYear = y - 1;
  const endMonthIdx = (startMonth + 11 - 1) % 12; // the month before the anniversary
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  return {
    label: `${SHORT[startMonth - 1]} ${startYear} to ${SHORT[endMonthIdx]} ${endYear}`,
    start: monthStart(startYear, startMonth),
    end: monthStart(startYear + 1, startMonth),
  };
}

function hoursText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * "Your plan covers up to 10 hours of work a month." Null when the plan sets no allowance.
 * This is the allowance only; hours used are not read anywhere in this module.
 */
export function allowanceText(
  budgetHours: Prisma.Decimal | number | string | null | undefined,
  billing: 'monthly' | 'annually'
): string | null {
  if (budgetHours === null || budgetHours === undefined) return null;
  const n = Number(budgetHours);
  if (!Number.isFinite(n) || n <= 0) return null;
  const per = billing === 'monthly' ? 'month' : 'year';
  return `Your plan covers up to ${hoursText(n)} ${n === 1 ? 'hour' : 'hours'} of work a ${per}.`;
}

/**
 * The twelve months of the contract year that holds `now`, counted from the charter start month.
 * A month is 'delivered' when a published report exists for its period (YYYY-MM), 'current' for
 * this month, 'ready' for next month when a plan is staged, 'upcoming' for later months, and
 * 'past' for earlier months without a report. There is no "missed" state by design.
 */
export function buildYearMonths(
  startDate: Date | string | null | undefined,
  now: Date,
  reportPeriods: string[],
  planReady: boolean
): { label: string | null; months: RetainerMonth[] } {
  const s = startDate ? new Date(startDate) : null;
  if (!s || Number.isNaN(s.getTime())) return { label: null, months: [] };
  const { y, m } = ymParts(now);
  const startMonth = s.getUTCMonth() + 1;
  const startYear = m < startMonth ? y - 1 : y;
  const delivered = new Set(reportPeriods);
  const nowIdx = y * 12 + (m - 1);
  const months: RetainerMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const idx = startYear * 12 + (startMonth - 1) + i;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    const key = `${yy}-${String(mm).padStart(2, '0')}`;
    let state: YearMonthState;
    if (idx === nowIdx) state = 'current';
    else if (idx < nowIdx) state = delivered.has(key) ? 'delivered' : 'past';
    else if (idx === nowIdx + 1 && planReady) state = 'ready';
    else state = 'upcoming';
    months.push({ label: SHORT[mm - 1], state });
  }
  const lastIdx = startYear * 12 + (startMonth - 1) + 11;
  const label = `${MONTHS[startMonth - 1]} ${startYear} to ${MONTHS[lastIdx % 12]} ${Math.floor(lastIdx / 12)}`;
  return { label, months };
}

export function retainerHeading(clientLabel: string | null | undefined, wareNames: string[]): string {
  const label = (clientLabel ?? '').trim();
  if (label) return label;
  return planLabel(wareNames) || DEFAULT_PLAN_LABEL;
}

/** Only web links are ever put in front of a client as a report link. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---- loader -----------------------------------------------------------------------------

const ITEM_SELECT = {
  id: true,
  title: true,
  client_title: true,
  status: true,
  tags: true,
  staging_preview_url: true,
  approved: true,
  client_approved_at: true,
  updated_at: true,
  site: { select: { id: true, name: true } },
} as const satisfies Prisma.TaskSelect;

type ItemRow = Prisma.TaskGetPayload<{ select: typeof ITEM_SELECT }>;

const toItem = (r: ItemRow): RetainerItem => ({
  id: r.id,
  title: r.client_title ?? r.title,
  state: requestState(r),
  site: r.site,
  updated_at: r.updated_at,
});

export async function loadRetainers(access: PortalAccess, opts: { now?: Date } = {}): Promise<RetainerCard[]> {
  if (access.revoked || access.role === 'none') return [];
  const now = opts.now ?? new Date();

  const [charters, clientSites] = await Promise.all([
    prisma.charter.findMany({
      where: { client_id: access.clientId, is_deleted: false, status: { in: ['active', 'paused'] } },
      select: {
        id: true,
        status: true,
        billing_period: true,
        budget_hours: true,
        start_date: true,
        site_id: true,
        client_label: true,
        site: { select: { id: true, name: true } },
        charter_wares: { where: { is_active: true }, select: { ware: { select: { name: true } } } },
      },
      orderBy: { created_at: 'asc' },
    }),
    prisma.site.findMany({
      where: { client_id: access.clientId, is_deleted: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const goalsByCharter = PORTAL_KPI_VIEWS()
    ? await loadCharterGoals(
        access,
        charters.map((c) => ({ id: c.id, covered_site_ids: (c.site ? [c.site] : clientSites).map((s) => s.id) }))
      )
    : null;

  const cards: RetainerCard[] = [];
  for (const c of charters) {
    const period = periodOf(c, now);
    const covered = c.site ? [c.site] : clientSites;
    const taskBase: Prisma.TaskWhereInput = {
      charter_id: c.id,
      is_deleted: false,
      AND: [
        { OR: [{ client_id: access.clientId }, { site: { client_id: access.clientId } }] },
        clientVisibleTaskWhere(),
        taskAccessWhere(access),
      ],
    };

    const [plan, openRows, doneRows, report, yearReports] = await Promise.all([
      prisma.task.findFirst({
        where: { AND: [taskBase, { tags: { has: PLAN_TAG }, client_approved_at: null }, stagedTaskWhere()] },
        select: { id: true, title: true, client_title: true, staging_preview_url: true },
        orderBy: { updated_at: 'desc' },
      }),
      prisma.task.findMany({
        where: {
          AND: [
            taskBase,
            {
              OR: [
                { client_approved_at: null, status: { notIn: ['abandoned', 'done'] } },
                // Approved by the client, not live yet: still moving, so still on the card.
                approvedGoingLiveWhere(),
              ],
            },
          ],
        },
        select: ITEM_SELECT,
        orderBy: { updated_at: 'desc' },
        take: OPEN_ITEMS_LIMIT,
      }),
      prisma.task.findMany({
        where: {
          AND: [
            taskBase,
            { status: 'done', NOT: stagedTaskWhere() },
            { OR: [{ completed_at: { gte: period.start, lt: period.end } }, { client_approved_at: { gte: period.start, lt: period.end } }] },
          ],
        },
        select: ITEM_SELECT,
        orderBy: { updated_at: 'desc' },
        take: DONE_ITEMS_LIMIT,
      }),
      prisma.clientReport.findFirst({
        where: {
          client_id: access.clientId,
          published_at: { not: null, lte: now },
          OR: [{ charter_id: c.id }, { site_id: { in: covered.map((s) => s.id) } }],
        },
        select: { title: true, headline: true, period: true, url: true },
        orderBy: { published_at: 'desc' },
      }),
      prisma.clientReport.findMany({
        where: {
          client_id: access.clientId,
          published_at: { not: null, lte: now },
          OR: [{ charter_id: c.id }, { site_id: { in: covered.map((s) => s.id) } }],
        },
        select: { period: true },
      }),
    ]);

    // A staged plan is also an open task; show it once, in its own block.
    const open = (openRows as ItemRow[]).filter((r) => r.id !== plan?.id).map(toItem);
    const reportUrl = safeHttpUrl(report?.url);
    const year = buildYearMonths(
      c.start_date,
      now,
      ((yearReports ?? []) as { period: string }[]).map((r) => r.period),
      Boolean(plan && plan.staging_preview_url)
    );

    cards.push({
      id: c.id,
      heading: retainerHeading(c.client_label, c.charter_wares.map((w) => w.ware?.name ?? '').filter(Boolean)),
      status: c.status === 'paused' ? { label: 'Paused', tone: 'quiet' } : { label: 'Active', tone: 'done' },
      period: period.label,
      covers: covered.map((s) => s.name),
      allowance: allowanceText(c.budget_hours, c.billing_period),
      plan_ready:
        plan && plan.staging_preview_url
          ? { task_id: plan.id, title: plan.client_title ?? plan.title, preview_url: plan.staging_preview_url, book_href: BOOK_MARKETING_HREF }
          : null,
      this_month: { open, done: (doneRows as ItemRow[]).map(toItem) },
      latest_report: report && reportUrl ? { title: report.title, headline: report.headline, period: report.period, url: reportUrl } : null,
      year_label: year.label,
      months: year.months,
      ...(goalsByCharter ? { goals: goalsByCharter.get(c.id) ?? [] } : {}),
    });
  }
  return cards;
}
