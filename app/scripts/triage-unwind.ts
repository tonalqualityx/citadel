/**
 * Triage unwind: the rollback step to run BEFORE reverting the `triage` TaskStatus enum value (old code cannot read a
 * triage row). Moves every task in `triage` back to `not_started` and adds the tag `was-triage`, so the set can be
 * found again and re-filed after a re-deploy.
 *
 * Default (no flags): DRY RUN. Prints every triage task and what would change. Writes nothing.
 * --apply: performs the move, one task at a time (each write only matches a task still in triage).
 *
 * Run with (point DATABASE_URL at the database you mean; this script never picks one for you):
 *   npx tsx scripts/triage-unwind.ts
 *   npx tsx scripts/triage-unwind.ts --apply
 */
import { prisma } from '@/lib/db/prisma';

export const WAS_TRIAGE_TAG = 'was-triage';

export async function unwindTriage(apply: boolean): Promise<{ found: number; moved: number }> {
  const rows = await prisma.task.findMany({
    where: { status: 'triage' },
    select: { id: true, title: true, tags: true, is_deleted: true },
    orderBy: { created_at: 'asc' },
  });
  let moved = 0;
  for (const t of rows) {
    const tags = t.tags.includes(WAS_TRIAGE_TAG) ? t.tags : [...t.tags, WAS_TRIAGE_TAG];
    console.log(`${apply ? 'MOVE' : 'would move'} ${t.id} ${t.is_deleted ? '(deleted) ' : ''}${t.title.slice(0, 80)} -> not_started, tag ${WAS_TRIAGE_TAG}`);
    if (!apply) continue;
    const r = await prisma.task.updateMany({ where: { id: t.id, status: 'triage' }, data: { status: 'not_started', tags } });
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
