/**
 * The six health tiles (task 183ec7a8), option A of the health view report Mike tapped on 2026-11-26. His three answers on that card:
 *   - each tile compares against that measure's own 12 week average ("Own 12 week average now, initiative targets later");
 *   - money counts only invoices under 90 days late ("Old records: count only invoices under 90 days late, and file a cleanup card");
 *   - QuickBooks figures are copied from the machine every 30 minutes, and each money tile shows the time of the last copy
 *     (question 0239107a, gone with its recommendation: "Copy every 30 minutes from the machine"; the key never moves).
 *
 * Sources, all read only except today's own row in health_snapshots:
 *   Ready to invoice  milestones ready to invoice + scheduled invoices ready to send + finished billable hourly work not yet invoiced
 *                     (not on a fixed price project and not for a retainer client, whose hours the retainer covers). Live.
 *   Owed to us        the QuickBooks invoice copy (client_invoices): unpaid, past due, and under 90 days late. Freshness = last copy.
 *   Sales             deals at proposal or contract ("out"), and deals signed this month in his zone. Live.
 *   Projects          contracted projects in progress, moving against stuck (stuck = no movement for 7 days, the projects tab's own rule). Live.
 *   Clients           sites down and client emails waiting over a day, both exactly as the home screen counts them. Live.
 *   Agents            cards the agents finished in the last 7 days. Live; its usual comes straight from the last 12 weeks of finished cards.
 * Each source fails on its own: a tile that cannot be read says so and the other five still show.
 */
import type { PrismaClient } from '@prisma/client';
import { getZonedDateString } from '@/lib/utils/time';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { isReadyToSend } from '@/lib/home/first-list-money';
import { needsALook, twelveWeekAverage, weeklyTotals, windowStart, type HealthDirection, type HealthPoint } from './compare';
import type { HealthState, HealthTile, HealthTileId, HomeHealth } from './types';

const DAY_MS = 86_400_000;
const LATE_LIMIT_DAYS = 90;
const MAIL_WAIT_MS = DAY_MS;
const DETAIL_ROWS = 5;

type Moneyish = { toString(): string } | number | null | undefined;
const num = (v: Moneyish): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
};

export const money = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(n));

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last QuickBooks copy in his zone: "10:07 AM" today, "Nov 26, 10:07 AM" on an earlier day, or null when there is none. */
export function copyTime(at: Date | null, now: Date, timezone: string): string | null {
  if (!at) return null;
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
  if (getZonedDateString(at, timezone) === getZonedDateString(now, timezone)) return time;
  const day = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: timezone });
  return `${day}, ${time}`;
}

/** "Copied 10:07 AM", "Copied Nov 26, 10:07 AM", or "No copy yet". */
export function copiedLabel(at: Date | null, now: Date, timezone: string): string {
  const t = copyTime(at, now, timezone);
  return t ? `Copied ${t}` : 'No copy yet';
}

/** The newest QuickBooks copy time (every row the machine's sync writes is stamped), or null. */
async function lastQuickBooksCopy(db: PrismaClient): Promise<Date | null> {
  const last = await db.clientInvoice.aggregate({ _max: { synced_at: true } });
  return last._max.synced_at ?? null;
}

// ---------------------------------------------------------------------------- readings

/** One measure's reading: the number compared with its usual, plus the words the tile shows. */
export interface Reading {
  value: number;
  figure: string;
  line: string;
  fresh: string;
  detail: string[];
  /** A state the reading forces whatever the average says (a site down is always worth a look). */
  force?: HealthState;
}

export interface ProjectCardLite {
  name: string;
  stale: boolean;
  days_quiet: number | null;
}

/** Inputs the home route already holds, so the Clients tile counts exactly what the screen shows. */
export interface ClientSignals {
  /** One per site the screen shows as down: its row title ("aldervt.com is down") and client. */
  sites_down: { title: string; client: string | null }[];
  mail_waiting: { who: string; subject: string; received_at: Date }[];
}

/** The shapes clientSignalsFrom reads (a home Candidate and a RawThread carry these). */
export interface SignalCandidate {
  key: string;
  kind: string;
  rule: string | null;
  parked: boolean;
  fyi?: boolean;
  item: { type: string; title: string; who: string | null };
}
export interface SignalThread {
  account: string;
  thread_id: string;
  asks: { from_name: string | null; from_email: string; subject: string; received_at: Date }[];
}

