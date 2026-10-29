import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { ownsTimer, isClosingOrTerminal, ensureTimer, keepAlive, autoTimerBillable } from '../timer';
import { designerMayCall } from '@/lib/auth/designer-routes';

const session = { designer_id: 'u-owner' };

describe('timer ownership', () => {
  it('the opening designer or admin owns the timer', () => {
    expect(ownsTimer(session, { userId: 'u-owner', role: 'designer' })).toBe(true);
    expect(ownsTimer(session, { userId: 'u-owner', role: 'admin' })).toBe(true);
  });
  it('a viewing pm, another admin, another designer, or nobody gets none', () => {
    expect(ownsTimer(session, { userId: 'u-pm', role: 'pm' })).toBe(false);
    expect(ownsTimer(session, { userId: 'u-admin', role: 'admin' })).toBe(false);
    expect(ownsTimer(session, { userId: 'u-other', role: 'designer' })).toBe(false);
    expect(ownsTimer(session, { userId: 'u-owner', role: 'pm' })).toBe(false);
    expect(ownsTimer(session, undefined)).toBe(false);
  });
});

describe('designer allowlist keeps time tracking out', () => {
  it.each([
    ['GET', '/api/time-entries'],
    ['POST', '/api/time-entries'],
    ['GET', '/api/time-entries/active'],
    ['POST', '/api/time-entries/start'],
    ['POST', '/api/time-entries/2b3c4d5e-0000-4000-8000-000000000000/stop'],
    ['PATCH', '/api/time-entries/2b3c4d5e-0000-4000-8000-000000000000/stop'],
  ])('%s %s is denied', (method, path) => {
    expect(designerMayCall(method, path)).toBe(false);
  });
});

describe('presence guard while closing', () => {
  const fakeDb = (row: { status: string; closed_at: Date | null } | null, closeCmd: boolean) => {
    const updateMany = vi.fn();
    const findUnique = vi.fn(async () => row);
    const db = {
      designSession: { findUnique, updateMany },
      designCommand: { findFirst: vi.fn(async () => (closeCmd ? { id: 'c1' } : null)) },
      designPortalSettings: { findUnique: vi.fn(async () => ({ auto_timer_enabled: true, auto_timer_lapse_minutes: 5, auto_timer_billable: false })) },
      site: { findUnique: vi.fn(async () => ({ design_auto_timer: true })) },
      timeEntry: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    return { db: db as never, updateMany, tx: db.$transaction };
  };

  it('is closing when a close command is pending or claimed, terminal when closed/abandoned/closed_at', async () => {
    expect(await isClosingOrTerminal('s', fakeDb({ status: 'awaiting_input', closed_at: null }, true).db)).toBe(true);
    expect(await isClosingOrTerminal('s', fakeDb({ status: 'closed', closed_at: null }, false).db)).toBe(true);
    expect(await isClosingOrTerminal('s', fakeDb({ status: 'abandoned', closed_at: null }, false).db)).toBe(true);
    expect(await isClosingOrTerminal('s', fakeDb({ status: 'active', closed_at: new Date() }, false).db)).toBe(true);
    expect(await isClosingOrTerminal('s', fakeDb({ status: 'active', closed_at: null }, false).db)).toBe(false);
  });

  it('keepAlive and ensureTimer do nothing while a close command is pending', async () => {
    const k = fakeDb({ status: 'awaiting_input', closed_at: null }, true);
    await keepAlive({ id: 's' }, new Date(), k.db);
    expect(k.updateMany).not.toHaveBeenCalled();
    const e = fakeDb({ status: 'awaiting_input', closed_at: null }, true);
    await ensureTimer({ id: 's', designer_id: 'd', task_id: 't', site_id: 'x' }, { userId: 'd', role: 'designer' }, new Date(), e.db);
    expect(e.tx).not.toHaveBeenCalled();
  });
});

describe('autoTimerBillable (Mike 2026-10-29): billable only for ad-hoc work of a client with no retainer', () => {
  const db = (task: { project_id: string | null; client_id: string | null; project?: { client_id: string } | null } | null, retainer: number | null) =>
    ({
      task: { findUnique: vi.fn(async () => task) },
      client: { findUnique: vi.fn(async () => ({ retainer_hours: retainer })) },
    }) as never;

  it('project task, no retainer: non-billable', async () => {
    expect(await autoTimerBillable('t', db({ project_id: 'p', client_id: 'c', project: { client_id: 'c' } }, null))).toBe(false);
  });
  it('project task, retainer client: non-billable', async () => {
    expect(await autoTimerBillable('t', db({ project_id: 'p', client_id: 'c', project: { client_id: 'c' } }, 10))).toBe(false);
  });
  it('ad-hoc task, retainer client: non-billable', async () => {
    expect(await autoTimerBillable('t', db({ project_id: null, client_id: 'c', project: null }, 10))).toBe(false);
  });
  it('ad-hoc task, client without retainer (null or 0): billable', async () => {
    expect(await autoTimerBillable('t', db({ project_id: null, client_id: 'c', project: null }, null))).toBe(true);
    expect(await autoTimerBillable('t', db({ project_id: null, client_id: 'c', project: null }, 0))).toBe(true);
  });
  it('a missing task is non-billable', async () => {
    expect(await autoTimerBillable('t', db(null, null))).toBe(false);
  });
});
