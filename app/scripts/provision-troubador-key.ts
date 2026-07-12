/**
 * Provision the Troubador service user + API key.
 *
 * Idempotent: upserts the service user (troubador@indelible.bot, role pm) and mints an
 * API key ONLY if no live (non-revoked) key exists. The raw key is printed ONCE — only
 * its sha256 hash is stored (same contract as prisma/seed.ts's Oracle key).
 *
 * Where to put the key: on the worker machine, write the raw key to
 * ~/.citadel-troubador-token (chmod 600). The worker (~/.local/bin/troubador-worker.sh)
 * and the skill's lib/citadel.py both resolve it from there.
 *
 * Usage:
 *   local dev:  npx tsx scripts/provision-troubador-key.ts
 *   prod (EC2): run from /var/www/citadel/app with prod DATABASE_URL in the environment.
 *               This WRITES to the target database — on prod, that is a production change;
 *               run it deliberately.
 *
 * Rotation: revoke the existing key (is_revoked=true) and re-run.
 */

import { PrismaClient, UserRole } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { generateApiKey } from '../lib/auth/api-keys';

const prisma = new PrismaClient();
const TROUBADOR_SERVICE_EMAIL = 'troubador@indelible.bot';

async function main() {
  // Service accounts never log in with a password — set an unguessable throwaway hash.
  const user = await prisma.user.upsert({
    where: { email: TROUBADOR_SERVICE_EMAIL },
    update: { is_active: true },
    create: {
      email: TROUBADOR_SERVICE_EMAIL,
      name: 'Troubador',
      role: UserRole.pm,
      is_active: true,
      password_hash: hashSync(randomBytes(32).toString('hex'), 10),
    },
  });
  console.log(`✓ Service user present: ${user.email} (${user.id})`);

  const existing = await prisma.apiKey.findFirst({
    where: { user_id: user.id, is_revoked: false },
  });
  if (existing) {
    console.log(
      `⏭ A live API key already exists (prefix ${existing.key_prefix}…). ` +
        'Revoke it and re-run to rotate.'
    );
    return;
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  await prisma.apiKey.create({
    data: {
      user_id: user.id,
      name: 'Troubador worker key',
      key_hash: keyHash,
      key_prefix: keyPrefix,
    },
  });
  console.log('✓ Troubador API key minted (shown ONCE — store it now):');
  console.log(`  ${rawKey}`);
  console.log('  → on the worker machine: umask 177 && printf "%s" "<key>" > ~/.citadel-troubador-token');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