/** Sites down and client emails waiting, read from what the home screen already selected: the same rows it shows, nothing recounted. */
export function clientSignalsFrom(candidates: readonly SignalCandidate[], threads: readonly SignalThread[]): ClientSignals {
  const byKey = new Map(threads.map((t) => [`thread:${t.account}:${t.thread_id}`, t]));
  const seen = new Set<string>();
  const sites_down: ClientSignals['sites_down'] = [];
  const mail_waiting: ClientSignals['mail_waiting'] = [];
  for (const c of candidates) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    if (c.rule === 'site_down') {
      sites_down.push({ title: c.item.title, client: c.item.who });
      continue;
    }
    // A client thread waiting on him (an emergency thread is still one); a sales lead, an FYI copy or one he parked is not.
    if (c.kind !== 'thread' || (c.item.type !== 'owed_reply' && c.item.type !== 'emergency') || c.fyi || c.parked) continue;
    const newest = byKey.get(c.key)?.asks[0];
    if (!newest) continue;
    mail_waiting.push({ who: newest.from_name || newest.from_email, subject: newest.subject, received_at: newest.received_at });
  }
  mail_waiting.sort((a, b) => a.received_at.getTime() - b.received_at.getTime());
  return { sites_down, mail_waiting };
}

export async function readReadyToInvoice(db: PrismaClient, now: Date, timezone: string): Promise<Reading> {
  const today = getZonedDateString(now, timezone);
  const byClient = new Map<string, { name: string; amount: number }>();
  const add = (id: string | null | undefined, name: string | null | undefined, amount: number) => {
    if (!id || amount <= 0) return;
    const cur = byClient.get(id) ?? { name: name ?? 'A client', amount: 0 };
    cur.amount += amount;
    byClient.set(id, cur);
  };

  const [milestones, scheduled, tasks, copied] = await Promise.all([
    db.milestone.findMany({
      where: { billing_status: 'triggered' },
      select: { billing_amount: true, project: { select: { client: { select: { id: true, name: true } } } } },
    }),
    db.scheduledInvoice.findMany({
      where: { sent_at: null, status: { in: ['pending', 'due', 'notified'] } },
      select: { status: true, sent_at: true, notified_at: true, due_on: true, amount_cached: true, client: { select: { id: true, name: true } } },
    }),
    db.task.findMany({
      where: {
        status: 'done',
        invoiced: false,
        is_deleted: false,
        is_billable: true,
        is_support: false,
        OR: [{ project_id: null }, { project: { billing_type: { not: 'fixed' } } }, { project: { billing_type: null } }],
        time_entries: { some: { is_billable: true, is_deleted: false } },
        NOT: { time_entries: { some: { is_running: true, is_deleted: false } } },
      },
      select: {
        billing_amount: true,
        client: { select: { id: true, name: true, hourly_rate: true, retainer_hours: true } },
        project: { select: { hourly_rate: true, client: { select: { id: true, name: true, hourly_rate: true, retainer_hours: true } } } },
        time_entries: { where: { is_billable: true, is_deleted: false }, select: { duration: true } },
      },
    }),
    lastQuickBooksCopy(db).catch(() => null),
  ]);

  for (const m of milestones) add(m.project?.client?.id, m.project?.client?.name, num(m.billing_amount));
  for (const s of scheduled) if (isReadyToSend(s, today)) add(s.client?.id, s.client?.name, num(s.amount_cached));
  for (const t of tasks) {
    const client = t.project?.client ?? t.client;
    if (!client) continue;
    if (num(client.retainer_hours) > 0) continue; // the retainer covers these hours
    const minutes = t.time_entries.reduce((s, e) => s + (e.duration ?? 0), 0);
    const rate = num(t.project?.hourly_rate) || num(client.hourly_rate);
    const amount = t.billing_amount !== null && t.billing_amount !== undefined ? num(t.billing_amount) : (minutes / 60) * rate;
    add(client.id, client.name, amount);
  }

  const clients = [...byClient.values()].sort((a, b) => b.amount - a.amount);
  const total = clients.reduce((s, c) => s + c.amount, 0);
  return {
    value: total,
    figure: money(total),
    line: clients.length === 0 ? 'Nothing waiting' : plural(clients.length, 'client', 'clients'),
    // Its own figures are live in Citadel; like every money tile it also says when QuickBooks was last copied.
    fresh: `Live. QuickBooks copy ${copyTime(copied, now, timezone) ?? 'not made yet'}`,
    detail: clients.slice(0, DETAIL_ROWS).map((c) => `${c.name}: ${money(c.amount)}`),
  };
}

