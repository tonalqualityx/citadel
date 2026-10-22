import { describe, it, expect, vi, beforeEach } from 'vitest';

// Parallel POSTs must not beat the rate limits. The mocked transaction models Postgres:
// pg_advisory_xact_lock(hashtext(key)) blocks other transactions that ask for the same key until
// the holder finishes, and every read and write yields to the event loop so an unlocked
// read-then-write really does interleave.
interface Row { id: string; client_id: string; requested_by_contact_id: string; source: string; source_ref: string; tags: string[]; created_at: Date }
const store: { rows: Row[]; useLocks: boolean } = { rows: [], useLocks: true };
const queues = new Map<string, Promise<void>>();

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function makeTx() {
  const releases: Array<() => void> = [];
  const tx = {
    async $executeRaw(_strings: unknown, key: string) {
      if (!store.useLocks) return;
      const prev = queues.get(key) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((r) => (release = r));
      queues.set(key, prev.then(() => mine));
      await prev; // wait for the holder
      releases.push(release);
    },
    task: {
      async findFirst({ where }: { where: { source_ref: string } }) {
        await tick();
        return store.rows.find((r) => r.source_ref === where.source_ref) ?? null;
      },
      async count({ where }: { where: Record<string, any> }) { // eslint-disable-line @typescript-eslint/no-explicit-any
        await tick();
        return store.rows.filter((r) => {
          if (where.requested_by_contact_id && !where.requested_by_contact_id.in.includes(r.requested_by_contact_id)) return false;
          if (where.client_id && r.client_id !== where.client_id) return false;
          if (where.tags && !r.tags.includes(where.tags.has)) return false;
          return r.created_at >= where.created_at.gte;
        }).length;
      },
      async create({ data }: { data: Record<string, any> }) { // eslint-disable-line @typescript-eslint/no-explicit-any
        await tick();
        const row: Row = { id: `t${store.rows.length + 1}`, client_id: data.client_id, requested_by_contact_id: data.requested_by_contact_id, source: 'portal', source_ref: data.source_ref, tags: data.tags, created_at: new Date() };
        store.rows.push(row);
        return { ...row, title: data.title, client_title: data.client_title, status: 'not_started', staging_preview_url: null, approved: false, client_approved_at: null, project_id: null, charter_id: null, assignee_id: data.assignee_id, site_id: null, project: null, charter: null, site: null };
      },
    },
    site: { findMany: async () => [] },
    project: { findMany: async () => [] },
    charter: { findMany: async () => [] },
    user: { findFirst: async () => null },
  };
  return { tx, release: () => releases.forEach((r) => r()) };
}

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    async $transaction(fn: (t: unknown) => Promise<unknown>) {
      const { tx, release } = makeTx();
      try { return await fn(tx); } finally { release(); }
    },
  },
}));
vi.mock('@/lib/portal/waits', () => ({ onRequestFiled: vi.fn(async () => []) }));
vi.mock('@/lib/portal/staff-notify', () => ({ notifyNewPortalRequest: vi.fn(async () => ({ notified: true, emailed: true })) }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn(async () => ({})) }));
vi.mock('@/lib/services/notifications', () => ({ createInAppNotificationOnly: vi.fn(async () => ({})) }));

import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { createInAppNotificationOnly } from '@/lib/services/notifications';
import { fileRequest, LIMITS, type FileRequestBody } from '../file-request';

const NOW = new Date();
const contact = { id: 'ct1', name: 'Dana' };
const other = (i: number): FileRequestBody => ({
  intake_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  type: 'other',
  answers: [{ key: 'q1', value: `thing ${i}` }, { key: 'q2', value: 'not_really' }],
});
const urgent = (i: number): FileRequestBody => ({
  intake_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  type: 'broken',
  answers: [{ key: 'q1', value: 'site_down' }],
});

beforeEach(() => {
  store.rows = [];
  store.useLocks = true;
  queues.clear();
  vi.clearAllMocks();
});

const settle = (ps: Array<Promise<unknown>>) => Promise.allSettled(ps);

describe('parallel POSTs and the rate limits', () => {
  it('thirty parallel requests from one person: exactly twenty get through, ten are 429', async () => {
    const access = { contactId: 'ct1', clientId: 'cl1', role: 'owner' as const };
    const results = await settle(Array.from({ length: 30 }, (_, i) => fileRequest(access, contact, other(i + 1), { now: NOW })));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(LIMITS.per_hour);
    expect(bad).toHaveLength(10);
    for (const b of bad) expect(b.reason).toMatchObject({ statusCode: 429 });
    expect(store.rows).toHaveLength(LIMITS.per_hour);
  });

  it('the harness is honest: without the locks the same burst overshoots the limit', async () => {
    store.useLocks = false;
    const access = { contactId: 'ct1', clientId: 'cl1', role: 'owner' as const };
    await settle(Array.from({ length: 30 }, (_, i) => fileRequest(access, contact, other(i + 1), { now: NOW })));
    expect(store.rows.length).toBeGreaterThan(LIMITS.per_hour);
  });

  it('the same intake_id sent in parallel files once', async () => {
    const access = { contactId: 'ct1', clientId: 'cl1', role: 'owner' as const };
    const results = await settle(Array.from({ length: 5 }, () => fileRequest(access, contact, other(1), { now: NOW })));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it('a person with two contact rows is limited as one person', async () => {
    const results = await settle([
      ...Array.from({ length: 15 }, (_, i) => fileRequest({ contactId: 'ct1', contactIds: ['ct1', 'ct2'], clientId: 'cl1', role: 'owner' }, contact, other(i + 1), { now: NOW })),
      ...Array.from({ length: 15 }, (_, i) => fileRequest({ contactId: 'ct2', contactIds: ['ct1', 'ct2'], clientId: 'cl1', role: 'owner' }, { id: 'ct2', name: 'Dana' }, other(i + 101), { now: NOW })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(LIMITS.per_hour);
  });

  it('different people are not blocked by each other\'s counts', async () => {
    const a = { contactId: 'ct1', clientId: 'cl1', role: 'owner' as const };
    const b = { contactId: 'ct2', clientId: 'cl1', role: 'member' as const };
    const results = await settle([
      ...Array.from({ length: 4 }, (_, i) => fileRequest(a, contact, other(i + 1), { now: NOW })),
      ...Array.from({ length: 4 }, (_, i) => fileRequest(b, { id: 'ct2', name: 'Mia' }, other(i + 21), { now: NOW })),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});

describe('parallel emergencies', () => {
  it('six parallel urgent requests from two people: three alert, three are downgraded', async () => {
    const a = { contactId: 'ct1', clientId: 'cl1', role: 'owner' as const };
    const b = { contactId: 'ct2', clientId: 'cl1', role: 'member' as const };
    const results = await settle([
      ...[1, 2, 3].map((i) => fileRequest(a, contact, urgent(i), { now: NOW })),
      ...[4, 5, 6].map((i) => fileRequest(b, { id: 'ct2', name: 'Mia' }, urgent(i), { now: NOW })),
    ]);
    const filed = results.map((r) => (r as PromiseFulfilledResult<{ urgent: boolean }>).value);
    expect(filed.filter((f) => f.urgent)).toHaveLength(LIMITS.emergencies_per_day);
    expect(filed.filter((f) => !f.urgent)).toHaveLength(3);
    expect(dispatchNotification).toHaveBeenCalledTimes(3);
    expect(createInAppNotificationOnly).toHaveBeenCalledTimes(3);
    expect(store.rows.filter((r) => r.tags.includes('emergency'))).toHaveLength(3);
  });
});
