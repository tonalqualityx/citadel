import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  TILE_SPECS,
  buildTile,
  clientSignalsFrom,
  copiedLabel,
  loadHomeHealth,
  monthStart,
  readClients,
  readProjects,
  summaryLine,
  type ClientSignals,
} from '../load';
import type { HealthState } from '../types';

const TZ = 'America/New_York';
const NOW = new Date('2026-11-28T15:00:00.000Z'); // 10:00 AM in New York, Saturday Nov 28
const BAST = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';
const spec = (id: string) => TILE_SPECS.find((s) => s.id === id)!;
const dayBack = (n: number) => new Date(Date.UTC(2026, 10, 28 - n));

describe('buildTile', () => {
  it('reads Normal with its usual when the number is near its 12 week average', () => {
    const t = buildTile(spec('owed_to_us'), { value: 4925, figure: '$4,925', line: '3 invoices late', fresh: 'Copied 9:47 AM', detail: [] }, 4800, 40);
    expect(t).toMatchObject({ state: 'normal', state_label: 'Normal', usual: 'Usual $4,800', fresh: 'Copied 9:47 AM' });
    expect(t.detail.at(-1)).toBe('12 week average: $4,800.');
  });

  it('reads Look at this when money owed rose well past its usual', () => {
    const t = buildTile(spec('owed_to_us'), { value: 9000, figure: '$9,000', line: '6 invoices late', fresh: 'Copied 9:47 AM', detail: [] }, 4800, 40);
    expect(t).toMatchObject({ state: 'look', state_label: 'Look at this' });
  });

  it('says it has no usual yet when there is too little history, never Normal and never flagged', () => {
    const t = buildTile(spec('sales'), { value: 0, figure: '0 out', line: '0 signed this month', fresh: 'Live', detail: [] }, null, 1);
    expect(t).toMatchObject({ state: 'building', state_label: 'No usual yet', usual: 'Building its 12 week average (1 day so far)' });
  });

  it('marks an unreadable source as Could not read, with no number', () => {
    const t = buildTile(spec('projects'), null, 3, 30);
    expect(t).toMatchObject({ state: 'unknown', state_label: 'Could not read', figure: 'Not available' });
  });
});

describe('summaryLine', () => {
  const tile = (state: HealthState) => ({ ...buildTile(spec('sales'), null, null, 0), state });
  it('counts the tiles in words', () => {
    expect(summaryLine(Array.from({ length: 6 }, () => tile('normal')))).toBe('All six are normal.');
    expect(summaryLine([...Array.from({ length: 5 }, () => tile('normal')), tile('look')])).toBe('Five of six are normal. One needs a look.');
    expect(summaryLine([...Array.from({ length: 3 }, () => tile('normal')), tile('look'), tile('look'), tile('unknown')])).toBe(
      'Three of six are normal. Two need a look. One could not be read.',
    );
    expect(summaryLine([tile('normal'), tile('building'), tile('building'), tile('building'), tile('building'), tile('look')])).toBe(
      'One of six is normal. One needs a look. Four are still building their 12 week average.',
    );
    expect(summaryLine(Array.from({ length: 6 }, () => tile('building')))).toBe('All six are still building their 12 week average.');
  });
});

describe('Clients tile', () => {
  it('counts sites down and client threads waiting over a day from what the screen selected', () => {
    const candidates = [
      { key: 'site:s1', kind: 'site', rule: 'site_down', parked: false, item: { type: 'emergency', title: 'aldervt.com is down.', who: 'Alder' } },
      { key: 'thread:mike@x.com:t1', kind: 'thread', rule: null, parked: false, item: { type: 'owed_reply', title: 'Reply', who: 'Gene' } },
      { key: 'thread:mike@x.com:t2', kind: 'thread', rule: null, parked: false, item: { type: 'owed_reply', title: 'Reply', who: 'Jo' } },
      { key: 'thread:mike@x.com:t3', kind: 'thread', rule: null, parked: true, item: { type: 'owed_reply', title: 'Parked', who: 'Al' } },
      { key: 'thread:mike@x.com:t4', kind: 'thread', rule: null, parked: false, fyi: true, item: { type: 'owed_reply', title: 'FYI', who: 'Cc' } },
      { key: 'thread:mike@x.com:t5', kind: 'thread', rule: null, parked: false, item: { type: 'lead', title: 'Lead', who: 'New' } },
    ];
    const ask = (from: string, subject: string, hoursAgo: number) => ({ from_name: from, from_email: `${from}@c.com`, subject, received_at: new Date(NOW.getTime() - hoursAgo * 3_600_000) });
    const threads = ['t1', 't2', 't3', 't4', 't5'].map((id, i) => ({ account: 'mike@x.com', thread_id: id, asks: [ask(`P${i}`, `Subject ${i}`, i === 1 ? 3 : 30)] }));
    const signals = clientSignalsFrom(candidates, threads);
    expect(signals.sites_down).toEqual([{ title: 'aldervt.com is down.', client: 'Alder' }]);
    expect(signals.mail_waiting.map((m) => m.subject)).toEqual(['Subject 0', 'Subject 1']);

    const r = readClients(signals, NOW);
    expect(r).toMatchObject({ value: 2, figure: '1 down', line: '1 email over a day', force: 'look' });
    expect(r.detail).toEqual(['aldervt.com is down (Alder)', 'Waiting over a day: P0, Subject 0']);
  });

  it('reads All up and No mail over a day when nothing waits, and a down site always needs a look', () => {
    const none: ClientSignals = { sites_down: [], mail_waiting: [] };
    expect(readClients(none, NOW)).toMatchObject({ value: 0, figure: 'All up', line: 'No mail over a day', force: undefined });
    const down = buildTile(spec('clients'), readClients({ sites_down: [{ title: 'a.com is down.', client: null }], mail_waiting: [] }, NOW), 5, 30);
    expect(down.state).toBe('look');
  });
});

