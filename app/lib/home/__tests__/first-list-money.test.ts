import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { isReadyToSend, isUnpaidInvoice, loadMoneyToCollect } from '../first-list-money';

const NOW = new Date('2026-11-10T15:00:00Z');
const TODAY = '2026-11-10';
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('isUnpaidInvoice', () => {
  const base = { status: 'open', balance: '100.00', due_date: D('2026-11-09') };
  it('open or overdue with a balance and a past due date', () => {
    expect(isUnpaidInvoice(base, TODAY)).toBe(true);
    expect(isUnpaidInvoice({ ...base, status: 'overdue' }, TODAY)).toBe(true);
  });
  it('not paid, void, zero balance, due today or later, or no due date', () => {
    expect(isUnpaidInvoice({ ...base, status: 'paid' }, TODAY)).toBe(false);
    expect(isUnpaidInvoice({ ...base, status: 'void' }, TODAY)).toBe(false);
    expect(isUnpaidInvoice({ ...base, balance: '0.00' }, TODAY)).toBe(false);
    expect(isUnpaidInvoice({ ...base, due_date: D('2026-11-10') }, TODAY)).toBe(false);
    expect(isUnpaidInvoice({ ...base, due_date: null }, TODAY)).toBe(false);
  });
});

describe('isReadyToSend', () => {
  const base = { status: 'pending', sent_at: null, notified_at: null, due_on: D('2026-11-10') };
  it('pending with its day come, or flagged due or notified', () => {
    expect(isReadyToSend(base, TODAY)).toBe(true);
    expect(isReadyToSend({ ...base, due_on: null, status: 'due' }, TODAY)).toBe(true);
    expect(isReadyToSend({ ...base, due_on: D('2026-12-01'), status: 'notified' }, TODAY)).toBe(true);
    expect(isReadyToSend({ ...base, due_on: D('2026-12-01'), notified_at: NOW }, TODAY)).toBe(true);
  });
  it('not when sent, paid, cancelled, or still in the future', () => {
    expect(isReadyToSend({ ...base, sent_at: NOW }, TODAY)).toBe(false);
    expect(isReadyToSend({ ...base, status: 'sent' }, TODAY)).toBe(false);
    expect(isReadyToSend({ ...base, status: 'paid' }, TODAY)).toBe(false);
    expect(isReadyToSend({ ...base, status: 'cancelled' }, TODAY)).toBe(false);
    expect(isReadyToSend({ ...base, due_on: D('2026-11-11') }, TODAY)).toBe(false);
    expect(isReadyToSend({ ...base, due_on: null }, TODAY)).toBe(false);
  });
});

type FindArgs = { where: Record<string, unknown> };
function fakePrisma(over: { invoices?: unknown; scheduled?: unknown; milestones?: unknown } = {}) {
  return {
    clientInvoice: { findMany: vi.fn(async (args: FindArgs) => (void args, over.invoices ?? [])) },
    scheduledInvoice: { findMany: vi.fn(async (args: FindArgs) => (void args, over.scheduled ?? [])) },
    milestone: { findMany: vi.fn(async (args: FindArgs) => (void args, over.milestones ?? [])) },
  };
}

describe('loadMoneyToCollect', () => {
  it('maps the three tables and filters the scheduled ones in code', async () => {
    const client = { id: 'c1', name: 'Acme' };
    const p = fakePrisma({
      invoices: [{ id: 'i1', doc_number: '1042', due_date: D('2026-11-03'), balance: '4250.00', status: 'overdue', client }],
      scheduled: [
        { id: 's1', status: 'pending', sent_at: null, notified_at: null, due_on: D('2026-11-10'), amount_cached: '800.00', client, project: { id: 'p1', name: 'Site' } },
        { id: 's2', status: 'pending', sent_at: null, notified_at: null, due_on: D('2026-12-10'), amount_cached: '900.00', client, project: null },
        { id: 's3', status: 'due', sent_at: null, notified_at: null, due_on: null, amount_cached: null, client: null, project: null },
      ],
      milestones: [{ id: 'm1', name: 'Launch', billing_amount: '1500.00', project: { id: 'p2', name: 'Shop', client } }],
    });
    const rows = await loadMoneyToCollect(p as unknown as PrismaClient, NOW, 'America/New_York');
    expect(rows.map((r) => [r.key, r.kind, r.amount])).toEqual([
      ['invoice:i1', 'unpaid_invoice', 4250],
      ['scheduled-invoice:s1', 'ready_invoice', 800],
      ['scheduled-invoice:s3', 'ready_invoice', null],
      ['milestone:m1', 'milestone', 1500],
    ]);
    expect(rows[1]).toMatchObject({ project_id: 'p1', client_id: 'c1', due: '2026-11-10' });
    expect(rows[3]).toMatchObject({ label: 'Milestone: Launch', project_id: 'p2', client_name: 'Acme' });
    const where = p.clientInvoice.findMany.mock.calls[0][0].where as { status: unknown; due_date: { lt: Date } };
    expect(where.status).toEqual({ in: ['open', 'overdue'] });
    expect(where.due_date.lt.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(p.milestone.findMany.mock.calls[0][0].where).toEqual({ billing_status: 'triggered' });
  });

  it('a table that fails gives no rows for it, the others still load', async () => {
    const p = fakePrisma({ milestones: [{ id: 'm1', name: 'Launch', billing_amount: '10', project: null }] });
    p.clientInvoice.findMany.mockRejectedValue(new Error('boom'));
    p.scheduledInvoice.findMany.mockRejectedValue(new Error('boom'));
    const rows = await loadMoneyToCollect(p as unknown as PrismaClient, NOW, 'America/New_York');
    expect(rows.map((r) => r.key)).toEqual(['milestone:m1']);
  });

  it('uses his zone for today (late evening in New York is already tomorrow in UTC)', async () => {
    const p = fakePrisma();
    await loadMoneyToCollect(p as unknown as PrismaClient, new Date('2026-11-11T02:00:00Z'), 'America/New_York');
    expect((p.clientInvoice.findMany.mock.calls[0][0].where.due_date as { lt: Date }).lt.toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });
});
