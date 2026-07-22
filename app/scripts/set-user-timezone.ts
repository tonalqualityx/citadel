/**
 * Clarity Phase 3d — one-off/idempotent: set a user's UserPreference.timezone.
 *
 * No settings UI exists yet to let a user pick their own zone (Phase 4), so this is
 * how Mike's own row gets seeded for verification. Safe to re-run — upserts.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/set-user-timezone.ts <email> <IANA timezone>
 * e.g.:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/set-user-timezone.ts admin@indelible.agency America/New_York
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [, , email, timezone] = process.argv;
  if (!email || !timezone) {
    throw new Error('Usage: set-user-timezone.ts <email> <IANA timezone>');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`User ${email} not found — run prisma/seed.ts first.`);

  const pref = await prisma.userPreference.upsert({
    where: { user_id: user.id },
    update: { timezone },
    create: { user_id: user.id, timezone },
  });

  console.log(`Set ${email}'s UserPreference.timezone = ${pref.timezone}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