export async function readOwedToUs(db: PrismaClient, now: Date, timezone: string): Promise<Reading> {
  const today = getZonedDateString(now, timezone);
  const oldest = addDays(today, -LATE_LIMIT_DAYS);
  const [rows, older, last] = await Promise.all([
    db.clientInvoice.findMany({
      where: {
        status: { in: ['open', 'overdue'] },
        balance: { gt: 0 },
        // under 90 days late: due before today and after the day exactly 90 days ago (an invoice 90 days late is left out)
        due_date: { lt: new Date(`${today}T00:00:00.000Z`), gt: new Date(`${oldest}T00:00:00.000Z`) },
      },
      select: { balance: true, client: { select: { id: true, name: true } } },
    }),
    db.clientInvoice.count({
      where: { status: { in: ['open', 'overdue'] }, balance: { gt: 0 }, due_date: { lte: new Date(`${oldest}T00:00:00.000Z`) } },
    }),
    lastQuickBooksCopy(db),
  ]);
  const byClient = new Map<string, { name: string; amount: number; count: number }>();
  for (const r of rows) {
    const id = r.client?.id ?? 'none';
    const cur = byClient.get(id) ?? { name: r.client?.name ?? 'A client', amount: 0, count: 0 };
    cur.amount += num(r.balance);
    cur.count += 1;
    byClient.set(id, cur);
  }
  const total = rows.reduce((s, r) => s + num(r.balance), 0);
  const detail = [...byClient.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, DETAIL_ROWS)
    .map((c) => `${c.name}: ${money(c.amount)}, ${plural(c.count, 'invoice', 'invoices')}`);
  if (older > 0) detail.push(`${plural(older, 'invoice', 'invoices')} 90 days late or more are left out.`);
  return {
    value: total,
    figure: money(total),
    line: rows.length === 0 ? 'Nothing late' : `${plural(rows.length, 'invoice', 'invoices')} late`,
    fresh: copiedLabel(last, now, timezone),
    detail,
  };
}

/** The first instant of his current month, as a UTC Date (his zone's midnight on the 1st). */
export function monthStart(now: Date, timezone: string): Date {
  const today = getZonedDateString(now, timezone);
  const first = `${today.slice(0, 8)}01`;
  // The first whole hour whose local date in his zone reads the 1st (zones here are whole-hour offsets from UTC).
  const base = new Date(`${first}T00:00:00.000Z`).getTime();
  for (let h = -14; h <= 14; h++) {
    const t = new Date(base + h * 3_600_000);
    if (getZonedDateString(t, timezone) === first) return t;
  }
  return new Date(`${first}T00:00:00.000Z`);
}

export async function readSales(db: PrismaClient, now: Date, timezone: string): Promise<Reading> {
  const [out, signed] = await Promise.all([
    db.accord.findMany({
      where: { is_deleted: false, status: { in: ['proposal', 'contract'] } },
      select: { name: true, status: true },
      orderBy: { entered_current_status_at: 'asc' },
    }),
    db.accord.findMany({
      where: { is_deleted: false, signed_at: { gte: monthStart(now, timezone) } },
      select: { name: true },
      orderBy: { signed_at: 'asc' },
    }),
  ]);
  const detail = out.slice(0, DETAIL_ROWS).map((d) => `Out: ${d.name}${d.status === 'contract' ? ', contract sent' : ''}`);
  for (const d of signed.slice(0, 3)) detail.push(`Signed this month: ${d.name}`);
  return {
    value: out.length,
    figure: `${out.length} out`,
    line: `${signed.length} signed this month`,
    fresh: 'Live',
    detail,
  };
}

export function readProjects(cards: ProjectCardLite[]): Reading {
  const stuck = cards.filter((c) => c.stale);
  const moving = cards.length - stuck.length;
  return {
    value: stuck.length,
    figure: `${moving} · ${stuck.length}`,
    line: 'moving · stuck',
    fresh: 'Live',
    detail: stuck
      .sort((a, b) => (b.days_quiet ?? 0) - (a.days_quiet ?? 0))
      .slice(0, DETAIL_ROWS)
      .map((c) => (c.days_quiet !== null ? `${c.name}: no movement in ${plural(c.days_quiet, 'day', 'days')}` : `${c.name}: no movement yet`)),
  };
}

export function readClients(signals: ClientSignals, now: Date): Reading {
  const down = signals.sites_down;
  const waiting = signals.mail_waiting.filter((m) => now.getTime() - m.received_at.getTime() > MAIL_WAIT_MS);
  const detail = [
    ...down.map((s) => `${s.title.replace(/\.$/, '')}${s.client ? ` (${s.client})` : ''}`),
    ...waiting.slice(0, DETAIL_ROWS).map((m) => `Waiting over a day: ${m.who}, ${m.subject}`),
  ];
  return {
    value: down.length + waiting.length,
    figure: down.length === 0 ? 'All up' : `${down.length} down`,
    line: waiting.length === 0 ? 'No mail over a day' : `${plural(waiting.length, 'email', 'emails')} over a day`,
    fresh: 'Live',
    detail,
    force: down.length > 0 ? 'look' : undefined,
  };
}

