/**
 * Dev fixture seed for the portal redesign screenshot pass: a `sent` proposal with a fixed portal
 * token, on the accord that scripts/seed-contract-sign-kickoff-e2e-fixtures.ts creates (run that
 * first; it also supplies the `sent` contract). Idempotent. Local dev only: it writes to whatever
 * DATABASE_URL points at.
 */
import { PrismaClient } from '@prisma/client';

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
      await prisma.client.update({ where: { id: existing.id }, data: { is_deleted: true } });
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
  if (process.argv.includes('--cleanup')) return secondAccount(false);
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
