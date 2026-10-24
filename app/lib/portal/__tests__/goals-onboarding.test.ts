import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charter: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    task: { findFirst: vi.fn(), findMany: vi.fn() },
    clientReport: { findFirst: vi.fn(), findMany: vi.fn() },
    siteKpi: { findMany: vi.fn() },
    checklistItem: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { loadRetainers } from '../retainer';
import { loadCharterGoals, loadSiteGoals } from '../goals';
import { loadStillNeeded } from '../onboarding';
import { PORTAL_KPI_VIEWS, PORTAL_ONBOARD_CHECKLIST } from '@/lib/config/feature-flags';
import type { PortalAccess } from '../access';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const owner: PortalAccess = { contactId: 'c1', clientId: 'cl1', role: 'owner' };
const NOW = new Date('2026-10-21T15:00:00Z');

// A row as Prisma returns it: more columns than a client may ever see.
const kpiRow = (over: Record<string, unknown> = {}) => ({
  site_id: 's1', charter_id: null, metric: 'sessions', label: 'More visits to the site', direction: 'up',
  target_value: '1500.00', target_by: new Date('2027-03-31T00:00:00Z'), last_value: '1200.00',
  id: 'secret-id', source: 'ga4', status: 'confirmed', baseline_value: '900.00', baseline_at: new Date(), last_checked_at: new Date(), ...over,
});

afterEach(() => {
  delete process.env.PORTAL_KPI_VIEWS;
  delete process.env.PORTAL_ONBOARD_CHECKLIST;
});

describe('the two switches', () => {
  it('are OFF by default and ON only for the literal string true', () => {
    expect(PORTAL_KPI_VIEWS()).toBe(false);
    expect(PORTAL_ONBOARD_CHECKLIST()).toBe(false);
    for (const v of ['1', 'TRUE', 'yes', 'on', ' true', 'false', '']) {
      process.env.PORTAL_KPI_VIEWS = v;
      process.env.PORTAL_ONBOARD_CHECKLIST = v;
      expect(PORTAL_KPI_VIEWS()).toBe(false);
      expect(PORTAL_ONBOARD_CHECKLIST()).toBe(false);
    }
    process.env.PORTAL_KPI_VIEWS = 'true';
    process.env.PORTAL_ONBOARD_CHECKLIST = 'true';
    expect(PORTAL_KPI_VIEWS()).toBe(true);
    expect(PORTAL_ONBOARD_CHECKLIST()).toBe(true);
  });
});

describe('Retainer card goals', () => {
  const charter = (over: Record<string, unknown> = {}) => ({
    id: 'ch1', status: 'active', billing_period: 'monthly', budget_hours: 10, start_date: new Date('2026-01-15'), site_id: null, client_label: null,
    site: null, charter_wares: [{ ware: { name: 'SEO' } }], ...over,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    p.charter.findMany.mockResolvedValue([charter()]);
    p.site.findMany.mockResolvedValue([{ id: 's1', name: 'example.com' }, { id: 's2', name: 'other.org' }]);
    p.task.findFirst.mockResolvedValue(null);
    p.task.findMany.mockResolvedValue([]);
    p.clientReport.findFirst.mockResolvedValue(null);
    p.clientReport.findMany.mockResolvedValue([]);
    p.siteKpi.findMany.mockResolvedValue([kpiRow(), kpiRow({ site_id: 's9', label: 'A site this plan does not cover' })]);
  });

  it('switch OFF: the goals key is ABSENT (not null) and no KPI is read', async () => {
    const [card] = await loadRetainers(owner, { now: NOW });
    expect('goals' in card).toBe(false);
    expect(JSON.stringify(card)).not.toContain('goals');
    expect(p.siteKpi.findMany).not.toHaveBeenCalled();
  });

  it('switch ON: goals are the allow-list for the covered sites only', async () => {
    process.env.PORTAL_KPI_VIEWS = 'true';
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.goals).toEqual([
      { label: 'More visits to the site', target_text: 'Reach 1,500 by Mar 31, 2027', direction: 'up', last_text: 'Now 1,200' },
    ]);
    const json = JSON.stringify(card.goals);
    expect(json).not.toMatch(/secret-id|ga4|source|status|baseline|checked/);
    expect(p.siteKpi.findMany.mock.calls[0][0].where).toEqual({ client_id: 'cl1', status: 'confirmed' });
  });

  it('switch ON, no confirmed KPI: an empty list, so the page draws nothing', async () => {
    process.env.PORTAL_KPI_VIEWS = 'true';
    p.siteKpi.findMany.mockResolvedValue([]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.goals).toEqual([]);
  });

  it('a plan scoped to one site shows only that site\'s goals; a charter-linked goal shows with no site', async () => {
    process.env.PORTAL_KPI_VIEWS = 'true';
    p.charter.findMany.mockResolvedValue([charter({ site_id: 's2', site: { id: 's2', name: 'other.org' } })]);
    p.siteKpi.findMany.mockResolvedValue([kpiRow({ site_id: 's1' }), kpiRow({ site_id: 's2', label: 'Other site goal' }), kpiRow({ site_id: null, charter_id: 'ch1', label: 'Plan wide goal' })]);
    const [card] = await loadRetainers(owner, { now: NOW });
    expect(card.goals?.map((g) => g.label)).toEqual(['Other site goal', 'Plan wide goal']);
  });

  it('a contact with no client role gets no KPI read at all', async () => {
    process.env.PORTAL_KPI_VIEWS = 'true';
    expect((await loadCharterGoals({ ...owner, role: 'none' }, [{ id: 'ch1', covered_site_ids: ['s1'] }])).get('ch1')).toEqual([]);
    expect((await loadCharterGoals({ ...owner, revoked: true }, [{ id: 'ch1', covered_site_ids: ['s1'] }])).get('ch1') ?? []).toEqual([]);
    expect(p.siteKpi.findMany).not.toHaveBeenCalled();
  });
});

