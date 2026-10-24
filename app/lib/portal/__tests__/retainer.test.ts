import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charter: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    task: { findFirst: vi.fn(), findMany: vi.fn() },
    clientReport: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { allowanceText, buildYearMonths, loadRetainers, periodOf, retainerHeading, safeHttpUrl } from '../retainer';
import { approvedGoingLiveWhere } from '../requests';
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
  it('states what the plan covers', () => {
    expect(allowanceText(10, 'monthly')).toBe('Your plan covers up to 10 hours of work a month.');
    expect(allowanceText('2.50', 'annually')).toBe('Your plan covers up to 2.5 hours of work a year.');
    expect(allowanceText(1, 'monthly')).toBe('Your plan covers up to 1 hour of work a month.');
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
    p.clientReport.findMany.mockResolvedValue([]);
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
      allowance: 'Your plan covers up to 10 hours of work a month.',
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

  it('the open query keeps approved-not-live work (the shared rule), and still drops done and abandoned', async () => {
    await loadRetainers(owner, { now: NOW });
    const where = p.task.findMany.mock.calls[0][0].where;
    expect(where.AND[1]).toEqual({
      OR: [{ client_approved_at: null, status: { notIn: ['abandoned', 'done'] } }, approvedGoingLiveWhere()],
    });
    // The done query is unchanged: finished work only, in the period.
    expect(JSON.stringify(p.task.findMany.mock.calls[1][0].where)).toContain('"status":"done"');
  });

  it('lists an approved-not-live item as open, "Approved. Going live soon.", moving', async () => {
    const approved = item('t1', { status: 'review', client_approved_at: new Date('2026-10-20T15:00:00Z'), tags: ['client-approved'] });
    p.task.findMany.mockResolvedValueOnce([approved, item('t2')]).mockResolvedValueOnce([]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.this_month.open.map((i) => i.id)).toEqual(['t1', 't2']);
    expect(card.this_month.open[0].state).toEqual({ label: 'Approved. Going live soon.', tone: 'moving' });
    expect(card.this_month.done).toEqual([]);
  });

  it('an item approved by tag alone is still listed with the same label', async () => {
    p.task.findMany.mockResolvedValueOnce([item('t1', { status: 'review', tags: ['client-approved'], client_approved_at: null })]).mockResolvedValueOnce([]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.this_month.open[0].state).toEqual({ label: 'Approved. Going live soon.', tone: 'moving' });
  });

  it('an approved item that went live is under done, not open', async () => {
    const live = item('t3', { status: 'done', client_approved_at: new Date('2026-10-20T15:00:00Z'), completed_at: NOW });
    p.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([live]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.this_month.open).toEqual([]);
    expect(card.this_month.done.map((i) => i.id)).toEqual(['t3']);
    expect(card.this_month.done[0].state.tone).toBe('done');
  });

  it('an approved plan is not "plan ready" (query keeps client_approved_at null) and is listed once as an open item', async () => {
    // The plan query finds nothing because the plan is approved; the open query returns it.
    p.task.findFirst.mockResolvedValue(null);
    const plan = item('plan1', { status: 'review', tags: ['marketing-plan', 'client-approved'], client_approved_at: new Date('2026-10-20T15:00:00Z'), staging_preview_url: 'https://preview.example.com/plan' });
    p.task.findMany.mockResolvedValueOnce([plan]).mockResolvedValueOnce([]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.plan_ready).toBeNull();
    expect(card.this_month.open.map((i) => i.id)).toEqual(['plan1']);
    expect(card.this_month.open[0].state.label).toBe('Approved. Going live soon.');
    expect(JSON.stringify(p.task.findFirst.mock.calls[0][0].where)).toContain('"client_approved_at":null');
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

describe('buildYearMonths: the plan year ribbon', () => {
  const NOW = new Date('2026-10-21T15:00:00Z');
  const states = (r: { months: { state: string }[] }) => r.months.map((m) => m.state);

  it('runs twelve months from the start month, labelled', () => {
    const r = buildYearMonths('2026-04-01', NOW, [], false);
    expect(r.months).toHaveLength(12);
    expect(r.months[0].label).toBe('Apr');
    expect(r.months[11].label).toBe('Mar');
    expect(r.label).toBe('April 2026 to March 2027');
  });
  it('marks delivered, current, ready, upcoming and plain past (never missed)', () => {
    const r = buildYearMonths('2026-04-01', NOW, ['2026-04', '2026-05', '2026-07', '2026-09'], true);
    expect(states(r)).toEqual([
      'delivered', 'delivered', 'past', 'delivered', 'past', 'delivered', 'current', 'ready', 'upcoming', 'upcoming', 'upcoming', 'upcoming',
    ]);
    expect(states(r)).not.toContain('missed');
  });
  it('next month is upcoming when no plan is staged', () => {
    expect(states(buildYearMonths('2026-04-01', NOW, [], false))[7]).toBe('upcoming');
  });
  it('picks the contract year that holds now when the start was years ago', () => {
    const r = buildYearMonths('2024-11-01', NOW, [], false);
    expect(r.label).toBe('November 2025 to October 2026');
    expect(r.months[11]).toEqual({ label: 'Oct', state: 'current' });
  });
  it('no usable start date gives no months', () => {
    expect(buildYearMonths(null, NOW, [], false)).toEqual({ label: null, months: [] });
    expect(buildYearMonths('nope', NOW, [], false).months).toEqual([]);
  });
});

describe('loadRetainers: months on the payload', () => {
  const NOW = new Date('2026-10-21T15:00:00Z');
  beforeEach(() => {
    vi.clearAllMocks();
    p.site.findMany.mockResolvedValue([{ id: 's1', name: 'example.com' }]);
    p.task.findFirst.mockResolvedValue(null);
    p.task.findMany.mockResolvedValue([]);
    p.clientReport.findFirst.mockResolvedValue(null);
    p.clientReport.findMany.mockResolvedValue([{ period: '2026-08' }, { period: '2026-09' }]);
  });
  const base = { id: 'ch1', status: 'active', billing_period: 'monthly', budget_hours: 10, start_date: new Date('2026-04-01'), site_id: null, client_label: null, site: null, charter_wares: [] };

  it('delivered, current and upcoming come from report periods and the clock', async () => {
    p.charter.findMany.mockResolvedValue([base]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.year_label).toBe('April 2026 to March 2027');
    const by = Object.fromEntries(card.months.map((m) => [m.label, m.state]));
    expect(by).toMatchObject({ Apr: 'past', Aug: 'delivered', Sep: 'delivered', Oct: 'current', Nov: 'upcoming', Mar: 'upcoming' });
  });
  it('a staged plan makes next month ready', async () => {
    p.charter.findMany.mockResolvedValue([base]);
    p.task.findFirst.mockResolvedValue({ id: 't1', title: 'Plan', client_title: null, staging_preview_url: 'https://preview.example.com/p' });
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.months.find((m) => m.label === 'Nov')?.state).toBe('ready');
  });
  it('a paused charter still gets its ribbon', async () => {
    p.charter.findMany.mockResolvedValue([{ ...base, status: 'paused' }]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.status.label).toBe('Paused');
    expect(card.months).toHaveLength(12);
  });
});
