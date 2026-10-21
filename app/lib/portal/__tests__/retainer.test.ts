import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charter: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    task: { findFirst: vi.fn(), findMany: vi.fn() },
    clientReport: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { allowanceText, loadRetainers, periodOf, retainerHeading, safeHttpUrl } from '../retainer';
import type { PortalAccess } from '../access';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const owner: PortalAccess = { contactId: 'c1', clientId: 'cl1', role: 'owner' };

describe('periodOf', () => {
  it('monthly is the calendar month in Eastern time', () => {
    const r = periodOf({ billing_period: 'monthly', start_date: '2026-01-15' }, new Date('2026-10-21T15:00:00Z'));
    expect(r.label).toBe('October 2026');
    expect(r.start.toISOString()).toBe('2026-10-01T04:00:00.000Z'); // midnight EDT
    expect(r.end.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
  it('rolls over the year and respects the winter offset', () => {
    const r = periodOf({ billing_period: 'monthly', start_date: '2026-01-15' }, new Date('2026-12-31T23:00:00Z'));
    expect(r.label).toBe('December 2026');
    expect(r.end.toISOString()).toBe('2027-01-01T05:00:00.000Z'); // midnight EST
  });
  it('late on the last evening of a month still belongs to that month in Eastern time', () => {
    expect(periodOf({ billing_period: 'monthly', start_date: '2026-01-15' }, new Date('2026-11-01T02:00:00Z')).label).toBe('October 2026');
  });
  it('annual is the contract year that holds now', () => {
    expect(periodOf({ billing_period: 'annually', start_date: '2025-10-01' }, new Date('2026-10-21T15:00:00Z')).label).toBe('Oct 2026 to Sep 2027');
    expect(periodOf({ billing_period: 'annually', start_date: '2025-10-01' }, new Date('2026-03-10T15:00:00Z')).label).toBe('Oct 2025 to Sep 2026');
    expect(periodOf({ billing_period: 'annually', start_date: '2026-01-01' }, new Date('2026-06-10T15:00:00Z')).label).toBe('Jan 2026 to Dec 2026');
  });
});

describe('allowanceText: the plan allowance, never hours used', () => {
  it('states what the plan includes', () => {
    expect(allowanceText(10, 'monthly')).toBe('Your plan includes up to 10 hours of work a month.');
    expect(allowanceText('2.50', 'annually')).toBe('Your plan includes up to 2.5 hours of work a year.');
    expect(allowanceText(1, 'monthly')).toBe('Your plan includes up to 1 hour of work a month.');
  });
  it('says nothing without an allowance', () => {
    expect(allowanceText(null, 'monthly')).toBeNull();
    expect(allowanceText(0, 'monthly')).toBeNull();
    expect(allowanceText(undefined, 'monthly')).toBeNull();
  });
});

describe('retainerHeading', () => {
  it('prefers client_label, then ware names, then Marketing plan', () => {
    expect(retainerHeading(' Growth plan ', ['SEO'])).toBe('Growth plan');
    expect(retainerHeading(null, ['SEO', 'Social'])).toBe('SEO, Social');
    expect(retainerHeading('  ', [])).toBe('Marketing plan');
  });
});

describe('safeHttpUrl', () => {
  it('passes web links only', () => {
    expect(safeHttpUrl('https://reports.example.com/a')).toBe('https://reports.example.com/a');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe('loadRetainers', () => {
  const NOW = new Date('2026-10-21T15:00:00Z');
  const charter = (over: Record<string, unknown> = {}) => ({
    id: 'ch1', status: 'active', billing_period: 'monthly', budget_hours: 10, start_date: new Date('2026-01-15'), site_id: null, client_label: null,
    site: null, charter_wares: [{ ware: { name: 'SEO' } }], ...over,
  });
  const item = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: `internal ${id}`, client_title: `Client ${id}`, status: 'in_progress', tags: ['internal-tag'], staging_preview_url: null, approved: false,
    client_approved_at: null, updated_at: new Date(), site: null, ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    p.charter.findMany.mockResolvedValue([charter()]);
    p.site.findMany.mockResolvedValue([{ id: 's1', name: 'example.com' }, { id: 's2', name: 'other.org' }]);
    p.task.findFirst.mockResolvedValue(null);
    p.task.findMany.mockResolvedValue([]);
    p.clientReport.findFirst.mockResolvedValue(null);
  });

  it('a grant-only contact and a revoked contact get nothing, and nothing is queried', async () => {
    expect(await loadRetainers({ ...owner, role: 'none' })).toEqual([]);
    expect(await loadRetainers({ ...owner, revoked: true })).toEqual([]);
    expect(p.charter.findMany).not.toHaveBeenCalled();
  });

  it('loads only active and paused, undeleted charters on the client', async () => {
    await loadRetainers(owner, { now: NOW });
    expect(p.charter.findMany.mock.calls[0][0].where).toEqual({ client_id: 'cl1', is_deleted: false, status: { in: ['active', 'paused'] } });
  });

  it('builds the card in client words: heading, period, covers, allowance, chip', async () => {
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card).toMatchObject({
      heading: 'SEO',
      period: 'October 2026',
      covers: ['example.com', 'other.org'],
      allowance: 'Your plan includes up to 10 hours of work a month.',
      status: { label: 'Active' },
      plan_ready: null,
      latest_report: null,
    });
  });

  it('never exposes the internal charter name, tags or hours used', async () => {
    p.task.findMany.mockResolvedValueOnce([item('t1')]).mockResolvedValueOnce([]);
    p.charter.findMany.mockResolvedValue([{ ...charter(), name: 'INTERNAL CHARTER NAME', hours_used: 7 }]);
    const cards = await loadRetainers(owner, { now: NOW });
    const text = JSON.stringify(cards);
    expect(text).not.toContain('INTERNAL CHARTER NAME');
    expect(text).not.toContain('internal-tag');
    expect(text).not.toContain('hours_used');
    // The queries never ask for time entries or usage either.
    const selects = JSON.stringify([p.charter.findMany.mock.calls, p.task.findMany.mock.calls, p.task.findFirst.mock.calls]);
    expect(selects).not.toMatch(/time_entr|hours_used|time_spent|estimated_minutes|actual_minutes/);
    expect(selects).not.toContain('"name":true,"client_label"'); // Charter.name is not selected
    expect(Object.keys(p.charter.findMany.mock.calls[0][0].select)).not.toContain('name');
  });

  it('a paused charter shows as Paused', async () => {
    p.charter.findMany.mockResolvedValue([charter({ status: 'paused' })]);
    expect((await loadRetainers(owner, { now: NOW }))[0].status).toEqual({ label: 'Paused', tone: 'quiet' });
  });

  it('a charter on one site covers just that site; a plan with a client_label uses it', async () => {
    p.charter.findMany.mockResolvedValue([charter({ site_id: 's1', site: { id: 's1', name: 'example.com' }, client_label: 'Growth plan' })]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.covers).toEqual(['example.com']);
    expect(card.heading).toBe('Growth plan');
  });

  it('scopes tasks to the charter, the A1 visibility rule and the contact access', async () => {
    await loadRetainers(owner, { now: NOW });
    const text = JSON.stringify(p.task.findMany.mock.calls[0][0].where);
    expect(text).toContain('"charter_id":"ch1"');
    expect(text).toContain('requested_by_contact_id');
    expect(text).toContain('"client_visible":true');
    expect(text).toContain('"client_id":"cl1"');
  });

  it('splits this month into open and finished work, in client words', async () => {
    p.task.findMany.mockResolvedValueOnce([item('t1'), item('t2', { status: 'not_started' })]).mockResolvedValueOnce([item('t3', { status: 'done', completed_at: NOW })]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.this_month.open.map((i) => i.title)).toEqual(['Client t1', 'Client t2']);
    expect(card.this_month.done.map((i) => i.title)).toEqual(['Client t3']);
    expect(card.this_month.open[0].state.label).toBe('In progress');
    const doneWhere = JSON.stringify(p.task.findMany.mock.calls[1][0].where);
    expect(doneWhere).toContain('completed_at');
    expect(doneWhere).toContain('2026-10-01T04:00:00.000Z');
  });

  it('a staged unapproved marketing-plan task is "plan ready" and not repeated in the open list', async () => {
    p.task.findFirst.mockResolvedValue({ id: 'plan1', title: 'Plan', client_title: 'November plan', staging_preview_url: 'https://preview.example.com/plan' });
    p.task.findMany.mockResolvedValueOnce([item('plan1', { status: 'review' }), item('t1')]).mockResolvedValueOnce([]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.plan_ready).toEqual({ task_id: 'plan1', title: 'November plan', preview_url: 'https://preview.example.com/plan', book_href: '/portal/book?type=marketing' });
    expect(card.this_month.open.map((i) => i.id)).toEqual(['t1']);
    const where = JSON.stringify(p.task.findFirst.mock.calls[0][0].where);
    expect(where).toContain('marketing-plan');
    expect(where).toContain('"client_approved_at":null');
    expect(where).toContain('staging_preview_url');
  });

  it('shows the newest published report for the charter or a covered site; unsafe links are dropped', async () => {
    p.clientReport.findFirst.mockResolvedValue({ title: 'October report', headline: 'Calls are up.', period: '2026-10', url: 'https://reports.example.com/oct' });
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.latest_report).toEqual({ title: 'October report', headline: 'Calls are up.', period: '2026-10', url: 'https://reports.example.com/oct' });
    const arg = p.clientReport.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ client_id: 'cl1', published_at: { not: null, lte: NOW } });
    expect(arg.where.OR).toEqual([{ charter_id: 'ch1' }, { site_id: { in: ['s1', 's2'] } }]);
    expect(arg.orderBy).toEqual({ published_at: 'desc' });

    p.clientReport.findFirst.mockResolvedValue({ title: 'x', headline: null, period: '2026-10', url: 'javascript:alert(1)' });
    expect((await loadRetainers(owner, { now: NOW }))[0].latest_report).toBeNull();
  });
});
