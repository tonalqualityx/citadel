import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    initiative: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    initiativeNumber: { update: vi.fn() },
    initiativeReading: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    project: { count: vi.fn() },
    accord: { findMany: vi.fn() },
    charter: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { runCitadelNumbers, countProjectsSigned, countProposalsSent, sumRetainerHoursSold, countChartersActive } from '../citadel-numbers';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const NOW = new Date('2026-11-25T01:15:00Z');
const BASE = new Date('2026-11-01T00:00:00Z');

const num = (o: Record<string, unknown> = {}) => ({
  id: 'n1', initiative_id: 'i1', label: 'Signed', unit: 'count', direction: 'up',
  baseline_value: '0.00', baseline_at: BASE, target_value: '5.00', target_by: new Date('2027-03-31'),
  source: 'citadel:projects_signed', last_value: null, last_read_at: null, position: 0, ...o,
});

const initRow = (id: string, numbers: unknown[] = []) => ({
  id, name: id, check_date: new Date('2099-01-01'), health: 'unchecked', health_reason: null, numbers, check_ins: [],
});

function setup(initiatives: { id: string; numbers: unknown[] }[]) {
  p.initiative.findMany.mockResolvedValue(initiatives);
  p.initiative.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const found = initiatives.find((i) => i.id === where.id);
    return found ? initRow(found.id, found.numbers) : null;
  });
  p.initiative.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    ...initRow(where.id), ...data,
  }));
  p.initiativeReading.findFirst.mockResolvedValue(null);
  p.initiativeReading.count.mockResolvedValue(1);
  p.initiativeReading.create.mockResolvedValue({ id: 'r1' });
  p.initiativeNumber.update.mockResolvedValue({});
  p.project.count.mockResolvedValue(0);
  p.accord.findMany.mockResolvedValue([]);
  p.charter.findMany.mockResolvedValue([]);
  p.charter.count.mockResolvedValue(0);
}

beforeEach(() => vi.resetAllMocks());

describe('projects_signed', () => {
  it('counts non-deleted projects of the initiative whose live accord was signed in (baseline_at, now]', async () => {
    p.project.count.mockResolvedValue(2);
    expect(await countProjectsSigned('i1', { after: BASE, upTo: NOW })).toBe(2);
    expect(p.project.count).toHaveBeenCalledWith({
      where: {
        initiative_id: 'i1',
        is_deleted: false,
        accord: { is: { is_deleted: false, signed_at: { gt: BASE, lte: NOW } } },
      },
    });
  });

  it('has an exclusive lower edge, an inclusive upper edge, and needs an accord with signed_at', async () => {
    await countProjectsSigned('i1', { after: BASE, upTo: NOW });
    const where = p.project.count.mock.calls[0][0].where;
    expect(where.accord.is.signed_at).toEqual({ gt: BASE, lte: NOW });
    expect(where.accord).toHaveProperty('is');
  });

  it('reads 0 without querying when the number has no baseline_at', async () => {
    expect(await countProjectsSigned('i1', { after: null, upTo: NOW })).toBe(0);
    expect(p.project.count).not.toHaveBeenCalled();
  });
});

describe('proposals_sent', () => {
  const sent = (...d: (string | null)[]) => ({ id: 'a', proposals: d.map((x) => ({ sent_at: x ? new Date(x) : null })) });

  it('asks for live accords with a live project on the initiative and live sent proposals', async () => {
    p.accord.findMany.mockResolvedValue([]);
    await countProposalsSent('i1', { after: BASE, upTo: NOW });
    expect(p.accord.findMany.mock.calls[0][0].where).toEqual({
      is_deleted: false,
      projects: { some: { initiative_id: 'i1', is_deleted: false } },
    });
    expect(p.accord.findMany.mock.calls[0][0].select.proposals.where).toEqual({ is_deleted: false, sent_at: { not: null } });
  });

  it('counts an accord once even with several versions sent in the window', async () => {
    p.accord.findMany.mockResolvedValue([sent('2026-11-10T00:00:00Z', '2026-11-12T00:00:00Z', '2026-11-20T00:00:00Z')]);
    expect(await countProposalsSent('i1', { after: BASE, upTo: NOW })).toBe(1);
  });

  it('does not count a revision in the window when the first version went out before it', async () => {
    p.accord.findMany.mockResolvedValue([sent('2026-10-20T00:00:00Z', '2026-11-12T00:00:00Z')]);
    expect(await countProposalsSent('i1', { after: BASE, upTo: NOW })).toBe(0);
  });

  it('applies the window edges: lower exclusive, upper inclusive', async () => {
    p.accord.findMany.mockResolvedValue([
      sent(BASE.toISOString()),
      sent(NOW.toISOString()),
      sent(new Date(NOW.getTime() + 1).toISOString()),
      sent(new Date(BASE.getTime() + 1).toISOString()),
    ]);
    expect(await countProposalsSent('i1', { after: BASE, upTo: NOW })).toBe(2);
  });

  it('skips accords with no sent proposals and reads 0 with no baseline_at', async () => {
    p.accord.findMany.mockResolvedValue([sent()]);
    expect(await countProposalsSent('i1', { after: BASE, upTo: NOW })).toBe(0);
    p.accord.findMany.mockClear();
    expect(await countProposalsSent('i1', { after: null, upTo: NOW })).toBe(0);
    expect(p.accord.findMany).not.toHaveBeenCalled();
  });
});

