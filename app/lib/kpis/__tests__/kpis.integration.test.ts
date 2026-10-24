import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { confirmKpiProposal, KpiConfirmError } from '../confirm';
import { createChecklistFromTemplate, setItemState, ChecklistError } from '@/lib/checklists/service';
import { loadSiteGoals, loadCharterGoals } from '@/lib/portal/goals';
import { loadStillNeeded } from '@/lib/portal/onboarding';

// KPI confirm and checklist paths against a real Postgres (the migration's tables). Skips unless
// DATABASE_URL names a scratch database, because it writes rows.
const SCRATCH = /scratch/i.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('KPIs and checklists (real database)', () => {
  const tag = `kpi-${Date.now()}`;
  let userId = '';
  let clientId = '';
  let otherClientId = '';
  let siteId = '';
  let accordId = '';
  let noClientAccordId = '';

  const proposal = [
    { metric: 'sessions', label: 'More visits to the site', direction: 'up', baseline_value: 1000, target_value: 1500, target_by: '2027-03-31', source: 'ga4' },
    { metric: 'leads', label: 'More enquiries', direction: 'up', source: 'manual' },
  ];

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `${tag}@example.test`, password_hash: 'x', name: 'KPI Test', role: 'admin' } })).id;
    clientId = (await prisma.client.create({ data: { name: `KPI client ${tag}`, type: 'direct', status: 'active' } })).id;
    otherClientId = (await prisma.client.create({ data: { name: `KPI other ${tag}`, type: 'direct', status: 'active' } })).id;
    siteId = (await prisma.site.create({ data: { name: `${tag}.example`, client_id: clientId, url: `https://${tag}.example` } })).id;
    accordId = (await prisma.accord.create({ data: { name: `KPI accord ${tag}`, owner_id: userId, client_id: clientId, kpi_proposal: proposal } })).id;
    noClientAccordId = (await prisma.accord.create({ data: { name: `KPI lead ${tag}`, owner_id: userId, kpi_proposal: proposal } })).id;
  });

  afterAll(async () => {
    await prisma.siteKpi.deleteMany({ where: { client_id: { in: [clientId, otherClientId] } } });
    await prisma.checklist.deleteMany({ where: { client_id: { in: [clientId, otherClientId] } } });
    await prisma.accord.deleteMany({ where: { id: { in: [accordId, noClientAccordId] } } });
    await prisma.site.deleteMany({ where: { id: siteId } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId, otherClientId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('confirm creates confirmed rows, and a second run changes nothing', async () => {
    const first = await confirmKpiProposal(prisma, accordId);
    expect(first).toMatchObject({ created: 2, confirmed: 0, unchanged: 0 });
    const rows = await prisma.siteKpi.findMany({ where: { accord_id: accordId }, orderBy: { metric: 'asc' } });
    expect(rows.map((r) => [r.metric, r.status])).toEqual([['leads', 'confirmed'], ['sessions', 'confirmed']]);
    expect(rows.every((r) => r.confirmed_at !== null && r.client_id === clientId)).toBe(true);
    expect(Number(rows[1].target_value)).toBe(1500);
    expect(rows[1].target_by?.toISOString().slice(0, 10)).toBe('2027-03-31');

    const second = await confirmKpiProposal(prisma, accordId);
    expect(second).toMatchObject({ created: 0, confirmed: 0, unchanged: 2 });
    expect(await prisma.siteKpi.count({ where: { accord_id: accordId } })).toBe(2);
  });

  it('two confirms at once still make one set of rows', async () => {
    const acc = await prisma.accord.create({ data: { name: `KPI race ${tag}`, owner_id: userId, client_id: clientId, kpi_proposal: [proposal[1]] } });
    await Promise.all([confirmKpiProposal(prisma, acc.id), confirmKpiProposal(prisma, acc.id), confirmKpiProposal(prisma, acc.id)]);
    expect(await prisma.siteKpi.count({ where: { accord_id: acc.id } })).toBe(1);
    await prisma.siteKpi.deleteMany({ where: { accord_id: acc.id } });
    await prisma.accord.delete({ where: { id: acc.id } });
  });

  it('a retired KPI stays retired on a later confirm', async () => {
    await prisma.siteKpi.updateMany({ where: { accord_id: accordId, metric: 'leads' }, data: { status: 'retired' } });
    const r = await confirmKpiProposal(prisma, accordId);
    expect(r.created).toBe(0);
    expect((await prisma.siteKpi.findFirstOrThrow({ where: { accord_id: accordId, metric: 'leads' } })).status).toBe('retired');
  });

  it('refuses an accord with no client, no proposal, or an unknown id', async () => {
    await expect(confirmKpiProposal(prisma, noClientAccordId)).rejects.toMatchObject({ code: 'no_client' });
    const bare = await prisma.accord.create({ data: { name: `KPI bare ${tag}`, owner_id: userId, client_id: clientId } });
    await expect(confirmKpiProposal(prisma, bare.id)).rejects.toBeInstanceOf(KpiConfirmError);
    await prisma.accord.delete({ where: { id: bare.id } });
    await expect(confirmKpiProposal(prisma, '99999999-9999-4999-8999-999999999999')).rejects.toMatchObject({ code: 'accord_not_found' });
  });

  it('the portal sees only confirmed goals of its own client', async () => {
    await prisma.siteKpi.create({ data: { client_id: clientId, site_id: siteId, metric: 'uptime', label: 'Stay online', direction: 'up', target_value: 99.9, source: 'kuma', status: 'confirmed', confirmed_at: new Date(), last_value: 99.5 } });
    await prisma.siteKpi.create({ data: { client_id: clientId, site_id: siteId, metric: 'proposed_only', label: 'Not agreed yet', direction: 'up', source: 'manual' } });
    await prisma.siteKpi.create({ data: { client_id: otherClientId, metric: 'leads', label: 'Someone else', direction: 'up', source: 'manual', status: 'confirmed', confirmed_at: new Date() } });
    const access = { contactId: 'c', clientId, role: 'member' as const };
    const goals = await loadSiteGoals(access, [siteId]);
    expect(goals.get(siteId)).toEqual([{ label: 'Stay online', target_text: 'Reach 99.9%', direction: 'up', last_text: 'Now 99.5%' }]);
    const byCharter = await loadCharterGoals(access, [{ id: 'none', covered_site_ids: [siteId] }]);
    expect(byCharter.get('none')?.map((g) => g.label)).toEqual(['Stay online']);
    const other = await loadSiteGoals({ ...access, clientId: otherClientId }, [siteId]);
    expect(other.size).toBe(0);
  });

  it('creates a checklist from the template, is idempotent, and finishes on the six before-work items', async () => {
    const a = await createChecklistFromTemplate(prisma, { kind: 'onboarding', client_id: clientId, template: 'onboarding.build', accord_id: accordId });
    expect(a.created).toBe(true);
    expect(a.checklist.items.length).toBeGreaterThan(15);
    const again = await createChecklistFromTemplate(prisma, { kind: 'onboarding', client_id: clientId, template: 'onboarding.build', accord_id: accordId });
    expect(again.created).toBe(false);
    expect(again.checklist.id).toBe(a.checklist.id);

    const access = { contactId: 'c', clientId, role: 'owner' as const };
    expect((await loadStillNeeded(access)).map((n) => n.label)).toContain('Your logo file');
    expect(await loadStillNeeded({ ...access, clientId: otherClientId })).toEqual([]);

    await expect(setItemState(prisma, a.checklist.id, 'assets.logo', { state: 'verified', verified_by_id: userId })).rejects.toMatchObject({ code: 'evidence_required' });
    await expect(setItemState(prisma, a.checklist.id, 'nope.key', { state: 'received', verified_by_id: userId })).rejects.toBeInstanceOf(ChecklistError);

    const SIX = ['people.approver', 'people.billing_contact', 'assets.logo', 'billing.msa', 'billing.first_payment', 'meeting.kickoff'];
    let last = a.checklist;
    for (const key of SIX) {
      expect(last.done_at).toBeNull();
      last = await setItemState(prisma, a.checklist.id, key, { state: 'verified', evidence: `proof for ${key}`, verified_by_id: userId });
    }
    expect(last.done_at).not.toBeNull();
    const logo = last.items.find((i) => i.key === 'assets.logo')!;
    expect(logo).toMatchObject({ state: 'verified', verified_by_id: userId, evidence: 'proof for assets.logo' });
    expect(logo.verified_at).not.toBeNull();
    // GA4 is still missing and does not hold the checklist open.
    expect(last.items.find((i) => i.key === 'access.ga4')?.state).toBe('missing');
    // Done checklist no longer feeds "what we still need".
    expect(await loadStillNeeded(access)).toEqual([]);
    // Moving an item back to missing reopens it.
    const reopened = await setItemState(prisma, a.checklist.id, 'billing.msa', { state: 'missing', verified_by_id: userId });
    expect(reopened.done_at).toBeNull();
    expect(reopened.items.find((i) => i.key === 'billing.msa')).toMatchObject({ verified_by_id: null, verified_at: null, evidence: null });
  });

  it('deleting a checklist cascades to its items (the one cascade in the migration)', async () => {
    const c = await prisma.checklist.create({ data: { kind: 'offboarding', client_id: clientId, items: { create: [{ key: 'revoke.drive', label: 'Drive shares removed', group: 'revoke' }] } } });
    await prisma.checklist.delete({ where: { id: c.id } });
    expect(await prisma.checklistItem.count({ where: { checklist_id: c.id } })).toBe(0);
  });

  it('a client with checklists or KPIs cannot be hard-deleted (no cascade from the client)', async () => {
    await expect(prisma.client.delete({ where: { id: clientId } })).rejects.toBeTruthy();
  });
});
