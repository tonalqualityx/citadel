/**
 * One-off: replace every raw refresh token stored in the session table with its SHA-256 hash (64 hex chars), the form
 * createSession and refresh now write. Rows already holding a 64-char hex hash are left alone, so it is safe to re-run.
 * Nothing reads the stored value (refresh binds by the token's `sid`), so signed-in users are not affected.
 *
 * Default (no flags): DRY RUN. Prints how many rows would change (session ids only, never token values). Writes nothing.
 * --apply: rewrites those rows, one at a time (each write only matches a row still holding the value that was read).
 *
 * Run with (from app/ in a DEV CHECKOUT; point DATABASE_URL at the database you mean, this script never picks one):
 *   TS_NODE_BASEURL=. npx ts-node -r tsconfig-paths/register --transpile-only \
 *     --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/hash-session-tokens.ts [--apply]
 * Production ships no scripts/ or lib/, so run it from a dev checkout with DATABASE_URL pointing at the PRODUCTION
 * database (dry run first, then --apply).
 */
import { prisma } from '@/lib/db/prisma';
import { hashRefreshToken } from '@/lib/auth/jwt';

const HASHED_RE = /^[0-9a-f]{64}$/;

export async function hashSessionTokens(apply: boolean): Promise<{ found: number; changed: number }> {
  const rows = await prisma.session.findMany({ select: { id: true, refresh_token: true } });
  const raw = rows.filter((r) => !HASHED_RE.test(r.refresh_token));
  let changed = 0;
  for (const r of raw) {
    console.log(`${apply ? 'HASH' : 'would hash'} session ${r.id}`);
    if (!apply) continue;
    const res = await prisma.session.updateMany({
      where: { id: r.id, refresh_token: r.refresh_token },
      data: { refresh_token: hashRefreshToken(r.refresh_token) },
    });
    changed += res.count;
  }
  return { found: raw.length, changed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { found, changed } = await hashSessionTokens(apply);
  console.log(apply ? `Done: ${changed} of ${found} sessions hashed.` : `Dry run: ${found} sessions would be hashed. Re-run with --apply to do it.`);
}

if (require.main === module || process.argv[1]?.endsWith('hash-session-tokens.ts')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
