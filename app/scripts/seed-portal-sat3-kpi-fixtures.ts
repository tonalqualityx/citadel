/**
 * Fixtures for the portal KPI goals and onboarding "what we still need" screens (Saturday 10-24
 * run, item 3). Runs on top of seed-portal-v2-phase1-fixtures.ts and seed-portal-b2-fixtures.ts:
 *  - three confirmed SiteKpi rows on the fixture client's two sites (one has a latest reading), and
 *    one proposed row that must never show;
 *  - an open onboarding checklist from the build template where the logo, billing contact and
 *    kickoff are still missing and the rest of the before-work items are in.
 * `--cleanup` removes exactly these rows. Idempotent. Local and scratch databases only.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-portal-sat3-kpi-fixtures.ts [--cleanup]
 */
import { PrismaClient } from '@prisma/client';
import { itemsFromTemplate } from '../lib/checklists/service';
import { ONBOARDING_BUILD_TEMPLATE } from '../lib/checklists/templates';

const prisma = new PrismaClient();
const CLIENT_NAME = 'E2E Portal Client (fixture)';
const MARK = 'E2E sat3: ';

const KPIS = [
  { site: 'E2E Portal Fixture Site', metric: 'leads', label: `${MARK}More enquiries from the website`, direction: 'up', target_value: 40, target_by: '2027-03-31', last_value: 12, source: 'ga4', status: 'confirmed' },
  { site: 'E2E Portal Fixture Site', metric: 'rank:septic pumping', label: `${MARK}Show up for septic pumping`, direction: 'up', target_value: 3, target_by: null, last_value: null, source: 'gsc', status: 'confirmed' },
  { site: 'E2E Portal Fixture Site Two', metric: 'uptime', label: `${MARK}Keep the shop online`, direction: 'up', target_value: 99.9, target_by: null, last_value: 99.8, source: 'kuma', status: 'confirmed' },
  { site: 'E2E Portal Fixture Site Two', metric: 'revenue', label: `${MARK}Not agreed yet`, direction: 'up', target_value: 5000, target_by: null, last_value: null, source: 'manual', status: 'proposed' },
] as const;

const STILL_MISSING = new Set(['assets.logo', 'people.billing_contact', 'meeting.kickoff']);

async function clientId() {
  const c = await prisma.client.findFirst({ where: { name: CLIENT_NAME } });
  if (!c) throw new Error('Run seed-portal-v2-phase1-fixtures.ts first.');
  return c.id;
}

async function cleanup(cid: string) {
  await prisma.siteKpi.deleteMany({ where: { client_id: cid, label: { startsWith: MARK } } });
  await prisma.checklist.deleteMany({ where: { client_id: cid, kind: 'onboarding' } });
}

async function main() {
  const cid = await clientId();
  await cleanup(cid);
  if (process.argv.includes('--cleanup')) return;

  for (const k of KPIS) {
    const site = await prisma.site.findFirstOrThrow({ where: { client_id: cid, name: k.site } });
    await prisma.siteKpi.create({
      data: {
        client_id: cid, site_id: site.id, metric: k.metric, label: k.label, direction: k.direction,
        target_value: k.target_value, target_by: k.target_by ? new Date(`${k.target_by}T00:00:00Z`) : null,
        last_value: k.last_value, last_checked_at: k.last_value === null ? null : new Date(),
        source: k.source, status: k.status, confirmed_at: k.status === 'confirmed' ? new Date() : null,
      },
    });
  }

  await prisma.checklist.create({
    data: {
      kind: 'onboarding',
      client_id: cid,
      items: {
        create: itemsFromTemplate(ONBOARDING_BUILD_TEMPLATE).map((i) => ({
          ...i,
          state: i.required && !STILL_MISSING.has(i.key) && !i.key.startsWith('access.') ? 'verified' : 'missing',
          evidence: i.required && !STILL_MISSING.has(i.key) && !i.key.startsWith('access.') ? 'fixture' : null,
        })),
      },
    },
  });
  console.log(JSON.stringify({ kpis: KPIS.length, checklist: 1 }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
