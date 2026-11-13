// @vitest-environment node
/** The signed deal read (lib/deals/read.ts) and who may read it (lib/deals/access.ts), against a real scratch Postgres. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { readDeals } from '../read';
import { mayReadDeal } from '../access';
import { GET as getProject } from '@/app/api/projects/[id]/route';
import { GET as getClient } from '@/app/api/clients/[id]/route';
import { GET as getTask } from '@/app/api/tasks/[id]/route';
import { GET as getTriage } from '@/app/api/tasks/[id]/triage/route';
import { loadCards } from '@/lib/tasks/triage-card';
vi.mock('@/lib/api/formatters', async (orig) => ({ ...(await orig<typeof import('@/lib/api/formatters')>()), formatProjectResponse: (p: { id: string }) => ({ id: p.id }) })); // the real one require()s a path alias vitest cannot resolve
import { dox, chatLane, mikeSession, idParams, makeFixture, BOT_ID, type Fx } from '@/lib/dox/__tests__/fixture';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const req = (headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/x', { headers });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });

describe.skipIf(!SCRATCH)('the signed deal (real database)', () => {
  let fx: Fx;
  let accordIds: string[] = [];
  let wareIds: string[] = [];
  let msaId = '';
  let linkedProject = '', commissionProject = '', unlinkedProject = '', bareProject = '';
  let linkedTask = '', unlinkedTask = '';
  let bareClient = '';
  let charterId = '';
  let signedAccord = '', itemAccord = '', laterSigned = '', otherLead = '';

  beforeAll(async () => {
    fx = await makeFixture('deal');
    const ware1 = await prisma.ware.create({ data: { name: `${fx.tag} Website build`, type: 'commission' } });
    const ware2 = await prisma.ware.create({ data: { name: `${fx.tag} Care plan`, type: 'charter', charter_billing_period: 'monthly' } });
    wareIds = [ware1.id, ware2.id];
    msaId = (await prisma.msaVersion.create({ data: { version: `${fx.tag}`.slice(-20), content: 'msa', effective_date: new Date('2026-01-01'), created_by_id: MIKE_USER_ID } })).id;

    signedAccord = (await prisma.accord.create({ data: { name: `${fx.tag} Signed deal`, owner_id: MIKE_USER_ID, client_id: fx.clientId, status: 'signed', signed_at: new Date('2026-09-01T15:00:00Z'), total_value: '14250.5', notes: 'PRIVATE accord note', rejection_reason: 'PRIVATE reason' } })).id;
    laterSigned = (await prisma.accord.create({ data: { name: `${fx.tag} Later deal`, owner_id: MIKE_USER_ID, client_id: fx.clientId, status: 'active', signed_at: new Date('2026-10-15T15:00:00Z') } })).id;
    otherLead = (await prisma.accord.create({ data: { name: `${fx.tag} Open lead`, owner_id: MIKE_USER_ID, client_id: fx.clientId, status: 'lead' } })).id;
    itemAccord = (await prisma.accord.create({ data: { name: `${fx.tag} Item deal`, owner_id: MIKE_USER_ID, client_id: fx.clientId, status: 'proposal' } })).id;
    accordIds = [signedAccord, laterSigned, otherLead, itemAccord];

    await prisma.contract.create({ data: { accord_id: signedAccord, version: 1, content: 'SECRET contract text', msa_version_id: msaId, status: 'sent', pricing_snapshot: { secret: 'snapshot' }, created_by_id: MIKE_USER_ID, sent_at: new Date('2026-08-20T12:00:00Z') } });
    await prisma.contract.create({
      data: { accord_id: signedAccord, version: 2, content: 'SECRET contract text 2', msa_version_id: msaId, status: 'signed', pricing_snapshot: {}, created_by_id: MIKE_USER_ID, signed_at: new Date('2026-09-01T15:00:00Z'), signer_name: 'SIGNER NAME', signer_email: 'signer@secret.test', signer_ip: '203.0.113.9', portal_token: 'PORTAL-TOKEN-SECRET' },
    });
    await prisma.accordCommissionItem.create({ data: { accord_id: signedAccord, ware_id: ware1.id, estimated_price: '12000', final_price: '11250.50', discount_type: 'percent', discount_value: '6.25' } });
    await prisma.accordCharterItem.create({
      data: { accord_id: signedAccord, ware_id: ware2.id, name_override: 'Monthly care', base_price: '250', final_price: '225.00', billing_period: 'monthly', duration_months: 12, total_contract_value: '2700.00' },
    });
    await prisma.accordKeepItem.create({ data: { accord_id: signedAccord, site_name_placeholder: 'New site', domain_name: 'example.test', hosting_final_price: '30', maintenance_final_price: '20', monthly_total: '50' } });

    linkedProject = await fx.mkProject('Linked', { accord_id: signedAccord });
    commissionProject = await fx.mkProject('Via commission item');
    await prisma.accordCommissionItem.create({ data: { accord_id: itemAccord, ware_id: ware1.id, estimated_price: '5000', project_id: commissionProject } });
    unlinkedProject = await fx.mkProject('Unlinked');
    bareClient = (await prisma.client.create({ data: { name: `${fx.tag} Bare Co`, type: 'direct', status: 'active' } })).id;
    bareProject = (await prisma.project.create({ data: { name: `${fx.tag} Bare`, client_id: bareClient, status: 'ready' } })).id;
    fx.projectIds.push(bareProject);

    charterId = (await prisma.charter.create({
      data: { name: `${fx.tag} Retainer`, client_id: fx.clientId, accord_id: signedAccord, status: 'active', billing_period: 'monthly', budget_hours: '10', hourly_rate: '125', start_date: new Date('2026-09-01'), duration_months: 12, created_by_id: MIKE_USER_ID },
    })).id;
    await prisma.client.update({ where: { id: fx.clientId }, data: { retainer_hours: '5', hourly_rate: '110' } });

    linkedTask = await fx.mkTask('Linked task', { project_id: linkedProject, client_id: fx.clientId, status: 'not_started' });
    unlinkedTask = await fx.mkTask('Unlinked task', { project_id: unlinkedProject, client_id: fx.clientId, status: 'not_started' });
  });

  afterAll(async () => {
    await prisma.charter.deleteMany({ where: { id: charterId } });
    await prisma.accordCommissionItem.deleteMany({ where: { accord_id: { in: accordIds } } });
    await prisma.accordCharterItem.deleteMany({ where: { accord_id: { in: accordIds } } });
    await prisma.accordKeepItem.deleteMany({ where: { accord_id: { in: accordIds } } });
    await prisma.contract.deleteMany({ where: { accord_id: { in: accordIds } } });
    await fx.cleanup();
    await prisma.project.deleteMany({ where: { id: bareProject } });
    await prisma.client.deleteMany({ where: { id: bareClient } });
    await prisma.accord.deleteMany({ where: { id: { in: accordIds } } });
    await prisma.ware.deleteMany({ where: { id: { in: wareIds } } });
    await prisma.msaVersion.deleteMany({ where: { id: msaId } });
    await prisma.$disconnect();
  });

  describe('how a project is tied to its deal', () => {
    it("uses the project's own deal link first (project_accord)", async () => {
      const d = await readDeals(prisma, { projectId: linkedProject });
      expect(d.tie).toBe('project_accord');
      expect(d.deals.map((x) => x.id)).toEqual([signedAccord]);
      expect(d.deals[0].tied_to_project).toBe(true);
    });

    it("falls back to a deal's commission item that points at the project (commission_item)", async () => {
      const d = await readDeals(prisma, { projectId: commissionProject });
      expect(d.tie).toBe('commission_item');
      expect(d.deals.map((x) => x.id)).toEqual([itemAccord]);
      expect(d.deals[0].tied_to_project).toBe(true);
    });

    it("with neither link, lists the client's signed deals newest first and says they are not a link (client_signed_deals)", async () => {
      const d = await readDeals(prisma, { projectId: unlinkedProject });
      expect(d.tie).toBe('client_signed_deals');
      // signedAccord is tied to another project (Linked), so it is that project's deal and no candidate here.
      expect(d.deals.map((x) => x.id)).toEqual([laterSigned]);
      expect(d.deals.every((x) => x.tied_to_project === false)).toBe(true);
      expect(d.tie_note).toMatch(/does not tie this project/i);
    });

    it('a client with every deal: all statuses, signed first (client_deals); a project with nothing: none', async () => {
      const all = await readDeals(prisma, { clientId: fx.clientId });
      expect(all.tie).toBe('client_deals');
      expect(all.deals.map((x) => x.id)).toEqual([laterSigned, signedAccord, itemAccord, otherLead]);
      expect(all.deals.map((x) => x.status).sort()).toEqual(['active', 'lead', 'proposal', 'signed']);
      const none = await readDeals(prisma, { projectId: bareProject });
      expect([none.tie, none.deals.length, none.retainers.length]).toEqual(['none', 0, 0]);
      expect(none.tie_note).toMatch(/no deal/i);
    });
  });

  describe('the payload', () => {
    it('carries status, signed date, contract state, link, and every line item with amounts exactly as stored', async () => {
      const d = (await readDeals(prisma, { projectId: linkedProject })).deals[0];
      expect(d).toMatchObject({ name: `${fx.tag} Signed deal`, status: 'signed', signed_at: '2026-09-01T15:00:00.000Z', total_value: '14250.50', href: `/deals/${signedAccord}`, contract_count: 2 });
      // the signed contract wins over the newer-or-older draft/sent versions
      expect(d.contract).toEqual({ version: 2, status: 'signed', sent_at: null, signed_at: '2026-09-01T15:00:00.000Z' });
      expect(d.items.commission).toHaveLength(1);
      expect(d.items.commission[0]).toMatchObject({ name: `${fx.tag} Website build`, estimated_price: '12000.00', final_price: '11250.50', discount_type: 'percent', discount_value: '6.25' });
      expect(d.items.charter[0]).toMatchObject({ name: 'Monthly care', base_price: '250.00', final_price: '225.00', billing_period: 'monthly', duration_months: 12, total_contract_value: '2700.00' });
      expect(d.items.keep[0]).toMatchObject({ name: 'New site', domain_name: 'example.test', hosting_final_price: '30.00', maintenance_final_price: '20.00', monthly_total: '50.00' });
    });

    it("carries the client's retainers with hours, rate and period, and the hours kept on the client", async () => {
      const d = await readDeals(prisma, { projectId: linkedProject });
      expect(d.retainers).toEqual([
        { id: charterId, name: `${fx.tag} Retainer`, status: 'active', billing_period: 'monthly', budget_hours: '10.00', hourly_rate: '125.00', budget_amount: null, start_date: '2026-09-01', end_date: null, duration_months: 12, renewal_date: null, deal_id: signedAccord, site_id: null },
      ]);
      expect(d.client_retainer).toEqual({ retainer_hours: '5.00', hourly_rate: '110.00', usage_mode: 'medium' });
    });

    it('never carries a signer, an address, an IP, a portal token, the contract text, a snapshot or the private accord fields', async () => {
      const text = JSON.stringify([await readDeals(prisma, { projectId: linkedProject }), await readDeals(prisma, { clientId: fx.clientId })]);
      for (const secret of ['SIGNER NAME', 'signer@secret.test', '203.0.113.9', 'PORTAL-TOKEN-SECRET', 'SECRET contract text', 'snapshot', 'PRIVATE accord note', 'PRIVATE reason']) {
        expect(text, secret).not.toContain(secret);
      }
    });

    it('only reads: it writes nothing', async () => {
      const before = await prisma.accord.findMany({ where: { id: { in: accordIds } }, select: { id: true, updated_at: true }, orderBy: { id: 'asc' } });
      await readDeals(prisma, { projectId: linkedProject });
      await readDeals(prisma, { clientId: fx.clientId });
      const after = await prisma.accord.findMany({ where: { id: { in: accordIds } }, select: { id: true, updated_at: true }, orderBy: { id: 'asc' } });
      expect(after).toEqual(before);
    });
  });

  describe('who may read it, through the three routes the chat reads', () => {
    const roles: [string, AuthPayload][] = [
      ['a tech user', { userId: '7f1c0000-0000-4000-8000-0000000000a1', role: 'tech', email: 't@x.test', via: 'session' }],
      ['a designer', { userId: '7f1c0000-0000-4000-8000-0000000000a2', role: 'designer', email: 'd@x.test', via: 'session' }],
      ['a bot key with no lane', { userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'k0' }],
      ['another lane (porter)', { userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'k1', lane: 'porter', laneEnforced: true }],
      ['the triage desk', { userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'k2', lane: 'triage-desk', laneEnforced: true }],
    ];

    it('the chat lane gets a `deal` section from get_project, get_client and get_task', async () => {
      as(chatLane());
      const p = await json(await getProject(req(), idParams(linkedProject)));
      expect(p.status).toBe(200);
      expect(p.body.deal.tie).toBe('project_accord');
      expect(p.body.deal.deals[0].id).toBe(signedAccord);
      const c = await json(await getClient(req(), idParams(fx.clientId)));
      expect(c.body.deal.tie).toBe('client_deals');
      const t = await json(await getTask(req(), idParams(linkedTask)));
      expect(t.body.deal.tie).toBe('project_accord');
      const u = await json(await getTask(req(), idParams(unlinkedTask)));
      expect(u.body.deal.tie).toBe('client_signed_deals');
    });

    it.each(roles)('%s gets the same routes with no `deal` key', async (_n, auth) => {
      as(auth);
      for (const res of [await getProject(req(), idParams(linkedProject)), await getClient(req(), idParams(fx.clientId)), await getTask(req(), idParams(linkedTask))]) {
        const r = await json(res);
        if (r.status === 200) expect(r.body, JSON.stringify(Object.keys(r.body))).not.toHaveProperty('deal');
        else expect([401, 403, 404]).toContain(r.status);
      }
    });

    it("Mike's own session gets no `deal` key either (the owner reads the deal on the deal page and the card)", async () => {
      as(mikeSession());
      expect((await json(await getProject(req(), idParams(linkedProject)))).body).not.toHaveProperty('deal');
    });

    it('Dox gets it only inside its project binding: the named live project with an open pass, or that project\'s client', async () => {
      const play = await fx.mkProject('Dox play', { accord_id: signedAccord });
      const other = await fx.mkProject('Dox other', { accord_id: itemAccord });
      await fx.openPass(play);
      await fx.openPass(other);
      const d = { 'x-dox-project': play };
      as(dox());
      expect((await json(await getProject(req(d), idParams(play)))).body.deal.deals[0].id).toBe(signedAccord);
      expect((await json(await getProject(req(d), idParams(other)))).body).not.toHaveProperty('deal'); // another project
      expect((await json(await getProject(req(), idParams(play)))).body).not.toHaveProperty('deal'); // no header
      expect((await json(await getClient(req(d), idParams(fx.clientId)))).body.deal.tie).toBe('client_deals'); // the bound project's client
      expect((await json(await getClient(req(d), idParams(bareClient)))).body).not.toHaveProperty('deal'); // someone else's client
      const noPass = await fx.mkProject('Dox no pass', { accord_id: signedAccord });
      expect((await json(await getProject(req({ 'x-dox-project': noPass }), idParams(noPass)))).body).not.toHaveProperty('deal');
    });

    it('mayReadDeal is false for a browser session of any role and for a client (portal) session', async () => {
      for (const auth of [mikeSession(), { userId: 'u', role: 'pm', via: 'session' } as AuthPayload, { userId: 'c', role: 'client', via: 'session' } as unknown as AuthPayload]) {
        expect(await mayReadDeal(auth, req().headers, { projectId: linkedProject })).toBe(false);
      }
    });
  });

  describe("the Triage card's project block", () => {
    it('shows the deal with its items for a project card, and the tie when the deal is only a candidate', async () => {
      const setup = await fx.mkTask('Setup card', { status: 'triage', triage_kind: 'project_setup', project_id: linkedProject, client_id: fx.clientId });
      const [card] = await loadCards(prisma, [setup]);
      expect(card.project?.deal).toEqual({ id: signedAccord, name: `${fx.tag} Signed deal`, href: `/deals/${signedAccord}` });
      const detail = card.project?.deal_detail;
      expect(detail?.tie).toBe('project_accord');
      expect(detail?.deals[0].items.commission[0]).toMatchObject({ final_price: '11250.50' });
      expect(detail?.deals[0].items.charter[0]).toMatchObject({ final_price: '225.00', billing_period: 'monthly', duration_months: 12 });
      const loose = await fx.mkTask('Setup card, unlinked deal', { status: 'triage', triage_kind: 'project_setup', project_id: unlinkedProject, client_id: fx.clientId });
      const [c2] = await loadCards(prisma, [loose]);
      expect(c2.project?.deal).toBeNull();
      expect(c2.project?.deal_detail?.tie).toBe('client_signed_deals');
    });

    it('GET /triage hands Dox the items only inside its project binding', async () => {
      const play = await fx.mkProject('Dox play card', { accord_id: signedAccord });
      await fx.openPass(play);
      const card = await fx.mkTask('Card for dox', { status: 'triage', triage_kind: 'project_setup', project_id: play, client_id: fx.clientId });
      as(dox());
      const bound = await json(await getTriage(req({ 'x-dox-project': play }), idParams(card)));
      expect(bound.body.project.deal_detail.deals[0].items.commission).toHaveLength(1);
      const unbound = await json(await getTriage(req(), idParams(card)));
      expect(unbound.status).toBe(200);
      expect(unbound.body.project.deal_detail).toBeNull();
      expect(unbound.body.project.deal).toMatchObject({ id: signedAccord }); // the link itself is not a price
    });
  });

  it('no client portal route can reach the deal read', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const dir of ['app/api/portal', 'lib/portal']) {
      for (const f of walk(path.join(process.cwd(), dir)).filter((x) => x.endsWith('.ts') && !x.includes('__tests__'))) {
        expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/@\/lib\/deals\//);
      }
    }
  });
});