describe('Home site goals', () => {
  beforeEach(() => vi.clearAllMocks());
  it('groups confirmed goals by site, scoped to the active client', async () => {
    p.siteKpi.findMany.mockResolvedValue([kpiRow(), kpiRow({ site_id: 's2', label: 'More enquiries', metric: 'leads', target_value: null, target_by: null, last_value: null })]);
    const out = await loadSiteGoals(owner, ['s1', 's2', 's3']);
    expect(out.get('s1')).toHaveLength(1);
    expect(out.get('s2')).toEqual([{ label: 'More enquiries', target_text: 'Keep it growing', direction: 'up', last_text: null }]);
    expect(out.has('s3')).toBe(false);
    expect(p.siteKpi.findMany.mock.calls[0][0].where).toEqual({ client_id: 'cl1', status: 'confirmed' });
  });
  it('reads nothing for no sites or a viewer without a client role', async () => {
    expect((await loadSiteGoals(owner, [])).size).toBe(0);
    expect((await loadSiteGoals({ ...owner, role: 'none' }, ['s1'])).size).toBe(0);
    expect(p.siteKpi.findMany).not.toHaveBeenCalled();
  });
});

describe('Home "what we still need"', () => {
  beforeEach(() => vi.clearAllMocks());
  it('lists open required missing onboarding items by client label, in template order, and drops unknown keys', async () => {
    p.checklistItem.findMany.mockResolvedValue([
      { key: 'access.ga4' }, { key: 'assets.logo' }, { key: 'custom.internal_thing' }, { key: 'billing.first_payment' }, { key: 'assets.logo' },
    ]);
    const out = await loadStillNeeded(owner);
    expect(out).toEqual([{ label: 'Your logo file' }, { label: 'Your first payment' }, { label: 'Access to your Google Analytics' }]);
    expect(p.checklistItem.findMany.mock.calls[0][0].where).toEqual({
      required: true,
      state: 'missing',
      checklist: { kind: 'onboarding', client_id: 'cl1', done_at: null },
    });
  });
  it('only owners and members see it; a viewer, no-role and revoked contact do not, and nothing is read', async () => {
    for (const a of [{ ...owner, role: 'viewer' as const }, { ...owner, role: 'none' as const }, { ...owner, revoked: true }]) {
      expect(await loadStillNeeded(a)).toEqual([]);
    }
    expect(p.checklistItem.findMany).not.toHaveBeenCalled();
    p.checklistItem.findMany.mockResolvedValue([]);
    expect(await loadStillNeeded({ ...owner, role: 'member' })).toEqual([]);
    expect(p.checklistItem.findMany).toHaveBeenCalledTimes(1);
  });
  it('exposes only the label, never a key, state or evidence', async () => {
    p.checklistItem.findMany.mockResolvedValue([{ key: 'assets.logo', evidence: 'secret', state: 'missing' }]);
    const out = await loadStillNeeded(owner);
    expect(Object.keys(out[0])).toEqual(['label']);
  });
});