/** Agents: cards finished in the last 7 days, with its usual from the 12 weeks before that (counted, not snapshotted). */
export async function readAgents(db: PrismaClient, now: Date, timezone: string): Promise<{ reading: Reading; usual: number }> {
  const today = getZonedDateString(now, timezone);
  const since = new Date(now.getTime() - 13 * 7 * DAY_MS - DAY_MS);
  const rows = await db.task.findMany({
    where: { status: 'done', is_deleted: false, assignee_id: { in: [...BOT_USER_IDS] }, completed_at: { gte: since } },
    select: { completed_at: true, assignee: { select: { name: true } } },
  });
  const days = rows.flatMap((r) => (r.completed_at ? [getZonedDateString(r.completed_at, timezone)] : []));
  const weekAgo = addDays(today, -6);
  const thisWeek = rows.filter((r) => r.completed_at && getZonedDateString(r.completed_at, timezone) >= weekAgo);
  const totals = weeklyTotals(days, today);
  const usual = totals.reduce((s, n) => s + n, 0) / totals.length;
  const byWho = new Map<string, number>();
  for (const r of thisWeek) byWho.set(r.assignee?.name ?? 'An agent', (byWho.get(r.assignee?.name ?? 'An agent') ?? 0) + 1);
  return {
    reading: {
      value: thisWeek.length,
      figure: String(thisWeek.length),
      line: 'cards this week',
      fresh: 'Live',
      detail: [...byWho.entries()].sort((a, b) => b[1] - a[1]).map(([who, n]) => `${who}: ${plural(n, 'card', 'cards')} in the last 7 days`),
    },
    usual,
  };
}

// ---------------------------------------------------------------------------- tiles

interface TileSpec {
  id: HealthTileId;
  label: string;
  /** The snapshot measure name, or null when its usual is counted straight from history (Agents). */
  measure: string | null;
  direction: HealthDirection;
  /** The smallest move worth a look, in the measure's own unit. */
  floor: number;
  isMoney: boolean;
  href: string | null;
  href_label: string | null;
}

export const TILE_SPECS: readonly TileSpec[] = [
  { id: 'ready_to_invoice', label: 'Ready to invoice', measure: 'ready_to_invoice', direction: 'up_is_bad', floor: 500, isMoney: true, href: '/billing', href_label: 'Open billing' },
  { id: 'owed_to_us', label: 'Owed to us', measure: 'owed_to_us', direction: 'up_is_bad', floor: 500, isMoney: true, href: '/billing', href_label: 'Open billing' },
  { id: 'sales', label: 'Sales', measure: 'sales_out', direction: 'down_is_bad', floor: 1, isMoney: false, href: '/deals', href_label: 'Open deals' },
  { id: 'projects', label: 'Projects', measure: 'projects_stuck', direction: 'up_is_bad', floor: 2, isMoney: false, href: '/projects', href_label: 'Open projects' },
  { id: 'clients', label: 'Clients', measure: 'clients_issues', direction: 'up_is_bad', floor: 2, isMoney: false, href: '/sites', href_label: 'Open sites' },
  { id: 'agents', label: 'Agents', measure: null, direction: 'down_is_bad', floor: 5, isMoney: false, href: null, href_label: null },
];

const STATE_LABEL: Record<HealthState, string> = { normal: 'Normal', look: 'Look at this', building: 'No usual yet', unknown: 'Could not read' };

const round1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Builds one tile from its reading and its usual. Pure. `usual` null = not enough history; `historyDays` is shown while it builds. */
export function buildTile(spec: TileSpec, reading: Reading | null, usual: number | null, historyDays: number): HealthTile {
  const base = { id: spec.id, label: spec.label, href: spec.href, href_label: spec.href_label };
  if (!reading) {
    return { ...base, figure: 'Not available', line: 'This source could not be read', state: 'unknown', state_label: 'Could not read', usual: '', fresh: '', detail: [] };
  }
  const look = reading.force === 'look' || needsALook(reading.value, usual, spec.direction, spec.floor);
  // With no usual yet the tile never claims Normal: it says so, unless something forces a look (a site down).
  const state: HealthState = look ? 'look' : usual === null ? 'building' : 'normal';
  const usualText =
    usual === null
      ? `Building its 12 week average (${plural(historyDays, 'day', 'days')} so far)`
      : `Usual ${spec.isMoney ? money(usual) : round1(usual)}`;
  const detail = [...reading.detail];
  if (usual !== null) detail.push(`12 week average: ${spec.isMoney ? money(usual) : round1(usual)}${spec.id === 'agents' ? ' a week' : ''}.`);
  return {
    ...base,
    figure: reading.figure,
    line: reading.line,
    state,
    state_label: STATE_LABEL[state],
    usual: usualText,
    fresh: reading.fresh,
    detail,
  };
}

