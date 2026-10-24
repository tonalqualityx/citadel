/**
 * Opens the charter.price_review wait (specs/citadel-shape-SPEC.md 2.9 and 3.5).
 *
 * Finds charters that are active, have a review date, and have not finished that review, then
 * opens ONE wait per charter per review date. The key is `price-review:<charter id>:<date>`, so a
 * second run opens nothing, and a charter whose date is moved opens a new wait for the new date.
 * The clock: the first step (the draft task) is due 14 calendar days before the review date, at
 * 09:00 Eastern. A charter whose window has not begun yet is listed as `not_yet` and left alone.
 *
 * HOSTING CHARTERS ARE EXCLUDED. No `kind` column exists on Charter, so every charter today is a
 * marketing retainer and only existing rows are read. Whether hosting becomes a charter is
 * unruled (blocked on W3 Q2). If it does, this query must filter on the new kind before any
 * hosting charter gets a review date.
 *
 * Writes only wait rows and their events. `dryRun` returns what it would open and writes nothing.
 */
import type { PrismaClient } from '@prisma/client';
import { clientVisibleTaskWhere } from '@/lib/portal/visibility';
import { goalValueText, toClientGoal } from '@/lib/kpis/client-goals';
import { zonedTimeToUtc } from '@/lib/waits/business-days';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { buildWaitData } from '@/lib/waits/templates';
import { AGENCY_SUB_CLIENT_REASON } from './terms';

export const PRICE_REVIEW_TEMPLATE = 'charter.price_review';
export const PRICE_REVIEW_LEAD_DAYS = 14;
export const HOSTING_CHARTERS_NOTE =
  'Hosting charters are excluded: Charter has no kind column, every charter today is a marketing retainer, and hosting as a charter is unruled (blocked on W3 Q2).';

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD of a @db.Date value (its UTC parts are the calendar date). */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function waitKeyFor(charterId: string, reviewOn: Date): string {
  return `price-review:${charterId}:${dateKey(reviewOn)}`;
}

/** 09:00 Eastern, 14 calendar days before the review date. */
export function firstStepDueAt(reviewOn: Date): Date {
  const d = new Date(reviewOn.getTime() - PRICE_REVIEW_LEAD_DAYS * DAY_MS);
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 9, 0);
}

export interface OpenedItem {
  charter_id: string;
  client_label: string;
  review_on: string;
  due_at: string;
  key: string;
  wait_id?: string;
}

export interface OpenReport {
  dry_run: boolean;
  at: string;
  /** Waits opened (or, on a dry run, that would be). */
  opened: OpenedItem[];
  /** A wait for this charter and date already exists. */
  already_open: OpenedItem[];
  /** The 14 day window has not begun. */
  not_yet: OpenedItem[];
  /** Charters left alone on purpose, with the reason (for example an agency sub-client). */
  skipped: Array<OpenedItem & { reason: string }>;
  /** A charter that threw. The pass carries on with the next one. */
  errors: Array<{ charter_id: string; error: string }>;
  /** Open waits for a date the charter no longer has. Left alone; a person closes them. */
  stale_waits: Array<{ wait_id: string; charter_id: string; review_on: string }>;
  note: string;
}

type Db = PrismaClient;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

interface CharterRow {
  id: string;
  client_id: string;
  site_id: string | null;
  client_label: string | null;
  start_date: Date;
  price_review_on: Date;
  client: { name: string; parent_agency_id?: string | null };
}

/**
 * The draft task's description: the inputs to read, then the law in plain words. Inputs are read
 * live: client-visible tasks done in the term, and confirmed KPI rows with target and last value.
 */
export async function buildDraftDescription(db: Db, c: CharterRow, label: string): Promise<string> {
  // The term: the last twelve months before the review date, or since the plan began if shorter.
  const yearBefore = new Date(Date.UTC(c.price_review_on.getUTCFullYear() - 1, c.price_review_on.getUTCMonth(), c.price_review_on.getUTCDate()));
  const since = c.start_date.getTime() > yearBefore.getTime() ? c.start_date : yearBefore;

  const done = await db.task.findMany({
    where: {
      client_id: c.client_id,
      is_deleted: false,
      status: 'done',
      completed_at: { gte: since },
      ...clientVisibleTaskWhere(),
    },
    select: { title: true, client_title: true, completed_at: true },
    orderBy: { completed_at: 'asc' },
    take: 60,
  });
  const sites = c.site_id ? [c.site_id] : (await db.site.findMany({ where: { client_id: c.client_id, is_deleted: false }, select: { id: true } })).map((s) => s.id);
  const kpis = await db.siteKpi.findMany({
    where: {
      client_id: c.client_id,
      status: 'confirmed',
      OR: [{ charter_id: c.id }, ...(sites.length ? [{ site_id: { in: sites } }] : [])],
    },
    orderBy: { created_at: 'asc' },
    take: 30,
  });

  const taskLines = done.length
    ? done.map((t) => `- ${shortDate(t.completed_at ?? since)}: ${t.client_title ?? t.title}`)
    : ['- None found. Say so in the draft instead of listing work that did not happen.'];
  const kpiLines = kpis.length
    ? kpis.map((k) => {
        const g = toClientGoal(k);
        const last = k.last_value === null ? 'no reading yet' : `now ${goalValueText(k.metric, Number(k.last_value))}`;
        return `- ${g.label}: goal "${g.target_text}", ${last}`;
      })
    : ['- No confirmed goals for this client. Leave goals out of the draft.'];

  return [
    `Price review for ${label}. The review date is ${shortDate(c.price_review_on)}.`,
    'Your job: propose to Mike either a price increase or no change. Put the proposal in this task for Mike.',
    '- For an increase, give the amount you suggest and the reasoning: the work done in the term and where the goals landed (the inputs are below).',
    '- For no change, say so and give the reasoning the same way.',
    'You do not send anything and you do not email the client. Mike decides, and the client note is written only after he approves.',
    '',
    'The law, in plain words:',
    '- Never state to the client a number Mike has not approved. Your proposed amount is for Mike only; the amount and start date that go to the client are the ones Mike approves.',
    '- Never offer a discount, a credit or a waived fee.',
    '- The note goes to Mike for approval before anything reaches the client.',
    '',
    'Inputs to read:',
    `1. Work finished for the client that the client can see, ${shortDate(since)} to today (${done.length}${done.length === 60 ? ' or more' : ''}):`,
    ...taskLines,
    '2. Confirmed goals for the client sites, with the target and the last value:',
    ...kpiLines,
    '3. The charter page for the current plan and price. Read it; do not quote a new number from it.',
    '',
    'When the proposal is ready, put it in a comment on this task and mark the task done. Marking it done opens the approval step for Mike. He reads your proposal on this task.',
  ].join('\n');
}

