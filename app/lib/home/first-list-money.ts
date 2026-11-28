/**
 * Money to collect, for the first list. Three tables, read only:
 *   ClientInvoice (the QuickBooks mirror): unpaid with a balance and a due date before today in his zone. The sync writes
 *     status open, paid, overdue or void; open and overdue are the unpaid kinds (a void or paid one is never read).
 *   ScheduledInvoice (the billing schedule): not yet sent (sent_at null) and still pending, due or notified. It is ready to send
 *     when its status is due or notified, or notified_at is set, or its due_on is today or earlier.
 *   Milestone: billing_status triggered (ready to invoice), amount = billing_amount.
 * A failure in any one table gives no rows for it, never an error: the screen must open without money before it fails.
 */
import type { PrismaClient } from '@prisma/client';
import { getZonedDateString } from '@/lib/utils/time';
import type { HomeMoneyRow } from './types';

const UNPAID_STATUSES = ['open', 'overdue'];
const SCHEDULED_PENDING_STATUSES = ['pending', 'due', 'notified'];
const SCHEDULED_READY_STATUSES = ['due', 'notified'];

type Moneyish = { toString(): string } | number | null | undefined;

function num(v: Moneyish): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

/** A Prisma @db.Date value as YYYY-MM-DD (it is stored as that UTC calendar day). */
function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export interface InvoiceFacts {
  status: string;
  balance: Moneyish;
  due_date: Date | null;
}

/** Unpaid: not void or paid, something still owed, and the due date is before today. */
export function isUnpaidInvoice(inv: InvoiceFacts, today: string): boolean {
  if (!UNPAID_STATUSES.includes(inv.status)) return false;
  const balance = num(inv.balance);
  if (balance === null || balance <= 0) return false;
  const due = ymd(inv.due_date);
  return due !== null && due < today;
}

export interface ScheduledFacts {
  status: string;
  sent_at: Date | null;
  notified_at: Date | null;
  due_on: Date | null;
}

/** Ready to send: not sent, still pending, due or notified, and either flagged (due, notified) or its day has come. */
export function isReadyToSend(s: ScheduledFacts, today: string): boolean {
  if (s.sent_at) return false;
  if (!SCHEDULED_PENDING_STATUSES.includes(s.status)) return false;
  if (SCHEDULED_READY_STATUSES.includes(s.status) || s.notified_at) return true;
  const due = ymd(s.due_on);
  return due !== null && due <= today;
}

export async function loadMoneyToCollect(prisma: PrismaClient, now: Date, timezone: string): Promise<HomeMoneyRow[]> {
  const today = getZonedDateString(now, timezone);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const out: HomeMoneyRow[] = [];

  try {
    const rows = await prisma.clientInvoice.findMany({
      where: { status: { in: UNPAID_STATUSES }, balance: { gt: 0 }, due_date: { lt: todayDate } },
      select: {
        id: true,
        doc_number: true,
        due_date: true,
        balance: true,
        status: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { balance: 'desc' },
      take: 50,
    });
    for (const r of rows) {
      if (!isUnpaidInvoice(r, today)) continue;
      out.push({
        key: `invoice:${r.id}`,
        kind: 'unpaid_invoice',
        amount: num(r.balance),
        label: r.doc_number ? `Invoice ${r.doc_number}` : 'Invoice',
        client_id: r.client?.id ?? null,
        client_name: r.client?.name ?? null,
        project_id: null,
        project_name: null,
        due: ymd(r.due_date),
      });
    }
  } catch {
    // no unpaid invoices shown; the rest still load
  }

  try {
    const rows = await prisma.scheduledInvoice.findMany({
      where: { sent_at: null, status: { in: SCHEDULED_PENDING_STATUSES } },
      select: {
        id: true,
        status: true,
        sent_at: true,
        notified_at: true,
        due_on: true,
        amount_cached: true,
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ due_on: 'asc' }, { created_at: 'asc' }],
      take: 100,
    });
    for (const r of rows) {
      if (!isReadyToSend(r, today)) continue;
      out.push({
        key: `scheduled-invoice:${r.id}`,
        kind: 'ready_invoice',
        amount: num(r.amount_cached),
        label: 'Scheduled invoice',
        client_id: r.client?.id ?? null,
        client_name: r.client?.name ?? null,
        project_id: r.project?.id ?? null,
        project_name: r.project?.name ?? null,
        due: ymd(r.due_on),
      });
    }
  } catch {
    // no scheduled invoices shown
  }

  try {
    const rows = await prisma.milestone.findMany({
      where: { billing_status: 'triggered' },
      select: {
        id: true,
        name: true,
        billing_amount: true,
        project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
      },
      orderBy: { triggered_at: 'asc' },
      take: 50,
    });
    for (const r of rows) {
      out.push({
        key: `milestone:${r.id}`,
        kind: 'milestone',
        amount: num(r.billing_amount),
        label: `Milestone: ${r.name}`,
        client_id: r.project?.client?.id ?? null,
        client_name: r.project?.client?.name ?? null,
        project_id: r.project?.id ?? null,
        project_name: r.project?.name ?? null,
        due: null,
      });
    }
  } catch {
    // no milestones shown
  }

  return out;
}