const WORDS = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const word = (n: number): string => WORDS[n] ?? String(n);

/** "All six are normal." / "Five of six are normal. One needs a look." / "... Two are still building their 12 week average." / "... One could not be read." */
export function summaryLine(tiles: HealthTile[]): string {
  const total = tiles.length;
  const count = (s: HealthState) => tiles.filter((t) => t.state === s).length;
  const [normal, look, building, unknown] = [count('normal'), count('look'), count('building'), count('unknown')];
  const all = word(total).toLowerCase();
  if (normal === total) return `All ${all} are normal.`;
  if (building === total) return `All ${all} are still building their 12 week average.`;
  const parts: string[] = [];
  if (normal > 0) parts.push(`${word(normal)} of ${all} ${normal === 1 ? 'is' : 'are'} normal.`);
  if (look > 0) parts.push(`${word(look)} ${look === 1 ? 'needs' : 'need'} a look.`);
  if (building > 0) parts.push(`${word(building)} ${building === 1 ? 'is' : 'are'} still building ${building === 1 ? 'its' : 'their'} 12 week average.`);
  if (unknown > 0) parts.push(`${word(unknown)} could not be read.`);
  return parts.join(' ');
}

export interface LoadHealthInput {
  now: Date;
  timezone: string;
  clients: ClientSignals;
  /** Reads the projects tab's cards; a rejection marks the Projects tile unreadable. */
  projects: () => Promise<ProjectCardLite[]>;
}

/** Reads every source, stores today's reading per measure (the last one of the day wins), and builds the six tiles. */
export async function loadHomeHealth(db: PrismaClient, input: LoadHealthInput): Promise<HomeHealth> {
  const { now, timezone } = input;
  const today = getZonedDateString(now, timezone);
  const settle = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  const [ready, owed, sales, projectCards, agents] = await Promise.all([
    settle(readReadyToInvoice(db, now, timezone)),
    settle(readOwedToUs(db, now, timezone)),
    settle(readSales(db, now, timezone)),
    settle(input.projects()),
    settle(readAgents(db, now, timezone)),
  ]);
  const readings: Record<HealthTileId, Reading | null> = {
    ready_to_invoice: ready,
    owed_to_us: owed,
    sales,
    projects: projectCards ? readProjects(projectCards) : null,
    clients: readClients(input.clients, now),
    agents: agents?.reading ?? null,
  };

  // Today's reading per measure. A failed write never stops the tiles.
  const measured = TILE_SPECS.filter((s) => s.measure && readings[s.id]);
  const day = new Date(`${today}T00:00:00.000Z`);
  await Promise.all(
    measured.map((s) =>
      db.healthSnapshot
        .upsert({
          where: { measure_day: { measure: s.measure!, day } },
          create: { measure: s.measure!, day, value: readings[s.id]!.value },
          update: { value: readings[s.id]!.value },
        })
        .catch(() => null),
    ),
  );

  let history: { measure: string; day: Date; value: Moneyish }[] = [];
  try {
    history = await db.healthSnapshot.findMany({
      where: { measure: { in: TILE_SPECS.flatMap((s) => (s.measure ? [s.measure] : [])) }, day: { gte: new Date(`${windowStart(today)}T00:00:00.000Z`) } },
      select: { measure: true, day: true, value: true },
    });
  } catch {
    history = [];
  }
  const pointsFor = (measure: string): HealthPoint[] =>
    history.filter((h) => h.measure === measure).map((h) => ({ day: h.day.toISOString().slice(0, 10), value: num(h.value) }));

  const tiles = TILE_SPECS.map((spec) => {
    const reading = readings[spec.id];
    if (spec.id === 'agents') return buildTile(spec, reading, agents ? agents.usual : null, 84);
    const { average, days } = twelveWeekAverage(pointsFor(spec.measure!), today);
    return buildTile(spec, reading, average, days);
  });

  return { summary: summaryLine(tiles), tiles, generated_at: now.toISOString() };
}