export async function openPriceReviews(
  db: Db,
  opts: { dryRun?: boolean; now?: Date } = {}
): Promise<OpenReport> {
  const now = opts.now ?? new Date();
  const dryRun = !!opts.dryRun;
  const report: OpenReport = {
    dry_run: dryRun,
    at: now.toISOString(),
    opened: [],
    already_open: [],
    not_yet: [],
    skipped: [],
    errors: [],
    stale_waits: [],
    note: HOSTING_CHARTERS_NOTE,
  };
  const store = prismaSweepStore(db);

  const charters = await db.charter.findMany({
    where: { status: 'active', is_deleted: false, price_review_on: { not: null }, price_review_done_at: null },
    select: {
      id: true, client_id: true, site_id: true, client_label: true, start_date: true, price_review_on: true,
      client: { select: { name: true, parent_agency_id: true } },
    },
    orderBy: { price_review_on: 'asc' },
  });

  const openOne = async (row: (typeof charters)[number]): Promise<void> => {
    if (!row.price_review_on) return;
    const c: CharterRow = { ...row, price_review_on: row.price_review_on };
    const label = (c.client_label ?? c.client.name).trim();
    const key = waitKeyFor(c.id, c.price_review_on);
    const dueAt = firstStepDueAt(c.price_review_on);
    const item: OpenedItem = {
      charter_id: c.id,
      client_label: label,
      review_on: dateKey(c.price_review_on),
      due_at: dueAt.toISOString(),
      key,
    };

    // An agency sub-client is billed through the agency. Never queue to the end client.
    if (row.client.parent_agency_id) {
      report.skipped.push({ ...item, reason: AGENCY_SUB_CLIENT_REASON });
      return;
    }

    const existing = await db.wait.findUnique({ where: { idempotency_key: key }, select: { id: true } });
    if (existing) {
      report.already_open.push({ ...item, wait_id: existing.id });
      return;
    }
    if (now.getTime() < dueAt.getTime()) {
      report.not_yet.push(item);
      return;
    }
    if (dryRun) {
      report.opened.push(item);
      return;
    }

    const detail = await buildDraftDescription(db, c, label);
    const data = buildWaitData({
      template_key: PRICE_REVIEW_TEMPLATE,
      subject: label,
      title: `Propose the price review for ${label}`,
      detail,
      due_at: dueAt,
      started_at: dueAt,
      client_id: c.client_id,
      charter_id: c.id,
      site_id: c.site_id,
      created_by_automation: 'price-review.opener',
      idempotency_key: key,
    });
    const { wait, created } = await store.insertIdempotent(data);
    if (!created) {
      report.already_open.push({ ...item, wait_id: wait.id });
      return;
    }
    await store.addEvent({
      wait_id: wait.id,
      kind: 'created',
      to_state: 'waiting',
      to_due_at: wait.due_at,
      reason: `Price review for ${label}, review date ${item.review_on}. The draft task is due 14 days before.`,
      source: 'api',
    });
    report.opened.push({ ...item, wait_id: wait.id });
  };

  for (const row of charters) {
    try {
      await openOne(row);
    } catch (e) {
      report.errors.push({ charter_id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Open waits whose date is no longer the charter's date (staff moved it). Report only.
  const openWaits = await db.wait.findMany({
    where: {
      template_key: PRICE_REVIEW_TEMPLATE,
      state: { in: ['waiting', 'needs_human', 'blocked_by_switch', 'paused'] },
      idempotency_key: { startsWith: 'price-review:' },
    },
    select: { id: true, charter_id: true, idempotency_key: true },
  });
  const current = new Map(charters.map((c) => [c.id, c.price_review_on ? waitKeyFor(c.id, c.price_review_on) : null]));
  for (const w of openWaits) {
    if (!w.charter_id || !w.idempotency_key) continue;
    // Later steps carry `<wait id>:next` keys, so only the first step has a price-review key.
    const cur = current.get(w.charter_id);
    if (cur !== w.idempotency_key) {
      report.stale_waits.push({ wait_id: w.id, charter_id: w.charter_id, review_on: w.idempotency_key.split(':')[2] ?? '' });
    }
  }
  return report;
}
