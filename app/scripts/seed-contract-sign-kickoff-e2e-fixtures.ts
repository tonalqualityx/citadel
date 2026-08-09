/**
 * Dev fixture seed for the contract/MSA-sign kickoff-automation Playwright coverage
 * (ops-review finding B6 — signing a contract or MSA now auto-creates a cockpit-owned
 * kickoff task; see lib/services/kickoff.ts).
 *
 * Seeds a client, an accord (owned by the seeded admin user), an MSA version, a
 * `sent` contract with a fixed portal token, and an unsigned MSA signature with its own
 * fixed portal token. The spec drives the real public /portal/contract/[token] and
 * /portal/msa/[token] sign flows against these tokens, then verifies the kickoff task via
 * the admin API (shared storageState).
 *
 * Idempotent: each row is found-or-recreated by a fixed name/token on every run. Local dev
 * only — this seeds whatever DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-contract-sign-kickoff-e2e-fixtures.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const CONTRACT_PORTAL_TOKEN = 'e2e-kickoff-contract-fixture-token-'.padEnd(128, 'a');
export const MSA_PORTAL_TOKEN = 'e2e-kickoff-msa-fixture-token-'.padEnd(128, 'b');

const CLIENT_NAME = 'E2E Kickoff Client (fixture)';
const ACCORD_NAME = 'E2E Kickoff Accord (fixture)';
const MSA_VERSION = 'e2e-kickoff-fixture';
const ADMIN_EMAIL = 'admin@indelible.agency';

async function main() {
  const owner = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL } });
  if (!owner) {
    throw new Error(`Seed owner ${ADMIN_EMAIL} not found — run the base dev seed first.`);
  }

  const client = await prisma.client.findFirst({ where: { name: CLIENT_NAME } });
  const clientRow = client
    ? await prisma.client.update({ where: { id: client.id }, data: { is_deleted: false } })
    : await prisma.client.create({ data: { name: CLIENT_NAME, type: 'direct', status: 'active' } });

  // Clear out any kickoff task left over from a previous run so the spec observes a fresh
  // "no task yet -> task created by signing" transition every time.
  await prisma.task.deleteMany({
    where: { client_id: clientRow.id, tags: { has: 'cockpit-owned' } },
  });

  const existingAccord = await prisma.accord.findFirst({ where: { name: ACCORD_NAME } });
  const accord = existingAccord
    ? await prisma.accord.update({
        where: { id: existingAccord.id },
        data: { client_id: clientRow.id, status: 'contract', is_deleted: false },
      })
    : await prisma.accord.create({
        data: {
          name: ACCORD_NAME,
          client_id: clientRow.id,
          owner_id: owner.id,
          status: 'contract',
        },
      });

  let msaVersion = await prisma.msaVersion.findFirst({ where: { version: MSA_VERSION } });
  if (!msaVersion) {
    msaVersion = await prisma.msaVersion.create({
      data: {
        version: MSA_VERSION,
        content: '<p>E2E fixture MSA terms.</p>',
        effective_date: new Date('2026-01-01'),
        created_by_id: owner.id,
      },
    });
  }

  // Reset the contract to a fresh, unsigned `sent` state with the fixed token every run.
  await prisma.contract.deleteMany({ where: { accord_id: accord.id } });
  await prisma.contract.create({
    data: {
      accord_id: accord.id,
      version: 1,
      content: '<p>E2E fixture contract content.</p>',
      msa_version_id: msaVersion.id,
      status: 'sent',
      pricing_snapshot: [],
      sent_at: new Date(),
      portal_token: CONTRACT_PORTAL_TOKEN,
      portal_token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      created_by_id: owner.id,
    },
  });

  // Reset the MSA signature to a fresh, unsigned state with the fixed token every run.
  await prisma.clientMsaSignature.deleteMany({
    where: { client_id: clientRow.id, msa_version_id: msaVersion.id },
  });
  await prisma.clientMsaSignature.create({
    data: {
      client_id: clientRow.id,
      msa_version_id: msaVersion.id,
      signed_at: new Date(0), // placeholder — sign route treats `signer_name` presence as "already signed"
      signer_name: '',
      signer_email: '',
      portal_token: MSA_PORTAL_TOKEN,
    },
  });
  // The sign route's "already signed" check is `if (signature.signer_name)` — an empty
  // string is falsy, so this row reads as unsigned. `signed_at` has a NOT NULL constraint
  // with no default, hence the epoch placeholder above; the sign route overwrites it.

  console.log(`Kickoff e2e fixtures ready (client_id=${clientRow.id}, accord_id=${accord.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
