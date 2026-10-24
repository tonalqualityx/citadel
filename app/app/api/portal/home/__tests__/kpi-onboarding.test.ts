import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
vi.mock('@/lib/portal/retainer', () => ({ loadRetainers: vi.fn(async () => []) }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: { findFirst: vi.fn() },
    client: { findFirst: vi.fn() },
    article: { findMany: vi.fn() },
    task: { findMany: vi.fn(), aggregate: vi.fn() },
    project: { findMany: vi.fn() },
    projectPhase: { findMany: vi.fn() },
    resourceLink: { findMany: vi.fn() },
    milestone: { aggregate: vi.fn() },
    site: { findMany: vi.fn() },
    siteStatsSnapshot: { findFirst: vi.fn() },
    clientInvoice: { findMany: vi.fn() },
    siteKpi: { findMany: vi.fn() },
    checklistItem: { findMany: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const call = () => GET(new NextRequest(new URL('http://localhost/api/portal/home')));

beforeEach(() => {
  vi.clearAllMocks();
  (requireClientAuth as Mock).mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
  p.clientContact.findFirst.mockResolvedValue({ client_id: 'client-acme', portal_role: 'owner', is_deleted: false });
  p.client.findFirst.mockResolvedValue({ id: 'client-acme', name: 'Acme Co', qbo_customer_id: null });
  p.article.findMany.mockResolvedValue([]);
  p.task.findMany.mockResolvedValue([]);
  p.task.aggregate.mockResolvedValue({ _sum: { billing_amount: null }, _count: 0 });
  p.milestone.aggregate.mockResolvedValue({ _sum: { billing_amount: null }, _count: 0 });
  p.project.findMany.mockResolvedValue([]);
  p.projectPhase.findMany.mockResolvedValue([]);
  p.resourceLink.findMany.mockResolvedValue([]);
  p.site.findMany.mockResolvedValue([{ id: 's1', name: 'acme.example' }, { id: 's2', name: 'shop.acme.example' }]);
  p.siteStatsSnapshot.findFirst.mockResolvedValue(null);
  p.siteKpi.findMany.mockResolvedValue([
    {
      id: 'k1', site_id: 's1', charter_id: null, metric: 'leads', label: 'More enquiries', direction: 'up', target_value: '40.00',
      target_by: new Date('2027-01-31T00:00:00Z'), last_value: '12.00', source: 'ga4', status: 'confirmed', baseline_value: '5.00',
    },
  ]);
  p.checklistItem.findMany.mockResolvedValue([{ key: 'assets.logo' }, { key: 'meeting.kickoff' }]);
});

afterEach(() => {
  delete process.env.PORTAL_KPI_VIEWS;
  delete process.env.PORTAL_ONBOARD_CHECKLIST;
});

describe('GET /api/portal/home, switches OFF (default)', () => {
  it('site_goals and onboarding are ABSENT from the JSON, and no KPI or checklist row is read', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect('site_goals' in body).toBe(false);
    expect('onboarding' in body).toBe(false);
    expect(p.siteKpi.findMany).not.toHaveBeenCalled();
    expect(p.checklistItem.findMany).not.toHaveBeenCalled();
    expect(body.summary.needs_count).toBe(0);
  });
});

describe('GET /api/portal/home, switches ON', () => {
  it('KPI switch alone adds site_goals (allow-list) and not onboarding', async () => {
    process.env.PORTAL_KPI_VIEWS = 'true';
    const body = await (await call()).json();
    expect(body.site_goals).toEqual([
      { site: { id: 's1', name: 'acme.example' }, goals: [{ label: 'More enquiries', target_text: 'Reach 40 by Jan 31, 2027', direction: 'up', last_text: 'Now 12' }] },
    ]);
    expect('onboarding' in body).toBe(false);
    expect(JSON.stringify(body.site_goals)).not.toMatch(/ga4|source|status|baseline|"k1"/);
  });

  it('onboarding switch alone adds "what we still need" in client labels only, and counts as one need', async () => {
    process.env.PORTAL_ONBOARD_CHECKLIST = 'true';
    const body = await (await call()).json();
    expect(body.onboarding).toEqual({ still_need: [{ label: 'Your logo file' }, { label: 'A time for our kickoff meeting' }] });
    expect('site_goals' in body).toBe(false);
    expect(body.summary.needs_count).toBe(1);
    expect(JSON.stringify(body.onboarding)).not.toMatch(/assets\.logo|missing|required|checklist/i);
  });

  it('a viewer gets an empty list for onboarding, and the checklist is not read', async () => {
    process.env.PORTAL_ONBOARD_CHECKLIST = 'true';
    p.clientContact.findFirst.mockResolvedValue({ client_id: 'client-acme', portal_role: 'viewer', is_deleted: false });
    const body = await (await call()).json();
    expect(body.onboarding).toEqual({ still_need: [] });
    expect(p.checklistItem.findMany).not.toHaveBeenCalled();
    expect(body.summary.needs_count).toBe(0);
  });

  it('is scoped to the session\'s client, never an id from input', async () => {
    process.env.PORTAL_KPI_VIEWS = 'true';
    process.env.PORTAL_ONBOARD_CHECKLIST = 'true';
    await call();
    expect(p.siteKpi.findMany.mock.calls[0][0].where.client_id).toBe('client-acme');
    expect(p.checklistItem.findMany.mock.calls[0][0].where.checklist.client_id).toBe('client-acme');
  });
});
