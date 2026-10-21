/**
 * Dev fixture seed for the portal redesign screenshot pass: a `sent` proposal with a fixed portal
 * token, on the accord that scripts/seed-contract-sign-kickoff-e2e-fixtures.ts creates (run that
 * first; it also supplies the `sent` contract). Idempotent. `--second-account` adds a temporary
 * second client for the owner; `--cleanup-second-account` removes it; `--cleanup` removes it and the
 * proposal. Refuses to run unless the database name contains "scratch" or "dev". Local dev only: it writes to whatever
 * DATABASE_URL points at.
 */
import { PrismaClient } from '@prisma/client';

// Local dev only: refuse to run against any database whose name does not say so.
const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!/scratch|dev/i.test(dbName)) {
  console.error(`Refusing to run: DATABASE_URL database "${dbName}" does not contain "scratch" or "dev".`);
  process.exit(1);
}

const prisma = new PrismaClient();

export const PROPOSAL_TOKEN = 'e2e-b3-proposal-fixture-token-'.padEnd(128, 'p');

const SECOND_CLIENT = 'E2E Second Account (fixture)';
const OWNER_EMAIL = 'contact@e2e-portal-fixture.example';

/** `--second-account` gives the fixture owner a second client, so /portal/select has two accounts. */
async function secondAccount(on: boolean) {
  const existing = await prisma.client.findFirst({ where: { name: SECOND_CLIENT } });
  if (!on) {
    if (existing) {
      await prisma.clientContact.deleteMany({ where: { client_id: existing.id } });
      await prisma.portalSession.deleteMany({ where: { entity_id: existing.id } });
      await prisma.client.delete({ where: { id: existing.id } });
    }
    return;
  }
  const client = existing
    ? await prisma.client.update({ where: { id: existing.id }, data: { is_deleted: false } })
    : await prisma.client.create({ data: { name: SECOND_CLIENT, type: 'direct', status: 'active' } });
  await prisma.clientContact.upsert({
    where: { client_id_email: { client_id: client.id, email: OWNER_EMAIL } },
    create: { client_id: client.id, name: 'Dana Owner', email: OWNER_EMAIL, portal_role: 'owner' },
    update: { is_deleted: false, portal_role: 'owner' },
  });
}

async function main() {
  if (process.argv.includes('--second-account')) return secondAccount(true);
  if (process.argv.includes('--cleanup-second-account')) return secondAccount(false);
  if (process.argv.includes('--cleanup')) {
    // Remove everything this seed adds: the sent proposal and the temporary second client.
    await prisma.proposal.deleteMany({ where: { portal_token: PROPOSAL_TOKEN } });
    return secondAccount(false);
  }
  const accord = await prisma.accord.findFirstOrThrow({ where: { name: 'E2E Kickoff Accord (fixture)' } });
  const owner = await prisma.user.findFirstOrThrow({ where: { email: 'admin@indelible.agency' } });
  await prisma.proposal.deleteMany({ where: { accord_id: accord.id } });
  await prisma.proposal.create({
    data: {
      accord_id: accord.id,
      version: 1,
      content: '<p>We will rebuild the site on a platform you own, then keep it running.</p>',
      status: 'sent',
      pricing_snapshot: {},
      sent_at: new Date('2026-10-14T12:00:00Z'),
      portal_token: PROPOSAL_TOKEN,
      created_by_id: owner.id,
    },
  });
  console.log(JSON.stringify({ proposal_token: PROPOSAL_TOKEN }));
}

main().finally(() => prisma.$disconnect());