describe('charter keys', () => {
  it('charters_active counts active, non-deleted charters, any initiative', async () => {
    p.charter.count.mockResolvedValue(4);
    expect(await countChartersActive()).toBe(4);
    expect(p.charter.count).toHaveBeenCalledWith({ where: { status: 'active', is_deleted: false } });
  });

  it('retainer_hours_sold turns annual hours monthly, keeps monthly, ignores null, rounds to 2 places', async () => {
    p.charter.findMany.mockResolvedValue([
      { budget_hours: '10.00', billing_period: 'monthly' },
      { budget_hours: '100.00', billing_period: 'annually' },
      { budget_hours: null, billing_period: 'monthly' },
    ]);
    expect(await sumRetainerHoursSold()).toBe(18.33);
    expect(p.charter.findMany.mock.calls[0][0].where).toEqual({ status: 'active', is_deleted: false });
  });

  it('retainer_hours_sold is 0 with no charters', async () => {
    p.charter.findMany.mockResolvedValue([]);
    expect(await sumRetainerHoursSold()).toBe(0);
  });
});

describe('runCitadelNumbers', () => {
  it('records a citadel reading with the computed value and updates the number', async () => {
    setup([{ id: 'i1', numbers: [num()] }]);
    p.project.count.mockResolvedValue(3);
    const out = await runCitadelNumbers(NOW);
    expect(out).toEqual({ read: 1, skipped: [], refreshed: 1 });
    expect(p.initiativeReading.create).toHaveBeenCalledWith({ data: { number_id: 'n1', value: 3, read_at: NOW, source: 'citadel' } });
    expect(p.initiativeNumber.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { last_value: 3, last_read_at: NOW } });
  });

  it('the first read of a number with no baseline reads 0 and becomes the baseline', async () => {
    setup([{ id: 'i1', numbers: [num({ baseline_value: null, baseline_at: null })] }]);
    await runCitadelNumbers(NOW);
    expect(p.project.count).not.toHaveBeenCalled();
    expect(p.initiativeReading.create.mock.calls[0][0].data.value).toBe(0);
    expect(p.initiativeNumber.update.mock.calls[0][0].data).toEqual({
      last_value: 0, last_read_at: NOW, baseline_value: 0, baseline_at: NOW,
    });
  });

  it('skips an unknown key and the old suffix form, listing them, without an error', async () => {
    setup([{
      id: 'i1',
      numbers: [
        num({ id: 'n2', source: 'citadel:wat' }),
        num({ id: 'n3', source: 'citadel:projects_signed:ada' }),
        num({ id: 'n4', source: 'manual' }),
      ],
    }]);
    const out = await runCitadelNumbers(NOW);
    expect(out.read).toBe(0);
    expect(out.skipped).toEqual([
      { number_id: 'n2', source: 'citadel:wat', reason: 'unknown key "wat"' },
      { number_id: 'n3', source: 'citadel:projects_signed:ada', reason: 'unknown key "projects_signed:ada"' },
    ]);
    expect(p.initiativeReading.create).not.toHaveBeenCalled();
  });

  it('skips a number already read by citadel on the same UTC day', async () => {
    setup([{ id: 'i1', numbers: [num()] }]);
    p.initiativeReading.findFirst.mockResolvedValue({ id: 'earlier' });
    const out = await runCitadelNumbers(NOW);
    expect(out.read).toBe(0);
    expect(out.skipped).toEqual([{ number_id: 'n1', source: 'citadel:projects_signed', reason: 'already read today' }]);
    expect(p.initiativeReading.findFirst.mock.calls[0][0].where).toEqual({
      number_id: 'n1', source: 'citadel',
      read_at: { gte: new Date('2026-11-25T00:00:00Z'), lt: new Date('2026-11-26T00:00:00Z') },
    });
    expect(p.initiativeReading.create).not.toHaveBeenCalled();
    expect(p.initiative.update).toHaveBeenCalled(); // health still refreshed
  });

  it('reads all four keys', async () => {
    setup([{
      id: 'i1',
      numbers: [
        num({ id: 'a', source: 'citadel:charters_active', position: 0 }),
        num({ id: 'b', source: 'citadel:retainer_hours_sold', position: 1 }),
        num({ id: 'c', source: 'citadel:proposals_sent', position: 2 }),
      ],
    }]);
    p.charter.count.mockResolvedValue(6);
    p.charter.findMany.mockResolvedValue([{ budget_hours: '24', billing_period: 'annually' }]);
    p.accord.findMany.mockResolvedValue([{ id: 'x', proposals: [{ sent_at: new Date('2026-11-10') }] }]);
    const out = await runCitadelNumbers(NOW);
    expect(out.read).toBe(3);
    const values = p.initiativeReading.create.mock.calls.map((c) => [c[0].data.number_id, c[0].data.value]);
    expect(values).toEqual([['a', 6], ['b', 2], ['c', 1]]);
  });

  it('refreshes health on every non-deleted initiative, including ones with no citadel numbers', async () => {
    setup([
      { id: 'i1', numbers: [num()] },
      { id: 'i2', numbers: [] },
      { id: 'i3', numbers: [num({ id: 'm', source: 'manual' })] },
    ]);
    const out = await runCitadelNumbers(NOW);
    expect(out.refreshed).toBe(3);
    expect(p.initiative.findMany.mock.calls[0][0].where).toEqual({ is_deleted: false });
    const updated = p.initiative.update.mock.calls.map((c) => c[0].where.id);
    expect(updated).toEqual(['i1', 'i2', 'i3']);
  });

  it('lists a number whose read throws as skipped and carries on', async () => {
    setup([{ id: 'i1', numbers: [num({ id: 'bad' }), num({ id: 'good', source: 'citadel:charters_active' })] }]);
    p.project.count.mockRejectedValue(new Error('db down'));
    p.charter.count.mockResolvedValue(1);
    const out = await runCitadelNumbers(NOW);
    expect(out.read).toBe(1);
    expect(out.skipped).toEqual([{ number_id: 'bad', source: 'citadel:projects_signed', reason: 'error: db down' }]);
  });
});
