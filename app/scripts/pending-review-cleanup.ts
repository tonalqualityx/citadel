/**
 * Oracle Projects Phase 1 (2026-09-04) — one-time sweep for tasks created under the OLD
 * needs_review default (true). Mike's ruling flipped the schema default to false; this
 * script finds the done-but-still-flagged backlog so he can clear it deliberately rather
 * than the flip silently mass-mutating history.
 *
 * Default (no flags): prints a table of every task with status=done, needs_review=true,
 * approved=false — id, title, SOP title, client, updated_at. Read-only, no writes.
 *
 * --apply --ids <csv>: sets needs_review=false on exactly the given ids (must already be
 * in the done+needs_review+!approved set), logging each change via logUpdate as the
 * system (Bast) user. Reversible (needs_review can always be flipped back by hand) and
 * scoped — it never touches an id that isn't in --ids.
 *
 * Refuses --apply without --ids (no "clear everything" footgun).
 *
 * Run with:
 *   npx tsx scripts/pending-review-cleanup.ts
 *   npx tsx scripts/pending-review-cleanup.ts --apply --ids <uuid>,<uuid>,...
 */
import { prisma } from '@/lib/db/prisma';
import { logUpdate } from '@/lib/services/activity';
import { getBastUserId } from '@/lib/services/portal';

interface CleanupTaskRow {
  id: string;
  title: string;
  sop_title: string | null;
  client_name: string | null;
  updated_at: Date;
}

async function findPendingReviewTasks(): Promise<CleanupTaskRow[]> {
  const tasks = await prisma.task.findMany({
    where: {
      status: 'done',
      needs_review: true,
      approved: false,
      is_deleted: false,
    },
    select: {
      id: true,
      title: true,
      updated_at: true,
      sop: { select: { title: true } },
      client: { select: { name: true } },
    },
    orderBy: { updated_at: 'desc' },
  });

  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    sop_title: t.sop?.title ?? null,
    client_name: t.client?.name ?? null,
    updated_at: t.updated_at,
  }));
}

function printTable(rows: CleanupTaskRow[]) {
  if (rows.length === 0) {
    console.log('No done+needs_review+unapproved tasks found. Nothing to clean up.');
    return;
  }

  console.log(`${rows.length} task(s) awaiting review, done but never approved:\n`);
  console.log(
    ['id', 'title', 'sop', 'client', 'updated_at']
      .map((h) => h.padEnd(20))
      .join(' | ')
  );
  console.log('-'.repeat(110));
  for (const row of rows) {
    console.log(
      [
        row.id,
        row.title.slice(0, 40),
        (row.sop_title ?? '-').slice(0, 20),
        (row.client_name ?? '-').slice(0, 20),
        row.updated_at.toISOString(),
      ]
        .map((c) => String(c).padEnd(20))
        .join(' | ')
    );
  }
  console.log('\nTo clear specific ids: npx tsx scripts/pending-review-cleanup.ts --apply --ids <id1>,<id2>,...');
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const idsFlagIndex = argv.indexOf('--ids');
  const idsArg = idsFlagIndex !== -1 ? argv[idsFlagIndex + 1] : undefined;
  const ids = idsArg ? idsArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return { apply, ids };
}

async function applyCleanup(ids: string[]) {
  const bastUserId = await getBastUserId();
  if (!bastUserId) {
    throw new Error('Could not resolve the system (Bast) user — refusing to apply changes without an attributable actor.');
  }

  // Only ever touch ids that are actually in the current done+needs_review+!approved set —
  // an id typo'd or already cleared by someone else is silently skipped, not force-applied.
  const eligible = await prisma.task.findMany({
    where: {
      id: { in: ids },
      status: 'done',
      needs_review: true,
      approved: false,
      is_deleted: false,
    },
    select: { id: true, title: true },
  });

  const eligibleIds = new Set(eligible.map((t) => t.id));
  const skipped = ids.filter((id) => !eligibleIds.has(id));

  for (const task of eligible) {
    await prisma.task.update({
      where: { id: task.id },
      data: { needs_review: false },
    });
    await logUpdate(bastUserId, 'task', task.id, task.title, {
      needs_review: { from: true, to: false },
    });
    console.log(`Cleared needs_review on "${task.title}" (${task.id})`);
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} id(s) not in the eligible set: ${skipped.join(', ')}`);
  }

  console.log(`\nDone. ${eligible.length} task(s) updated.`);
}

async function main() {
  const { apply, ids } = parseArgs(process.argv.slice(2));

  if (apply && ids.length === 0) {
    throw new Error('--apply requires --ids <csv>. Refusing to clear the whole list at once.');
  }

  if (apply) {
    await applyCleanup(ids);
    return;
  }

  const rows = await findPendingReviewTasks();
  printTable(rows);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
