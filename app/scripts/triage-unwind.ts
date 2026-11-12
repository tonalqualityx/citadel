/**
 * Triage unwind: the rollback step to run BEFORE reverting the `triage` TaskStatus enum value (old code cannot read a
 * triage row). Moves every task in `triage` back to `not_started` and adds the tag `was-triage`, so the set can be
 * found again and re-filed after a re-deploy.
 *
 * Default (no flags): DRY RUN. Prints every triage task and what would change. Writes nothing.
 * --apply: performs the move, one task at a time (each write only matches a task still in triage).
 *
 * Run with (from app/ in a DEV CHECKOUT; point DATABASE_URL at the database you mean, this script never picks one):
 *   TS_NODE_BASEURL=. npx ts-node -r tsconfig-paths/register --transpile-only \
 *     --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/triage-unwind.ts [--apply]
 * (There is no tsx here, and plain ts-node fails on the `@/` import; the line above is the one that works.)
 * Production ships no scripts/ or lib/, so this cannot run on the server: run it from a dev checkout with DATABASE_URL
 * pointing at the PRODUCTION database (dry run first, read the list, then --apply).
 * A task filed into triage from a client-visible state carries the tag triage-was-client-visible; unwinding restores
 * client_visible and drops that tag.
 */
import { prisma } from '@/lib/db/prisma';
import { TRIAGE_WAS_VISIBLE_TAG } from '@/lib/services/task-patch';

export const WAS_TRIAGE_TAG = 'was-triage';

export async function unwindTriage(apply: boolean): Promise<{ found: number; moved: number }> {
  const rows = await prisma.task.findMany({
    where: { status: 'triage' },
    select: { id: true, title: true, tags: true, is_deleted: true, client_visible: true },
    orderBy: { created_at: 'asc' },
  });
  let moved = 0;
  for (const t of rows) {
    const restore = t.tags.includes(TRIAGE_WAS_VISIBLE_TAG);
    const base = t.tags.filter((x) => x !== TRIAGE_WAS_VISIBLE_TAG);
    const tags = base.includes(WAS_TRIAGE_TAG) ? base : [...base, WAS_TRIAGE_TAG];
    console.log(`${apply ? 'MOVE' : 'would move'} ${t.id} ${t.is_deleted ? '(deleted) ' : ''}${t.title.slice(0, 80)} -> not_started, tag ${WAS_TRIAGE_TAG}`);
    if (!apply) continue;
    const r = await prisma.task.updateMany({ where: { id: t.id, status: 'triage' }, data: { status: 'not_started', tags, ...(restore ? { client_visible: true } : {}) } });
    moved += r.count;
  }
  return { found: rows.length, moved };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { found, moved } = await unwindTriage(apply);
  console.log(apply ? `Done: ${moved} of ${found} triage tasks moved to not_started.` : `Dry run: ${found} triage tasks would move. Re-run with --apply to do it.`);
}

if (require.main === module || process.argv[1]?.endsWith('triage-unwind.ts')) {
  main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
}
