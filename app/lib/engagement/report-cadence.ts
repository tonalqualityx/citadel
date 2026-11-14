/**
 * Client report cadence (Dox client reports): when is a project's next client report day, and is a draft due now.
 *
 * Pure, Eastern time, no I/O. The Dox scheduler (cadence.py) ports this and runs the same fixture
 * (__tests__/fixtures/report-due-cases.json) byte for byte, so change the two together.
 *
 * Rules:
 *  - A report is due from 07:00 Eastern on its report day. A missed day stays due until a draft is made (last_report_at moves on).
 *  - First report (no draft yet): the first report day whose 07:00 Eastern is not before the time the cadence was set.
 *  - After a draft (last_report_at, read as an Eastern date L):
 *      weekly         the first report day on or after L + 4 days
 *      every_2_weeks  the first report day on or after L + 11 days
 *      monthly        the first report day in a calendar month after L's month
 *  - Nothing is due (next_report_on is null) when the cadence is none, there is no report day, the brief is off, or the project is not
 *    ready, in progress or in review.
 */

export const REPORT_CADENCES = ['none', 'weekly', 'every_2_weeks', 'monthly'] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];
export const REPORT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ReportDay = (typeof REPORT_DAYS)[number];
export const REPORT_LIVE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;
export const REPORT_HOUR_ET = 7;
export const REPORT_TZ = 'America/New_York';

export interface ReportDueInput {
  cadence: string;
  day: string | null;
  /** ISO UTC instant of the last draft, or null. */
  last_report_at: string | null;
  /** ISO UTC instant the cadence was set (anchors the first report). */
  set_at: string | null;
  project_status: string;
  /** The brief's owner_mode: off | dry | live. */
  brief_mode: string;
  /** ISO UTC instant. */
  now: string;
}
export interface ReportDue {
  due: boolean;
  /** YYYY-MM-DD, Eastern. Null when nothing is scheduled. */
  next_report_on: string | null;
}

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
function easternParts(ms: number): { date: string; hour: number } {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export function easternDate(iso: string | Date): string {
  return easternParts(typeof iso === 'string' ? Date.parse(iso) : iso.getTime()).date;
}

const ymd = (s: string) => s.split('-').map(Number) as [number, number, number];
const addDays = (s: string, n: number): string => {
  const [y, m, d] = ymd(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayIndex = (s: string): number => {
  const [y, m, d] = ymd(s);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // mon = 0
};

/** The UTC instant (ms) of REPORT_HOUR_ET:00 Eastern on a date. */
export function reportInstant(dateStr: string): number {
  const [y, m, d] = ymd(dateStr);
  for (const off of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, REPORT_HOUR_ET + off);
    const p = easternParts(t);
    if (p.date === dateStr && p.hour === REPORT_HOUR_ET) return t;
  }
  throw new Error(`no Eastern ${REPORT_HOUR_ET}:00 on ${dateStr}`);
}

function onOrAfter(dateStr: string, day: ReportDay): string {
  const want = REPORT_DAYS.indexOf(day);
  return addDays(dateStr, (want - weekdayIndex(dateStr) + 7) % 7);
}

export function computeReportDue(i: ReportDueInput): ReportDue {
  const none: ReportDue = { due: false, next_report_on: null };
  const day = i.day as ReportDay | null;
  if (!(REPORT_CADENCES as readonly string[]).includes(i.cadence) || i.cadence === 'none') return none;
  if (!day || !(REPORT_DAYS as readonly string[]).includes(day)) return none;
  if (i.brief_mode === 'off') return none;
  if (!(REPORT_LIVE_PROJECT_STATUSES as readonly string[]).includes(i.project_status)) return none;
  const nowMs = Date.parse(i.now);

  let next: string;
  if (i.last_report_at) {
    const L = easternDate(i.last_report_at);
    if (i.cadence === 'monthly') {
      const [y, m] = ymd(L);
      const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // first of the next month
      next = onOrAfter(first, day);
    } else {
      next = onOrAfter(addDays(L, i.cadence === 'weekly' ? 4 : 11), day);
    }
  } else {
    const setMs = i.set_at ? Date.parse(i.set_at) : nowMs;
    next = onOrAfter(easternDate(new Date(setMs)), day);
    while (reportInstant(next) < setMs) next = addDays(next, 7);
  }
  return { due: nowMs >= reportInstant(next), next_report_on: next };
}

export interface ReportBriefLike {
  report_cadence: string;
  report_day: string | null;
  last_report_at: Date | null;
  owner_mode: string;
  updated_at?: Date | null;
  created_at?: Date | null;
  report_source?: unknown;
}
export interface ReportProjectLike {
  status: string;
}

/** When the cadence was set: the source's recorded `at`, else the brief's last update. */
export function reportSetAt(b: ReportBriefLike): string | null {
  const at = (b.report_source as { at?: unknown } | null | undefined)?.at;
  if (typeof at === 'string' && !Number.isNaN(Date.parse(at))) return at;
  const d = b.updated_at ?? b.created_at ?? null;
  return d ? d.toISOString() : null;
}

function toInput(b: ReportBriefLike, p: ReportProjectLike, now: Date): ReportDueInput {
  return {
    cadence: b.report_cadence,
    day: b.report_day,
    last_report_at: b.last_report_at ? b.last_report_at.toISOString() : null,
    set_at: reportSetAt(b),
    project_status: p.status,
    brief_mode: b.owner_mode,
    now: now.toISOString(),
  };
}
export function nextReportOn(b: ReportBriefLike, p: ReportProjectLike, now: Date = new Date()): string | null {
  return computeReportDue(toInput(b, p, now)).next_report_on;
}
export function reportDue(b: ReportBriefLike, p: ReportProjectLike, now: Date = new Date()): boolean {
  return computeReportDue(toInput(b, p, now)).due;
}