describe('Projects tile', () => {
  it('shows moving and stuck, compares the stuck count, and lists the quietest first', () => {
    const r = readProjects([
      { name: 'A', stale: false, days_quiet: 1 },
      { name: 'B', stale: true, days_quiet: 9 },
      { name: 'C', stale: true, days_quiet: 20 },
    ]);
    expect(r).toMatchObject({ value: 2, figure: '1 · 2', line: 'moving · stuck' });
    expect(r.detail).toEqual(['C: no movement in 20 days', 'B: no movement in 9 days']);
  });
});

describe('time helpers', () => {
  it('writes the last copy time in his zone, with the day when it is not today', () => {
    expect(copiedLabel(new Date('2026-11-28T14:47:00.000Z'), NOW, TZ)).toBe('Copied 9:47 AM');
    expect(copiedLabel(new Date('2026-11-26T15:07:00.000Z'), NOW, TZ)).toBe('Copied Nov 26, 10:07 AM');
    expect(copiedLabel(null, NOW, TZ)).toBe('No copy yet');
  });

  it('finds midnight on the 1st of his month', () => {
    expect(monthStart(NOW, TZ).toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});

// A fake Prisma with just the calls loadHomeHealth makes.
function fakeDb(opts: { invoicesFail?: boolean; snapshots?: { measure: string; day: Date; value: number }[] } = {}) {
  const upserts: { measure: string; value: number }[] = [];
  const db = {
    milestone: { findMany: vi.fn(async () => [{ billing_amount: 1500, project: { client: { id: 'c1', name: 'Acme' } } }]) },
    scheduledInvoice: {
      findMany: vi.fn(async () => [
        { status: 'due', sent_at: null, notified_at: null, due_on: dayBack(1), amount_cached: 500, client: { id: 'c2', name: 'Beta' } },
        { status: 'pending', sent_at: null, notified_at: null, due_on: new Date('2026-12-15T00:00:00.000Z'), amount_cached: 900, client: { id: 'c3', name: 'Later' } },
      ]),
    },
    task: {
      findMany: vi.fn(async (args: { where: { assignee_id?: unknown } }) => {
        if (args.where.assignee_id) {
          // agents: 4 cards in the last 7 days, and 24 in the 12 weeks before (2 a week)
          const recent = Array.from({ length: 4 }, () => ({ completed_at: new Date(NOW.getTime() - 86_400_000), assignee: { name: 'Bast' } }));
          const older = Array.from({ length: 24 }, (_, i) => ({ completed_at: new Date(NOW.getTime() - (8 + i * 3) * 86_400_000), assignee: { name: 'Bast' } }));
          return [...recent, ...older];
        }
        return [
          // hourly work for a client with no retainer: 90 minutes at $100
          { billing_amount: null, client: { id: 'c2', name: 'Beta', hourly_rate: 100, retainer_hours: null }, project: null, time_entries: [{ duration: 60 }, { duration: 30 }] },
          // a retainer client: covered, not counted
          { billing_amount: null, client: { id: 'c4', name: 'Retained', hourly_rate: 100, retainer_hours: 10 }, project: null, time_entries: [{ duration: 600 }] },
        ];
      }),
    },
    clientInvoice: {
      findMany: vi.fn(async () => {
        if (opts.invoicesFail) throw new Error('down');
        return [
          { balance: 1000, client: { id: 'c1', name: 'Acme' } },
          { balance: 250, client: { id: 'c1', name: 'Acme' } },
        ];
      }),
      count: vi.fn(async () => 77),
      aggregate: vi.fn(async () => ({ _max: { synced_at: new Date('2026-11-28T14:47:00.000Z') } })),
    },
    accord: {
      findMany: vi.fn(async (args: { where: { status?: unknown } }) =>
        args.where.status ? [{ name: 'Deal A', status: 'proposal' }, { name: 'Deal B', status: 'contract' }] : [{ name: 'Deal C' }],
      ),
    },
    healthSnapshot: {
      upsert: vi.fn(async (args: { create: { measure: string; value: number } }) => {
        upserts.push({ measure: args.create.measure, value: args.create.value });
        return {};
      }),
      findMany: vi.fn(async () => opts.snapshots ?? []),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db, upserts };
}

describe('loadHomeHealth', () => {
  const clients: ClientSignals = { sites_down: [], mail_waiting: [] };
  const projects = async () => [
    { name: 'P1', stale: false, days_quiet: 1 },
    { name: 'P2', stale: true, days_quiet: 10 },
  ];

  it('builds the six tiles in order, stores today per measure, and compares against the stored days', async () => {
    const snapshots = Array.from({ length: 10 }, (_, i) => ({ measure: 'owed_to_us', day: dayBack(i + 1), value: 400 }));
    const { db, upserts, raw } = fakeDb({ snapshots });
    const h = await loadHomeHealth(db, { now: NOW, timezone: TZ, clients, projects });

    expect(h.tiles.map((t) => t.id)).toEqual(['ready_to_invoice', 'owed_to_us', 'sales', 'projects', 'clients', 'agents']);
    const [ready, owed, sales, proj, cl, agents] = h.tiles;
    expect(ready).toMatchObject({ figure: '$2,150', line: '2 clients', fresh: 'Live. QuickBooks copy 9:47 AM', state: 'building' }); // 1500 + 500 + 150; the December invoice and the retainer work are out
    expect(ready.detail).toEqual(['Acme: $1,500', 'Beta: $650']);
    expect(owed).toMatchObject({ figure: '$1,250', line: '2 invoices late', fresh: 'Copied 9:47 AM', usual: 'Usual $400', state: 'look' });
    expect(owed.detail).toContain('77 invoices 90 days late or more are left out.');
    expect(sales).toMatchObject({ figure: '2 out', line: '1 signed this month' });
    expect(proj).toMatchObject({ figure: '1 · 1', line: 'moving · stuck' });
    expect(cl).toMatchObject({ figure: 'All up', state: 'building' });
    expect(agents).toMatchObject({ figure: '4', line: 'cards this week', usual: 'Usual 2', state: 'normal' });
    expect(h.summary).toBe('One of six is normal. One needs a look. Four are still building their 12 week average.');

    // Owed counts only invoices under 90 days late: due before today and strictly after the day 90 days ago, so one exactly 90 days late is out.
    const where = (raw.clientInvoice.findMany.mock.calls[0] as unknown as [{ where: { due_date: { lt: Date; gt: Date; gte?: Date } } }])[0].where;
    expect(where.due_date.lt.toISOString()).toBe('2026-11-28T00:00:00.000Z');
    expect(where.due_date.gt.toISOString()).toBe('2026-08-30T00:00:00.000Z');
    expect(where.due_date.gte).toBeUndefined();
    const olderWhere = (raw.clientInvoice.count.mock.calls[0] as unknown as [{ where: { due_date: { lte: Date } } }])[0].where;
    expect(olderWhere.due_date.lte.toISOString()).toBe('2026-08-30T00:00:00.000Z');

    expect(upserts).toEqual([
      { measure: 'ready_to_invoice', value: 2150 },
      { measure: 'owed_to_us', value: 1250 },
      { measure: 'sales_out', value: 2 },
      { measure: 'projects_stuck', value: 1 },
      { measure: 'clients_issues', value: 0 },
    ]);
  });

  it('keeps the other tiles when one source fails, and stores nothing for the failed one', async () => {
    const { db, upserts } = fakeDb({ invoicesFail: true });
    const h = await loadHomeHealth(db, { now: NOW, timezone: TZ, clients, projects: async () => Promise.reject(new Error('no')) });
    expect(h.tiles.find((t) => t.id === 'owed_to_us')).toMatchObject({ state: 'unknown' });
    expect(h.tiles.find((t) => t.id === 'projects')).toMatchObject({ state: 'unknown' });
    expect(h.tiles.filter((t) => t.state === 'unknown')).toHaveLength(2);
    expect(upserts.map((u) => u.measure)).toEqual(['ready_to_invoice', 'sales_out', 'clients_issues']);
    expect(h.summary).toBe('One of six is normal. Three are still building their 12 week average. Two could not be read.');
  });

  it('agents finished cards are counted for bot users only', async () => {
    const { db, raw } = fakeDb();
    await loadHomeHealth(db, { now: NOW, timezone: TZ, clients, projects });
    const agentCall = raw.task.findMany.mock.calls.find((c) => (c as unknown as [{ where: { assignee_id?: { in: string[] } } }])[0].where.assignee_id);
    expect((agentCall as unknown as [{ where: { assignee_id: { in: string[] } } }])[0].where.assignee_id.in).toContain(BAST);
  });
});
